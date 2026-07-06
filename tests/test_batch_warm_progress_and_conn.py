"""
Tests for two efficiency fixes on the batch price pipeline:

1. Connection reuse: the async pool worker keeps ONE app context (and thus
   one g.db read connection) for its lifetime, instead of pushing/popping a
   fresh context — and opening/closing a fresh SQLite connection — per task.

2. Warm-pass progress: the bulk-warm pre-pass reports its warmed identifiers
   as immediate job progress, so the job isn't observably stuck at 0% for the
   ~2s the warm call takes, and the per-identifier loop never regresses below
   that floor.
"""
import threading
import time

import flask
import pytest

from app.utils import batch_processing


@pytest.fixture(autouse=True)
def _reset_worker_ctx():
    """Isolate the thread-local worker app context between tests."""
    yield
    existing = getattr(batch_processing._worker_app_ctx, 'ctx', None)
    if existing is not None:
        try:
            existing.pop()
        except Exception:
            pass
        batch_processing._worker_app_ctx.ctx = None
        batch_processing._worker_app_ctx.app = None


class TestWorkerContextConnectionReuse:
    def test_same_worker_reuses_one_db_connection_across_tasks(
        self, app, db, monkeypatch
    ):
        """
        Two tasks on the same worker thread must see the SAME g.db connection
        — proving the context (and its connection) persists instead of a
        fresh connect+PRAGMA+close per identifier.
        """
        from app.db_manager import get_db

        seen_connections = []

        def fake_process(identifier):
            # Runs inside the worker's app context; get_db() returns the
            # context-scoped connection.
            seen_connections.append(id(get_db()))
            return {"identifier": identifier, "status": "success"}

        monkeypatch.setattr(batch_processing, "_process_single_identifier", fake_process)

        def run_two_tasks():
            batch_processing._process_single_identifier_with_context(app, "AAA")
            batch_processing._process_single_identifier_with_context(app, "BBB")

        # A dedicated thread mimics a persistent pool worker (and keeps the
        # never-popped context off the main test thread).
        t = threading.Thread(target=run_two_tasks)
        t.start()
        t.join()

        assert len(seen_connections) == 2
        assert seen_connections[0] == seen_connections[1], (
            "each task opened a different connection — context/connection not reused"
        )

    def test_different_app_replaces_stale_context(self, monkeypatch):
        """
        A different app instance on the same worker must push a fresh context
        (test-isolation path), not silently reuse the previous app's g.db.
        """
        app_a = flask.Flask("a")
        app_a.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app_b = flask.Flask("b")
        app_b.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

        seen_apps = []

        def fake_process(identifier):
            seen_apps.append(flask.current_app._get_current_object())
            return {"identifier": identifier, "status": "success"}

        monkeypatch.setattr(batch_processing, "_process_single_identifier", fake_process)

        def run():
            batch_processing._process_single_identifier_with_context(app_a, "X")
            batch_processing._process_single_identifier_with_context(app_b, "Y")

        t = threading.Thread(target=run)
        t.start()
        t.join()

        assert seen_apps == [app_a, app_b]


class TestWarmPassProgress:
    def test_warmed_identifiers_reported_as_immediate_progress(self, app, monkeypatch):
        """
        _run_batch_job must push the warmed count as progress right after the
        warm pass (before the per-identifier loop) so the job shows movement
        instead of a stuck 0%.
        """
        identifiers = [f"T{i}" for i in range(6)]  # >= ASYNC_THRESHOLD

        # _run_batch_job does `from app.utils.yfinance_utils import
        # warm_price_cache_bulk` at call time, so patch it at the source.
        from app.utils import yfinance_utils
        monkeypatch.setattr(
            yfinance_utils, "warm_price_cache_bulk",
            lambda ids: {"attempted": ids, "warmed": ids[:4],
                         "fallback": ids[4:], "duration": 2.0},
        )

        progress_writes = []
        monkeypatch.setattr(
            batch_processing, "_update_job_progress_background",
            lambda job_id, progress: progress_writes.append(progress),
        )
        # Don't actually run the pool; just capture the floor it's handed.
        async_calls = {}

        def fake_async(app_, job_id, ids, total, progress_floor=0):
            async_calls["progress_floor"] = progress_floor

        monkeypatch.setattr(batch_processing, "_run_batch_async", fake_async)

        batch_processing._run_batch_job(app, "job-1", identifiers)

        assert progress_writes and progress_writes[0] == 4, (
            f"expected an immediate progress write of 4 warmed items, got {progress_writes}"
        )
        assert async_calls["progress_floor"] == 4

    def test_loop_progress_never_regresses_below_floor(self, app, db, monkeypatch):
        """
        The per-identifier loop must never write a progress value below the
        warm floor, even on its first (early) throttled update.
        """
        # Force the throttle to fire on every iteration by advancing the
        # module's time reference each call.
        ticks = iter(range(0, 1000, 5))  # 0,5,10,... always > 2s apart
        monkeypatch.setattr(batch_processing.time, "time", lambda: next(ticks))

        monkeypatch.setattr(
            batch_processing, "_process_single_identifier",
            lambda identifier: {"identifier": identifier, "status": "success"},
        )
        monkeypatch.setattr(
            batch_processing, "bulk_update_accounts_last_price_update", lambda ids: 0)
        monkeypatch.setattr(batch_processing, "close_thread_conn", lambda: None)
        monkeypatch.setattr(
            batch_processing, "_update_job_final_background", lambda *a, **k: None)

        progress_writes = []
        monkeypatch.setattr(
            batch_processing, "_update_job_progress_background",
            lambda job_id, progress: progress_writes.append(progress),
        )

        # 3 items, warm floor of 4 (e.g. some warmed items already counted).
        with app.app_context():
            batch_processing._run_batch_sync("job-2", ["A", "B", "C"], 3, progress_floor=4)

        assert progress_writes, "expected throttled progress writes"
        assert min(progress_writes) >= 4, (
            f"progress regressed below the warm floor: {progress_writes}"
        )
