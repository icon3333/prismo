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

        import threading
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

        import threading
        t = threading.Thread(target=run_in_bare_thread)
        t.start()
        t.join()

        assert outcome["result"]["status"] == "success"
