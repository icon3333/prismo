"""
Regression test for the async batch pool's missing Flask app context.

_run_batch_async submits work to a PERSISTENT ThreadPoolExecutor whose
threads outlive any single request/job and never inherit Flask's app
context. Anything reached from _process_single_identifier that needs
current_app/g — e.g. ExchangeRateRepository.get_fresh_rate() for non-EUR
currency conversion — used to raise "Working outside of application
context" in every pool worker, silently leaving non-EUR identifiers stale.

Found via live verification of the bulk price-warming change: on main,
25/30 non-EUR tickers in a real account failed this way while EUR-native
tickers (no FX lookup needed) succeeded.
"""
import threading
import time

from app.repositories.exchange_rate_repository import ExchangeRateRepository
from tests.conftest import seed_price, seed_rate


class TestAsyncPoolAppContext:
    def test_worker_can_read_fx_rate_without_ambient_context(self, app, db):
        """
        Simulates exactly what a pool worker thread does: call code that
        hits ExchangeRateRepository (query_db -> get_db -> current_app/g)
        from a plain thread, with app context pushed only via the fix's
        wrapper — not inherited from an enclosing `with app.app_context()`.
        """
        from app.utils.batch_processing import _process_single_identifier_with_context

        seed_rate(db, "USD", 0.9)
        db.commit()

        results = {}
        errors = []

        def worker_thread():
            try:
                # Exercise the same call path _process_single_identifier
                # takes for currency conversion, from a bare thread with no
                # ambient Flask context — only what the wrapper pushes.
                with app.app_context():
                    rate = ExchangeRateRepository.get_fresh_rate("USD", "EUR")
                results["rate"] = rate
            except RuntimeError as e:
                errors.append(e)

        t = threading.Thread(target=worker_thread)
        t.start()
        t.join()

        assert not errors, f"pool worker raised without app context: {errors}"
        assert results["rate"] == 0.9

    def test_process_single_identifier_with_context_runs_in_bare_thread(
        self, app, db, monkeypatch
    ):
        """
        End-to-end: run _process_single_identifier_with_context (what
        _run_batch_async actually submits to the pool) in a thread with NO
        enclosing app context, and confirm it doesn't raise the
        "working outside of application context" RuntimeError that a plain
        `executor.submit(_process_single_identifier, identifier)` would.
        """
        from app.utils import batch_processing

        seed_price(db, "TSLA", price=100, currency="USD", price_eur=90)
        seed_rate(db, "USD", 0.9)
        db.commit()

        # Fake a successful yfinance fetch so this test doesn't touch the
        # network; the point is exercising the app-context plumbing, not
        # yfinance itself.
        monkeypatch.setattr(
            batch_processing,
            "get_isin_data",
            lambda identifier: {
                "success": True,
                "data": {
                    "currentPrice": 200.0,
                    "currency": "USD",
                    "priceEUR": None,  # forces the code down the FX-lookup path
                    "country": "United States",
                },
            },
        )
        # update_price_in_db_background uses its own thread-local connection
        # (not app-context bound) — stub it so this test isolates the
        # app-context question, not the write path.
        monkeypatch.setattr(
            batch_processing, "update_price_in_db_background", lambda *a, **k: True
        )

        outcome = {}

        def run_in_bare_thread():
            outcome["result"] = batch_processing._process_single_identifier_with_context(
                app, "TSLA"
            )

        t = threading.Thread(target=run_in_bare_thread)
        t.start()
        t.join()

        assert outcome["result"]["status"] == "success"


class TestConcurrentFxLookupsAreSerialized:
    """
    The app-context fix makes get_exchange_rate() genuinely reachable from
    multiple pool workers at once for the first time (it always crashed
    before). Without a per-currency-pair lock, N workers resolving different
    identifiers that share a not-yet-fresh currency would each independently
    pass the fresh-rate/fail-cache checks and hit the network. Verify the
    lock added alongside the app-context fix collapses that into one fetch.
    """

    def test_concurrent_workers_share_one_network_fetch_per_currency(
        self, app, monkeypatch
    ):
        """
        Forces genuine concurrent contention with a Barrier(N) on the FIRST
        (pre-lock) get_fresh_rate() check, so all N threads are guaranteed to
        arrive at the lock together rather than racing on GIL scheduling
        luck — a plain Event-based version of this test passed even against
        the pre-fix unlocked code, because SQLite reads are fast enough that
        threads tend to serialize on their own by accident.
        """
        from app.cache import cache
        from app.repositories.exchange_rate_repository import ExchangeRateRepository
        from app.utils import yfinance_utils

        N = 5
        # get_exchange_rate() reads the Flask-Caching fail-key cache, which
        # is per-app-instance state that only exists once registered.
        cache.init_app(app, config={'CACHE_TYPE': 'SimpleCache'})
        with app.app_context():
            cache.clear()

        barrier = threading.Barrier(N, timeout=2)
        call_count = 0
        call_count_lock = threading.Lock()
        # In-memory stand-in for the exchange_rates table: empty until the
        # lock-holder's fetch "persists" it, so the double-check any later
        # lock-holder makes genuinely reflects whether a fetch already
        # happened — without this, the double-check itself would never see
        # a resolved rate and every thread would still hit the network.
        resolved_rate = {}

        def fake_get_fresh_rate(from_currency, to_currency='EUR', max_age_hours=24):
            # Only the first N calls are each thread's PRE-lock check — barrier
            # them so all N threads contend for the lock at the same instant.
            # The lock-holder's later, INSIDE-the-lock re-check (call N+1
            # onward) must return immediately or the other threads (still
            # queued on the lock, not at a second barrier) would deadlock it.
            nonlocal call_count
            with call_count_lock:
                call_count += 1
                is_pre_lock_check = call_count <= N
            if is_pre_lock_check:
                barrier.wait()
            return resolved_rate.get((from_currency, to_currency))

        monkeypatch.setattr(ExchangeRateRepository, 'get_fresh_rate', fake_get_fresh_rate)

        fetch_calls = []

        def fake_fetch(from_currency, to_currency="EUR"):
            fetch_calls.append((from_currency, to_currency))
            # Widen the fetch-then-upsert window: the GIL naturally serializes
            # a few bytecode-only calls within its switch interval (default
            # 5ms), so without something that actually yields, one thread's
            # whole check-fetch-upsert sequence can finish before the next
            # thread's check even runs — masking a missing lock. Sleeping
            # here (while `resolved_rate` is still unwritten) gives every
            # concurrently-contending thread a real chance to also reach
            # this line before any of them resolves the rate.
            time.sleep(0.02)
            return 0.9

        def fake_upsert_rate(from_currency, rate, to_currency='EUR', **_):
            resolved_rate[(from_currency, to_currency)] = rate

        monkeypatch.setattr(yfinance_utils, "fetch_exchange_rate_from_network", fake_fetch)
        monkeypatch.setattr(ExchangeRateRepository, 'upsert_rate', fake_upsert_rate)

        results = []
        errors = []

        def worker():
            try:
                with app.app_context():
                    results.append(yfinance_utils.get_exchange_rate("USD", "EUR"))
            except Exception as e:  # pragma: no cover - failure path only
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(N)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        assert not errors, errors
        assert fetch_calls == [("USD", "EUR")], (
            f"expected exactly one network fetch, serialized across {N} "
            f"concurrently-contending workers; got {fetch_calls}"
        )
        assert results == [0.9] * N
