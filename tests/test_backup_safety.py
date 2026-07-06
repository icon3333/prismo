"""
Data-safety tests: WAL-safe database backups and the pre-import safety
snapshot that guards destructive (replace-mode) CSV imports.
"""

import os
import sqlite3

import pytest

from tests.conftest import (
    seed_account,
    seed_company,
    seed_portfolio,
    seed_shares,
)

# Minimal valid Parqet export (semicolon-delimited, decimal comma)
PARQET_CSV = (
    "identifier;holdingname;shares;price;type;date\n"
    "AAPL;Apple;10;100,0;buy;2023-01-01\n"
)


@pytest.fixture
def backup_dir(app, tmp_path):
    path = tmp_path / "backups"
    app.config["DB_BACKUP_DIR"] = str(path)
    app.config["MAX_BACKUP_FILES"] = 10
    return path


class TestBackupDatabase:
    def test_backup_is_valid_and_contains_wal_only_data(self, app, db, backup_dir):
        """The backup must include committed rows that still live only in the
        WAL, taken while the source connection is open."""
        from app.db_manager import backup_database

        account_id = seed_account(db)
        db.commit()

        db_path = app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")
        wal_path = db_path + "-wal"
        # Precondition for the regression this guards: the commit sits in the
        # WAL (not yet checkpointed into the main file), which a plain file
        # copy of the .db would silently lose.
        assert os.path.exists(wal_path)
        assert os.path.getsize(wal_path) > 0

        backup_file = backup_database()  # source connection `db` still open
        assert backup_file is not None
        assert os.path.basename(backup_file).startswith("backup_")
        assert backup_file.endswith(".db")

        copy = sqlite3.connect(backup_file)
        try:
            assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            count = copy.execute(
                "SELECT COUNT(*) FROM accounts WHERE id = ?", [account_id]
            ).fetchone()[0]
            assert count == 1
        finally:
            copy.close()

    def test_backup_returns_none_when_database_missing(self, app, backup_dir):
        from app.db_manager import backup_database

        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
            str(backup_dir), "does-not-exist.db"
        )
        with app.app_context():
            assert backup_database() is None
        # No empty/partial snapshot may be left behind
        leftovers = os.listdir(backup_dir) if os.path.isdir(backup_dir) else []
        assert [f for f in leftovers if f.endswith(".db")] == []

    def test_prefix_controls_filename(self, app, db, backup_dir):
        from app.db_manager import backup_database

        seed_account(db)
        db.commit()
        backup_file = backup_database(prefix="pre_import")
        assert backup_file is not None
        assert os.path.basename(backup_file).startswith("pre_import_")

    def test_cleanup_is_scoped_to_prefix(self, app, db, backup_dir):
        """Retention caps each prefix separately: creating a 'backup' file
        evicts the oldest 'backup' file but never touches 'pre_import' ones."""
        from app.db_manager import backup_database

        app.config["MAX_BACKUP_FILES"] = 2
        seed_account(db)
        db.commit()

        backup_dir.mkdir(parents=True, exist_ok=True)
        for name, mtime in [
            ("backup_20200101_000000.db", 1),
            ("backup_20200102_000000.db", 2),
            ("pre_import_20200101_000000.db", 1),
        ]:
            f = backup_dir / name
            f.write_bytes(b"")
            os.utime(f, (mtime, mtime))

        assert backup_database() is not None

        remaining = {f for f in os.listdir(backup_dir) if f.endswith(".db")}
        assert "pre_import_20200101_000000.db" in remaining
        assert "backup_20200101_000000.db" not in remaining  # oldest evicted
        assert len([f for f in remaining if f.startswith("backup_")]) == 2


@pytest.fixture
def no_price_fetch(monkeypatch):
    """CSV import ends with a yfinance batch; keep tests offline."""
    monkeypatch.setattr(
        "app.utils.csv_processing.update_prices_from_csv", lambda *a, **k: []
    )


@pytest.fixture
def backup_calls(monkeypatch, no_price_fetch):
    """Record backup_database calls made by the import pipeline."""
    calls = []

    def fake_backup(prefix="backup"):
        calls.append(prefix)
        return f"/tmp/{prefix}_fake.db"

    monkeypatch.setattr("app.utils.portfolio_processing.backup_database", fake_backup)
    return calls


class TestPreImportBackup:
    def test_replace_mode_takes_pre_import_backup(self, db, backup_calls):
        from app.utils.portfolio_processing import process_csv_data

        account_id = seed_account(db)
        db.commit()

        success, message, details = process_csv_data(
            account_id, PARQET_CSV, mode="replace"
        )
        assert success, message
        assert backup_calls == ["pre_import"]
        assert details["added"] == ["Apple"]

    def test_add_mode_skips_backup(self, db, backup_calls):
        from app.utils.portfolio_processing import process_csv_data

        account_id = seed_account(db)
        db.commit()

        success, message, _ = process_csv_data(account_id, PARQET_CSV, mode="add")
        assert success, message
        assert backup_calls == []

    def test_backup_failure_aborts_replace_import_before_deletion(
        self, db, monkeypatch, no_price_fetch
    ):
        from app.utils.portfolio_processing import process_csv_data

        monkeypatch.setattr(
            "app.utils.portfolio_processing.backup_database",
            lambda prefix="backup": None,
        )

        account_id = seed_account(db)
        portfolio_id = seed_portfolio(db, account_id)
        # Not in the CSV -> replace mode would delete it
        cid = seed_company(db, account_id, portfolio_id, "DoomedCo", "DOOM")
        seed_shares(db, cid, 5)
        db.commit()

        success, message, _ = process_csv_data(account_id, PARQET_CSV, mode="replace")
        assert not success
        assert "backup" in message.lower()

        row = db.execute(
            "SELECT COUNT(*) AS c FROM companies WHERE id = ?", [cid]
        ).fetchone()
        assert row["c"] == 1
        # And nothing from the CSV was imported either
        row = db.execute(
            "SELECT COUNT(*) AS c FROM companies WHERE name = 'Apple'"
        ).fetchone()
        assert row["c"] == 0
