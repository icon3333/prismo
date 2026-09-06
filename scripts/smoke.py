#!/usr/bin/env python3
"""Boot Prismo for real — against a COPY of the live database, and a fresh one.

Why this exists as well as the test suite: the unit tests build their database
from app/schema.sql, so they only ever exercise the fresh-install path. A
startup-blocking bug once reached main because of that — schema.sql ran before
migrate_database(), so its newer index referenced a column an older database
did not have yet. Every test passed; the app could not start on the real file.

This never writes to instance/portfolio.db. It copies it first, every time.

Usage:
    python3 scripts/smoke.py
    python3 scripts/smoke.py --db path/to/other.db
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LIVE_DB = REPO_ROOT / "instance" / "portfolio.db"

sys.path.insert(0, str(REPO_ROOT))

ok, failed = [], []


def check(label: str, condition: bool, detail: str = "") -> None:
    (ok if condition else failed).append(label)
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")


def boot(data_dir: Path, label: str, expect_rows: dict[str, int] | None = None) -> None:
    """Create the app against data_dir and assert the database came up sane."""
    print(f"\n── {label} ──")

    # Both boots share this process and name their thread identically, so track
    # thread objects by identity rather than by name.
    threads_before = {id(t) for t in threading.enumerate()}

    # A fresh import per boot: create_app and db_manager both hold module state.
    for name in [m for m in list(sys.modules) if m.startswith("app") or m == "config"]:
        del sys.modules[name]

    os.environ.update(
        APP_DATA_DIR=str(data_dir),
        DATABASE_URL=f"sqlite:///{data_dir / 'portfolio.db'}",
        FLASK_ENV="production",
    )

    # Keep it offline — the boot pass would otherwise hit yfinance.
    import app.utils.startup_tasks as startup_tasks

    startup_tasks.refresh_exchange_rates_if_needed = lambda: False
    startup_tasks.auto_update_prices_if_needed = lambda: {"status": "skipped"}

    from app.db_manager import LATEST_SCHEMA_VERSION
    from app.main import create_app

    try:
        flask_app = create_app("production")
    except Exception as exc:  # noqa: BLE001 - the whole point is to report it
        check(f"{label}: create_app()", False, f"{type(exc).__name__}: {exc}")
        return

    check(f"{label}: create_app()", True)

    response = flask_app.test_client().get("/health")
    check(f"{label}: GET /health", response.status_code == 200, f"status {response.status_code}")

    conn = sqlite3.connect(data_dir / "portfolio.db")
    try:
        version = conn.execute("SELECT version FROM schema_version").fetchone()[0]
        check(
            f"{label}: schema_version == {LATEST_SCHEMA_VERSION}",
            version == LATEST_SCHEMA_VERSION,
            f"got {version}",
        )

        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"accounts", "portfolios", "companies", "company_shares", "market_prices",
                    "exchange_rates", "simulations", "background_jobs", "monthly_reviews"}
        missing = required - tables
        check(f"{label}: all tables present", not missing, f"missing {sorted(missing)}")

        # schema.sql indexes columns that migrations add; a bad order shows up here.
        job_cols = {r[1] for r in conn.execute("PRAGMA table_info(background_jobs)")}
        check(f"{label}: background_jobs.account_id", "account_id" in job_cols)

        indexes = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite%'")}
        check(f"{label}: uq_background_jobs_active_account",
              "uq_background_jobs_active_account" in indexes)

        if expect_rows:
            for table, expected in expect_rows.items():
                actual = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                check(f"{label}: {table} rows preserved", actual == expected,
                      f"expected {expected}, got {actual}")
    finally:
        conn.close()

    time.sleep(1.5)
    started = [t for t in threading.enumerate()
               if t is not threading.main_thread() and id(t) not in threads_before]
    check(f"{label}: starts exactly one background thread",
          len(started) == 1, str([t.name for t in started]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=LIVE_DB,
                        help="database to copy and boot against (default: instance/portfolio.db)")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="prismo-smoke-") as tmp:
        tmp_path = Path(tmp)

        fresh = tmp_path / "fresh"
        fresh.mkdir()
        boot(fresh, "fresh database")

        if args.db.exists():
            rows = {}
            with sqlite3.connect(args.db) as src:
                for table in ("companies", "portfolios", "accounts", "simulations"):
                    try:
                        rows[table] = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    except sqlite3.Error:
                        pass

            existing = tmp_path / "existing"
            existing.mkdir()
            shutil.copy2(args.db, existing / "portfolio.db")
            boot(existing, f"copy of {args.db.name}", expect_rows=rows)
        else:
            print(f"\n── skipped: {args.db} not found (nothing to copy) ──")

    print(f"\n{len(ok)} passed, {len(failed)} failed")
    for name in failed:
        print(f"  FAILED: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
