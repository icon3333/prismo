"""
End-to-end integration test through the REAL batch price pipeline:
start_batch_process -> _run_batch_job -> _run_batch_async -> _get_batch_pool
-> executor.submit(_process_single_identifier_with_context, app, identifier)
-> get_isin_data -> get_exchange_rate -> ExchangeRateRepository (query_db).

Coverage gap found via adversarial review of 8e985b4/0054f16: the existing
unit tests (test_bulk_price_warm.py, test_batch_async_context.py) only call
internal functions directly — none of them drives the actual persistent
ThreadPoolExecutor, the real _run_batch_job -> _run_batch_async call chain
that threads `app` through to each pool task, or the real get_isin_data's
own internal FX-conversion call (they mock get_isin_data away entirely). A
regression that reverted _run_batch_async's executor.submit(...) call
signature, dropped `app` from the _run_batch_job -> _run_batch_async call,
or reintroduced the missing-app-context bug inside the real get_isin_data
call chain would pass all of them.

Only the network boundary (_fetch_yfinance_data_robust) is mocked — the
DB-touching FX-conversion path, the pool wiring, and the write path are all
real, so this doubles as regression coverage for that whole chain.
"""
import time

import pytest

import app.db_manager as db_manager
from app.cache import cache
from app.utils.batch_processing import (
    ASYNC_THRESHOLD,
    get_job_status,
    start_batch_process,
)
from tests.conftest import seed_rate


@pytest.fixture(autouse=True)
def _isolate_background_db_path(app):
    """
    get_background_db() (used by the write path inside the real pool
    workers) caches the resolved sqlite path in a module-level global on
    first use, so persistent-pool workers can find the DB without needing
    an app context of their own. Point it at this test's db and restore
    afterward so it can't leak into a later test in the same process.
    """
    original = db_manager._db_path
    db_manager.set_db_path(
        app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', ''))
    yield
    db_manager._db_path = original


@pytest.fixture(autouse=True)
def _init_cache(app):
    """get_isin_data() and the (non-critical) auto-categorize step both
    read the Flask-Caching cache, which is per-app-instance state."""
    cache.init_app(app, config={'CACHE_TYPE': 'SimpleCache'})
    with app.app_context():
        cache.clear()


def _wait_for_job(app, job_id, timeout=5.0):
    deadline = time.monotonic() + timeout
    with app.app_context():
        while time.monotonic() < deadline:
            status = get_job_status(job_id)
            if status.get('status') in ('completed', 'error', 'db_error'):
                return status
            time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not complete within {timeout}s")


def _mock_robust_fetch(monkeypatch, price, currency, country):
    """
    Stub the network boundary two layers below get_isin_data
    (get_isin_data -> fetch_price_with_crypto_fallback ->
    _fetch_yfinance_data_robust), so get_isin_data's OWN logic — including
    its internal get_exchange_rate() call for non-EUR currencies, the exact
    path that needed the app-context fix — runs for real. Patched on the
    yfinance_utils module object since fetch_price_with_crypto_fallback
    re-imports it fresh on every call.
    """
    from app.utils import yfinance_utils

    monkeypatch.setattr(
        yfinance_utils, "_fetch_yfinance_data_robust",
        lambda identifier: {"price": price, "currency": currency, "country": country},
    )


class TestRealAsyncPipelineWiring:
    def test_batch_runs_through_the_real_persistent_pool(self, app, db, monkeypatch):
        """
        >= ASYNC_THRESHOLD non-EUR identifiers with no pre-existing
        market_prices row (so warm_price_cache_bulk's DB-driven candidate
        filter excludes them and it never touches the network here — that
        pass is covered separately in test_bulk_price_warm.py). This
        genuinely exercises _run_batch_async's real executor.submit(...)
        call on the actual persistent pool for the FX-lookup path that
        needed the app-context fix, rather than calling internals directly.
        """
        identifiers = [f"TICK{i}" for i in range(ASYNC_THRESHOLD)]
        seed_rate(db, "USD", 0.9)
        db.commit()

        _mock_robust_fetch(monkeypatch, price=150.0, currency="USD",
                          country="United States")

        with app.app_context():
            job_id = start_batch_process(identifiers)

        status = _wait_for_job(app, job_id)

        assert status["status"] == "completed"
        results = status["results"]
        assert results["execution_mode"] == "asynchronous"
        assert results["success_count"] == ASYNC_THRESHOLD
        assert results["failure_count"] == 0

        rows = {
            r["identifier"]: dict(r)
            for r in db.execute(
                "SELECT identifier, price, price_eur FROM market_prices"
            ).fetchall()
        }
        for ident in identifiers:
            assert rows[ident]["price"] == 150.0
            # Computed via the REAL get_exchange_rate() -> ExchangeRateRepository
            # chain, run inside the app-context wrapper on a real pool worker.
            assert rows[ident]["price_eur"] == pytest.approx(150.0 * 0.9)

    def test_batch_below_threshold_runs_synchronously(self, app, db, monkeypatch):
        """Sanity check on the sibling (sync) dispatch branch, same pipeline."""
        identifiers = ["ONE", "TWO"]

        _mock_robust_fetch(monkeypatch, price=60.0, currency="EUR", country="Germany")

        with app.app_context():
            job_id = start_batch_process(identifiers)

        status = _wait_for_job(app, job_id)

        assert status["status"] == "completed"
        assert status["results"]["execution_mode"] == "synchronous"
        assert status["results"]["success_count"] == len(identifiers)

        rows = {
            r["identifier"]: dict(r)
            for r in db.execute(
                "SELECT identifier, price, price_eur FROM market_prices"
            ).fetchall()
        }
        for ident in identifiers:
            assert rows[ident]["price"] == 60.0
            assert rows[ident]["price_eur"] == 60.0
