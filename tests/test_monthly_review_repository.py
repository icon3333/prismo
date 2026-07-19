"""Account-scoped monthly-review repository and lifecycle coverage."""

import io
import json

import pytest

from tests.conftest import seed_account


def _payload(label):
    return {"payload_version": 1, "label": label}


def _seed_review(db, account_id, source_job_id="job-1", period="2026-07"):
    from app.repositories.monthly_review_repository import MonthlyReviewRepository

    db.execute(
        """INSERT INTO background_jobs (id, name, status, account_id)
           VALUES (?, 'CSV import', 'completed', ?)""",
        [source_job_id, account_id],
    )
    return MonthlyReviewRepository.create(
        account_id=account_id,
        source_job_id=source_job_id,
        period=period,
        payload=_payload(source_job_id),
    )


def test_duplicate_account_job_create_returns_original_review(db):
    from app.repositories.monthly_review_repository import MonthlyReviewRepository

    account_id = seed_account(db)
    db.execute(
        """INSERT INTO background_jobs (id, name, status, account_id)
           VALUES ('job-1', 'CSV import', 'completed', ?)""",
        [account_id],
    )

    original = MonthlyReviewRepository.create(
        account_id, "2026-07", _payload("original"), source_job_id="job-1"
    )
    duplicate = MonthlyReviewRepository.create(
        account_id, "2026-08", _payload("replacement"), source_job_id="job-1"
    )

    assert duplicate["id"] == original["id"]
    assert duplicate["period"] == "2026-07"
    assert duplicate["payload"] == _payload("original")
    assert db.execute("SELECT COUNT(*) FROM monthly_reviews").fetchone()[0] == 1


def test_create_rejects_another_accounts_job_and_previous_review(db):
    from app.repositories.monthly_review_repository import MonthlyReviewRepository

    owner_id = seed_account(db, "owner")
    other_id = seed_account(db, "other")
    owner_review = _seed_review(db, owner_id)

    with pytest.raises(ValueError, match="source job"):
        MonthlyReviewRepository.create(
            other_id,
            "2026-08",
            _payload("foreign-job"),
            source_job_id="job-1",
        )

    with pytest.raises(ValueError, match="previous review"):
        MonthlyReviewRepository.create(
            other_id,
            "2026-08",
            _payload("foreign-review"),
            previous_review_id=owner_review["id"],
        )


def test_reads_writes_and_completion_are_account_scoped_and_versioned(db):
    from app.repositories.monthly_review_repository import MonthlyReviewRepository

    owner_id = seed_account(db, "owner")
    other_id = seed_account(db, "other")
    review = _seed_review(db, owner_id)

    assert MonthlyReviewRepository.get_by_id(review["id"], other_id) is None
    assert MonthlyReviewRepository.update_draft(
        review["id"], other_id, 1, _payload("hijack")
    ) is None
    assert MonthlyReviewRepository.complete(
        review["id"], other_id, 1, _payload("hijack")
    ) is None

    assert MonthlyReviewRepository.update_draft(
        review["id"], owner_id, 99, _payload("stale")
    ) is None
    updated = MonthlyReviewRepository.update_draft(
        review["id"], owner_id, 1, _payload("updated")
    )
    assert updated["version"] == 2
    assert updated["payload"] == _payload("updated")

    completed = MonthlyReviewRepository.complete(
        review["id"], owner_id, 2, _payload("completed")
    )
    assert completed["status"] == "completed"
    assert completed["version"] == 3
    assert completed["completed_at"] is not None
    assert MonthlyReviewRepository.update_draft(
        review["id"], owner_id, 3, _payload("too late")
    ) is None
    assert MonthlyReviewRepository.complete(
        review["id"], owner_id, 3, _payload("again")
    ) is None


def test_draft_and_completed_ordering_is_deterministic(db):
    from app.repositories.monthly_review_repository import MonthlyReviewRepository

    account_id = seed_account(db)
    older = MonthlyReviewRepository.create(account_id, "2026-05", _payload("older"))
    newer = MonthlyReviewRepository.create(account_id, "2026-06", _payload("newer"))
    db.execute(
        "UPDATE monthly_reviews SET created_at = '2026-07-01 00:00:00' WHERE account_id = ?",
        [account_id],
    )

    assert MonthlyReviewRepository.get_newest_draft(account_id)["id"] == newer["id"]
    summaries = MonthlyReviewRepository.list_summaries(account_id)
    assert [item["id"] for item in summaries] == [newer["id"], older["id"]]
    assert all("payload" not in item for item in summaries)

    first_completed = MonthlyReviewRepository.complete(
        older["id"], account_id, 1, _payload("first")
    )
    second_completed = MonthlyReviewRepository.complete(
        newer["id"], account_id, 1, _payload("second")
    )
    db.execute(
        "UPDATE monthly_reviews SET completed_at = '2026-07-02 00:00:00' WHERE account_id = ?",
        [account_id],
    )

    latest = MonthlyReviewRepository.get_latest_completed(account_id)
    assert latest["id"] == second_completed["id"]
    assert first_completed["status"] == "completed"


def test_account_repository_delete_clears_reviews_and_owned_jobs(db):
    from app.repositories.account_repository import AccountRepository

    account_id = seed_account(db)
    _seed_review(db, account_id)

    assert AccountRepository.delete(account_id) is True
    assert db.execute(
        "SELECT COUNT(*) FROM monthly_reviews WHERE account_id = ?", [account_id]
    ).fetchone()[0] == 0
    assert db.execute(
        "SELECT COUNT(*) FROM background_jobs WHERE account_id = ?", [account_id]
    ).fetchone()[0] == 0


def test_account_delete_route_clears_reviews_and_owned_jobs(app, db, monkeypatch):
    from app.routes import portfolio_account_api

    app.secret_key = "test-secret"
    account_id = seed_account(db)
    _seed_review(db, account_id)
    monkeypatch.setattr(portfolio_account_api, "backup_database", lambda: True)

    with app.test_request_context(json={"confirmation": "DELETE"}):
        from flask import session

        session["account_id"] = account_id
        response = portfolio_account_api.api_delete_account()

    assert response.get_json()["success"] is True
    assert db.execute(
        "SELECT COUNT(*) FROM monthly_reviews WHERE account_id = ?", [account_id]
    ).fetchone()[0] == 0
    assert db.execute(
        "SELECT COUNT(*) FROM background_jobs WHERE account_id = ?", [account_id]
    ).fetchone()[0] == 0


def test_full_account_data_replacement_clears_reviews_and_owned_jobs(
    app, db, monkeypatch
):
    from app.routes import portfolio_account_api

    app.secret_key = "test-secret"
    account_id = seed_account(db)
    _seed_review(db, account_id)
    monkeypatch.setattr(portfolio_account_api, "backup_database", lambda: True)
    export = {"export_version": 1, "data": {}}

    with app.test_request_context(
        data={"file": (io.BytesIO(json.dumps(export).encode()), "account.json")},
        content_type="multipart/form-data",
    ):
        from flask import session

        session["account_id"] = account_id
        response = portfolio_account_api.api_import_account_data()

    assert response.get_json()["success"] is True
    assert db.execute(
        "SELECT COUNT(*) FROM monthly_reviews WHERE account_id = ?", [account_id]
    ).fetchone()[0] == 0
    assert db.execute(
        "SELECT COUNT(*) FROM background_jobs WHERE account_id = ?", [account_id]
    ).fetchone()[0] == 0
