"""Focused schema and v23 -> v24 migration coverage."""

import sqlite3
from pathlib import Path

import pytest

from tests.conftest import seed_account

REPO_ROOT = Path(__file__).resolve().parents[1]


def _columns(db, table):
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def _indexes(db, table):
    return {row[1] for row in db.execute(f"PRAGMA index_list({table})")}


def test_fresh_schema_has_account_owned_jobs_and_monthly_reviews(db):
    assert "account_id" in _columns(db, "background_jobs")
    assert {
        "id",
        "account_id",
        "source_job_id",
        "period",
        "previous_review_id",
        "status",
        "version",
        "payload",
        "created_at",
        "updated_at",
        "completed_at",
    } <= _columns(db, "monthly_reviews")

    assert "idx_background_jobs_account_status" in _indexes(db, "background_jobs")
    assert "uq_background_jobs_active_account" in _indexes(db, "background_jobs")
    assert {
        "idx_monthly_reviews_account_status_created",
        "idx_monthly_reviews_account_completed",
        "uq_monthly_reviews_account_source_job",
    } <= _indexes(db, "monthly_reviews")


def test_active_account_job_uniqueness_is_atomic(db):
    account_id = seed_account(db)
    # Generic price jobs remain global and are not subject to the CSV guard.
    db.execute(
        "INSERT INTO background_jobs (id, name, status) VALUES (?, ?, ?)",
        ["price-1", "price refresh", "pending"],
    )
    db.execute(
        "INSERT INTO background_jobs (id, name, status) VALUES (?, ?, ?)",
        ["price-2", "price refresh", "processing"],
    )
    db.execute(
        "INSERT INTO background_jobs (id, name, status, account_id) VALUES (?, ?, ?, ?)",
        ["job-1", "CSV import", "pending", account_id],
    )

    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO background_jobs (id, name, status, account_id) VALUES (?, ?, ?, ?)",
            ["job-2", "CSV import", "processing", account_id],
        )

    db.execute("UPDATE background_jobs SET status = 'completed' WHERE id = 'job-1'")
    db.execute(
        "INSERT INTO background_jobs (id, name, status, account_id) VALUES (?, ?, ?, ?)",
        ["job-2", "CSV import", "processing", account_id],
    )


def _create_v23_database(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        PRAGMA foreign_keys = ON;
        CREATE TABLE accounts (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE background_jobs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            result TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO schema_version (version) VALUES (23);
        INSERT INTO accounts (id, username, created_at) VALUES (1, 'legacy', datetime('now'));
        INSERT INTO background_jobs (id, name, status) VALUES ('price-job', 'price refresh', 'completed');
        """
    )
    db.commit()
    db.close()


def test_v23_migrates_once_to_v24_and_repeat_is_noop(app, tmp_path):
    from app import db_manager

    db_path = tmp_path / "legacy-v23.db"
    _create_v23_database(db_path)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"

    with app.app_context():
        db_manager.set_db_path(str(db_path))
        db_manager.migrate_database()
        conn = db_manager.get_db()

        assert conn.execute("SELECT version FROM schema_version").fetchone()[0] == 24
        assert "account_id" in _columns(conn, "background_jobs")
        assert conn.execute(
            "SELECT account_id FROM background_jobs WHERE id = 'price-job'"
        ).fetchone()[0] is None
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'monthly_reviews'"
        ).fetchone()

        schema_before = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'monthly_reviews'"
        ).fetchone()[0]
        db_manager.migrate_database()
        schema_after = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'monthly_reviews'"
        ).fetchone()[0]

        assert schema_after == schema_before
        assert conn.execute("SELECT version FROM schema_version").fetchone()[0] == 24


def test_init_db_boots_on_a_v23_database(app, tmp_path):
    """The full startup path, not just migrate_database().

    schema.sql only CREATEs — it cannot add a column to an existing table — so
    it has to run AFTER migrations. Applying it first made startup die with
    "no such column: account_id" on any pre-v24 database, because
    uq_background_jobs_active_account indexes a column migration 24 adds.
    """
    from app import db_manager

    db_path = tmp_path / "legacy-v23.db"
    _create_v23_database(db_path)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.root_path = str(REPO_ROOT / "app")

    db_manager.init_db(app)

    with app.app_context():
        db_manager.set_db_path(str(db_path))
        conn = db_manager.get_db()
        assert conn.execute("SELECT version FROM schema_version").fetchone()[0] == 24
        assert "account_id" in _columns(conn, "background_jobs")
        assert "uq_background_jobs_active_account" in _indexes(conn, "background_jobs")
        assert "idx_monthly_reviews_account_completed" in _indexes(conn, "monthly_reviews")


def test_init_db_stamps_a_new_database_at_the_latest_version(app, tmp_path):
    """A database built from the current schema.sql needs no migration replay."""
    from app import db_manager

    db_path = tmp_path / "brand-new.db"
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.root_path = str(REPO_ROOT / "app")

    db_manager.init_db(app)

    with app.app_context():
        db_manager.set_db_path(str(db_path))
        conn = db_manager.get_db()
        version = conn.execute("SELECT version FROM schema_version").fetchone()[0]
        assert version == db_manager.LATEST_SCHEMA_VERSION
        assert "monthly_reviews" in {
            r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }


def test_pre_v23_database_is_refused_not_half_migrated(app, tmp_path):
    """Migrations 1-23 were removed as unreachable (see migrate_database).

    A database below MIN_MIGRATABLE_VERSION must fail loudly and name the commit
    that still has the chain — never boot on a schema this build cannot complete.
    """
    from app import db_manager

    db_path = tmp_path / "ancient.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT, created_at TEXT);
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMP);
        INSERT INTO schema_version (version) VALUES (22);
        """
    )
    conn.commit()
    conn.close()

    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.root_path = str(REPO_ROOT / "app")

    with pytest.raises(Exception) as excinfo:
        db_manager.init_db(app)

    message = str(excinfo.value)
    assert "22" in message
    assert str(db_manager.MIN_MIGRATABLE_VERSION) in message
    assert "4226f05" in message, "the guard must name the commit holding the old chain"


def test_min_migratable_is_not_above_latest(app):
    from app import db_manager

    assert db_manager.MIN_MIGRATABLE_VERSION <= db_manager.LATEST_SCHEMA_VERSION
