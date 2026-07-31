import json

import pytest

from tests.conftest import seed_account


def test_ambiguous_csv_format_is_rejected():
    from app.utils.csv_processing.parser import detect_csv_format

    with pytest.raises(ValueError, match="Unable to determine CSV format"):
        detect_csv_format("foo,bar\n1,2\n")


def test_unknown_transaction_type_is_rejected():
    from app.utils.csv_processing.parser import _normalize_transaction_type

    with pytest.raises(ValueError, match="Unknown transaction type"):
        _normalize_transaction_type("mystery-type")


def test_invalid_replace_row_fails_before_backup_or_mutation(app, db, monkeypatch):
    import app.utils.portfolio_processing as portfolio_processing
    from tests.conftest import seed_company, seed_portfolio, seed_shares

    account_id = seed_account(db, "replace")
    portfolio_id = seed_portfolio(db, account_id)
    company_id = seed_company(db, account_id, portfolio_id, "Keep Me", "KEEP")
    seed_shares(db, company_id, 3)
    db.commit()
    monkeypatch.setattr(
        portfolio_processing,
        "backup_database",
        lambda **kw: (_ for _ in ()).throw(AssertionError("backup should not run")),
    )
    invalid = (
        "date;price;shares;type;holdingname;identifier\n"
        "01.07.2026;10;not-a-number;buy;Bad;BAD\n"
    )

    with app.app_context():
        success, message, _ = portfolio_processing.process_csv_data(
            account_id, invalid, mode="replace"
        )

    assert success is False
    assert "Invalid holding row" in message
    assert db.execute(
        "SELECT COUNT(*) AS c FROM companies WHERE id = ?", (company_id,)
    ).fetchone()["c"] == 1


def test_ibkr_filtering_is_retained_as_receipt_warning():
    from app.utils.csv_processing.parser import parse_csv_with_summary

    csv = (
        "CurrencyPrimary,AssetClass,Symbol,Description,ISIN,Quantity,MarkPrice\n"
        "USD,CASH,USD,US DOLLAR,,100,1\n"
        "USD,STK,AAPL,APPLE,US0378331005,2,150\n"
    )
    parsed = parse_csv_with_summary(csv)

    assert parsed.skipped_count == 1
    assert "non-equity" in parsed.warnings[0]
    assert list(parsed.dataframe["holdingname"]) == ["APPLE"]


def test_parqet_filtering_is_retained_in_parse_summary():
    from app.utils.csv_processing.parser import parse_csv_with_summary

    csv = (
        "date;price;shares;type;holdingname;identifier\n"
        "01.07.2026;10;1;buy;Good;GOOD\n"
        "02.07.2026;10;1;buy;Missing identifier;\n"
        "03.07.2026;not-a-number;1;buy;Bad price;BAD\n"
    )

    parsed = parse_csv_with_summary(csv)

    assert parsed.skipped_count == 2
    assert parsed.warnings == (
        "Filtered 1 row(s) with empty identifiers",
        "Filtered 1 row(s) with invalid shares or prices",
    )
    assert list(parsed.dataframe["holdingname"]) == ["Good"]


def test_parqet_add_receipt_reports_skipped_malformed_rows(db, monkeypatch):
    from app.utils.portfolio_processing import process_csv_data

    monkeypatch.setattr(
        "app.utils.csv_processing.update_prices_from_csv", lambda *args, **kwargs: []
    )
    account_id = seed_account(db, "parqet-receipt")
    db.commit()
    csv = (
        "date;price;shares;type;holdingname;identifier\n"
        "01.07.2026;10;1;buy;Good;GOOD\n"
        "02.07.2026;10;1;buy;Missing identifier;\n"
        "03.07.2026;not-a-number;1;buy;Bad price;BAD\n"
    )

    success, message, receipt = process_csv_data(account_id, csv, mode="add")

    assert success, message
    assert receipt["counts"]["skipped"] == 2
    assert receipt["warnings"] == [
        "Filtered 1 row(s) with empty identifiers",
        "Filtered 1 row(s) with invalid shares or prices",
    ]


def test_identifier_rename_matches_existing_company(db):
    from app.utils.csv_processing.company_processor import process_companies
    from tests.conftest import seed_company, seed_portfolio
    import pandas as pd

    account_id = seed_account(db, "identity")
    portfolio_id = seed_portfolio(db, account_id)
    company_id = seed_company(db, account_id, portfolio_id, "Old Name", "SAME")
    db.commit()
    dataframe = pd.DataFrame([{
        "holdingname": "New Name", "identifier": "SAME", "type": "buy",
        "shares": 1, "price": 10, "fee": 0, "tax": 0,
        "parsed_date": pd.Timestamp("2026-07-01"),
    }])

    existing, _ = process_companies(dataframe, account_id, db.cursor())

    assert existing["New Name"]["id"] == company_id
    assert db.execute(
        "SELECT name FROM companies WHERE id = ?", (company_id,)
    ).fetchone()["name"] == "New Name"


def test_same_name_with_different_identifier_is_rejected(db):
    from app.utils.csv_processing.company_processor import process_companies
    from tests.conftest import seed_company, seed_portfolio
    import pandas as pd

    account_id = seed_account(db, "collision")
    portfolio_id = seed_portfolio(db, account_id)
    seed_company(db, account_id, portfolio_id, "Same Name", "OLD")
    db.commit()
    dataframe = pd.DataFrame([{
        "holdingname": "Same Name", "identifier": "NEW", "type": "buy",
        "shares": 1, "price": 10, "fee": 0, "tax": 0,
        "parsed_date": pd.Timestamp("2026-07-01"),
    }])

    with pytest.raises(ValueError, match="identity collision"):
        process_companies(dataframe, account_id, db.cursor())


def test_csv_worker_builds_versioned_terminal_receipt(app, monkeypatch):
    import app.utils.batch_processing as batch_processing
    import app.utils.portfolio_processing as portfolio_processing

    monkeypatch.setattr(
        portfolio_processing,
        "process_csv_data_background",
        lambda *args, **kwargs: (
            True,
            "ok",
            {
                "format": "parqet",
                "added": ["A"], "updated": [], "removed": [],
                "counts": {"added": 1}, "failed_prices": ["B"],
                "warnings": ["Protected 1 holding"],
            },
        ),
    )
    captured = {}
    monkeypatch.setattr(
        batch_processing,
        "_update_csv_job_final",
        lambda job_id, progress, result, status="completed": captured.update(
            job_id=job_id, progress=progress, result=result, status=status
        ),
    )
    monkeypatch.setattr(
        "app.routes.portfolio_data_api.invalidate_portfolio_cache", lambda account_id: None
    )

    batch_processing._run_csv_job(
        app, 7, "csv", "job-7", mode="replace", filename="june.csv"
    )

    receipt = captured["result"]
    assert captured["status"] == "completed"
    assert receipt["receipt_version"] == 1
    assert receipt["filename"] == "june.csv"
    assert receipt["holdings"]["added"] == ["A"]
    assert receipt["price_failures"] == ["B"]
    assert receipt["completed_at"]


def test_job_status_enforces_account_ownership_and_keeps_receipt(app, db):
    from app.utils.batch_processing import get_job_status

    receipt = {
        "receipt_version": 1,
        "source_format": "parqet",
        "mode": "replace",
        "filename": "june.csv",
        "holdings": {"added": ["A"], "updated": [], "removed": []},
        "counts": {"added": 1, "updated": 0, "removed": 0},
        "price_failures": [],
        "warnings": [],
        "completed_at": "2026-07-19T10:00:00+00:00",
    }
    account_id = seed_account(db, "owner")
    other_account_id = seed_account(db, "other")
    db.execute(
        """INSERT INTO background_jobs
           (id, name, account_id, status, progress, total, result)
           VALUES (?, 'csv_upload', ?, 'completed', 100, 100, ?)""",
        ("csv-owned", account_id, json.dumps(receipt)),
    )
    db.commit()

    with app.app_context():
        assert get_job_status("csv-owned", account_id=other_account_id)["status"] == "not_found"
        first = get_job_status("csv-owned", account_id=account_id)
        second = get_job_status("csv-owned", account_id=account_id)

    assert first["results"] == receipt
    assert second["results"] == receipt


def test_start_csv_job_records_account_filename_and_rejects_concurrent(
    app, db, monkeypatch
):
    import app.utils.batch_processing as batch_processing

    class FakeThread:
        daemon = False

        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def start(self):
            return None

    monkeypatch.setattr(batch_processing.threading, "Thread", FakeThread)
    account_id = seed_account(db, "jobs")
    db.commit()

    with app.app_context():
        job_id = batch_processing.start_csv_processing_job(
            account_id, "csv", mode="replace", filename="june.csv"
        )
        with pytest.raises(ValueError, match="already active"):
            batch_processing.start_csv_processing_job(
                account_id, "csv", mode="replace", filename="july.csv"
            )

    row = db.execute(
        "SELECT account_id, result FROM background_jobs WHERE id = ?", (job_id,)
    ).fetchone()
    assert row["account_id"] == account_id
    assert json.loads(row["result"])["filename"] == "june.csv"


def test_thread_start_failure_terminalizes_job_and_allows_retry(app, db, monkeypatch):
    import app.utils.batch_processing as batch_processing

    starts = 0

    class FakeThread:
        daemon = False

        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def start(self):
            nonlocal starts
            starts += 1
            if starts == 1:
                raise RuntimeError("thread capacity exhausted")

    monkeypatch.setattr(batch_processing.threading, "Thread", FakeThread)
    account_id = seed_account(db, "thread-start-retry")
    db.commit()

    with app.app_context():
        with pytest.raises(RuntimeError, match="thread capacity exhausted"):
            batch_processing.start_csv_processing_job(
                account_id, "csv", mode="replace", filename="june.csv"
            )
        retry_job_id = batch_processing.start_csv_processing_job(
            account_id, "csv", mode="replace", filename="july.csv"
        )

    rows = db.execute(
        """SELECT id, status, result FROM background_jobs
           WHERE account_id = ? ORDER BY created_at, id""",
        (account_id,),
    ).fetchall()
    failed_row = next(row for row in rows if row["id"] != retry_job_id)
    receipt = json.loads(failed_row["result"])

    assert failed_row["status"] == "failed"
    assert receipt["receipt_version"] == 1
    assert receipt["filename"] == "june.csv"
    assert receipt["mode"] == "replace"
    assert receipt["retryable"] is True
    assert "thread capacity exhausted" in receipt["message"]


def test_stale_csv_jobs_are_marked_interrupted(app, db):
    from app.utils.batch_processing import interrupt_stale_csv_jobs

    account_id = seed_account(db, "stale")
    db.execute(
        """INSERT INTO background_jobs
           (id, name, account_id, status, progress, total, result)
           VALUES ('stale-csv', 'csv_upload', ?, 'processing', 42, 100, 'working')""",
        (account_id,),
    )
    db.execute(
        """INSERT INTO background_jobs
           (id, name, status, progress, total, result)
           VALUES ('price-job', 'price_update', 'processing', 42, 100, 'working')"""
    )
    db.commit()

    with app.app_context():
        assert interrupt_stale_csv_jobs() == 1

    csv_row = db.execute(
        "SELECT status, result FROM background_jobs WHERE id = 'stale-csv'"
    ).fetchone()
    price_row = db.execute(
        "SELECT status FROM background_jobs WHERE id = 'price-job'"
    ).fetchone()
    assert csv_row["status"] == "failed"
    assert "interrupted" in json.loads(csv_row["result"])["message"].lower()
    assert price_row["status"] == "processing"
