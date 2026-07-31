"""Focused schema and v23 -> v24 migration coverage."""

import sqlite3

import pytest

from tests.conftest import seed_account


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
