"""Account-scoped persistence for monthly decision-review aggregates."""

import json
import logging
import sqlite3
from typing import Any, Dict, List, Optional

from app.db_manager import get_db


logger = logging.getLogger(__name__)


class MonthlyReviewRepository:
    """Store one versioned JSON aggregate per monthly review."""

    _SUMMARY_COLUMNS = """
        id, account_id, source_job_id, period, previous_review_id,
        status, version,
        CAST(created_at AS TEXT) AS created_at,
        CAST(updated_at AS TEXT) AS updated_at,
        CAST(completed_at AS TEXT) AS completed_at
    """
    _FULL_COLUMNS = _SUMMARY_COLUMNS + ", payload"

    @staticmethod
    def _serialize_payload(payload: Dict[str, Any]) -> str:
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)

    @staticmethod
    def _row_to_review(row) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        review = dict(row)
        if "payload" in review:
            review["payload"] = json.loads(review["payload"])
        return review

    @classmethod
    def list_summaries(cls, account_id: int) -> List[Dict[str, Any]]:
        rows = get_db().execute(
            f"""SELECT {cls._SUMMARY_COLUMNS}
                FROM monthly_reviews
                WHERE account_id = ?
                ORDER BY created_at DESC, id DESC""",
            [account_id],
        ).fetchall()
        return [dict(row) for row in rows]

    @classmethod
    def get_by_id(cls, review_id: int, account_id: int) -> Optional[Dict[str, Any]]:
        row = get_db().execute(
            f"""SELECT {cls._FULL_COLUMNS}
                FROM monthly_reviews
                WHERE id = ? AND account_id = ?""",
            [review_id, account_id],
        ).fetchone()
        return cls._row_to_review(row)

    @classmethod
    def get_newest_draft(cls, account_id: int) -> Optional[Dict[str, Any]]:
        row = get_db().execute(
            f"""SELECT {cls._FULL_COLUMNS}
                FROM monthly_reviews
                WHERE account_id = ? AND status = 'draft'
                ORDER BY created_at DESC, id DESC
                LIMIT 1""",
            [account_id],
        ).fetchone()
        return cls._row_to_review(row)

    @classmethod
    def get_latest_completed(cls, account_id: int) -> Optional[Dict[str, Any]]:
        row = get_db().execute(
            f"""SELECT {cls._FULL_COLUMNS}
                FROM monthly_reviews
                WHERE account_id = ? AND status = 'completed'
                ORDER BY completed_at DESC, id DESC
                LIMIT 1""",
            [account_id],
        ).fetchone()
        return cls._row_to_review(row)

    @classmethod
    def create(
        cls,
        account_id: int,
        period: str,
        payload: Dict[str, Any],
        source_job_id: Optional[str] = None,
        previous_review_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create a draft, returning the existing draft for the same account/job."""
        db = get_db()
        payload_json = cls._serialize_payload(payload)

        if source_job_id is not None:
            owned_job = db.execute(
                """SELECT 1 FROM background_jobs
                   WHERE id = ? AND account_id = ?""",
                [source_job_id, account_id],
            ).fetchone()
            if owned_job is None:
                raise ValueError("source job does not belong to the account")

            existing = db.execute(
                """SELECT id FROM monthly_reviews
                   WHERE account_id = ? AND source_job_id = ?""",
                [account_id, source_job_id],
            ).fetchone()
            if existing:
                return cls.get_by_id(existing["id"], account_id)

        if previous_review_id is not None:
            owned_previous = db.execute(
                """SELECT 1 FROM monthly_reviews
                   WHERE id = ? AND account_id = ?""",
                [previous_review_id, account_id],
            ).fetchone()
            if owned_previous is None:
                raise ValueError("previous review does not belong to the account")

        try:
            with db:
                cursor = db.execute(
                    """INSERT INTO monthly_reviews
                       (account_id, source_job_id, period, previous_review_id, payload)
                       VALUES (?, ?, ?, ?, ?)""",
                    [account_id, source_job_id, period, previous_review_id, payload_json],
                )
                review_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            if source_job_id is None:
                raise
            existing = db.execute(
                """SELECT id FROM monthly_reviews
                   WHERE account_id = ? AND source_job_id = ?""",
                [account_id, source_job_id],
            ).fetchone()
            if existing is None:
                raise
            review_id = existing["id"]

        review = cls.get_by_id(review_id, account_id)
        if review is None:
            raise RuntimeError("Monthly review creation did not persist a readable row")
        return review

    @classmethod
    def update_draft(
        cls,
        review_id: int,
        account_id: int,
        expected_version: int,
        payload: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        db = get_db()
        with db:
            cursor = db.execute(
                """UPDATE monthly_reviews
                   SET payload = ?, version = version + 1,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND account_id = ?
                     AND status = 'draft' AND version = ?""",
                [
                    cls._serialize_payload(payload),
                    review_id,
                    account_id,
                    expected_version,
                ],
            )
        if cursor.rowcount != 1:
            return None
        return cls.get_by_id(review_id, account_id)

    @classmethod
    def complete(
        cls,
        review_id: int,
        account_id: int,
        expected_version: int,
        payload: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Atomically freeze a draft payload and transition it to completed."""
        db = get_db()
        with db:
            cursor = db.execute(
                """UPDATE monthly_reviews
                   SET payload = ?, status = 'completed', version = version + 1,
                       updated_at = CURRENT_TIMESTAMP,
                       completed_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND account_id = ?
                     AND status = 'draft' AND version = ?""",
                [
                    cls._serialize_payload(payload),
                    review_id,
                    account_id,
                    expected_version,
                ],
            )
        if cursor.rowcount != 1:
            return None
        return cls.get_by_id(review_id, account_id)
