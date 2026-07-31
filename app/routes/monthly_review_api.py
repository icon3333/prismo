"""Account-scoped HTTP API for monthly decision reviews."""

from flask import g, request

from app.decorators import require_auth
from app.repositories.monthly_review_repository import MonthlyReviewRepository
from app.services.monthly_review_service import (
    ReviewConflictError,
    ReviewValidationError,
    complete_review,
    create_draft,
    update_draft,
)
from app.utils.response_helpers import error_response, success_response


def _json_body():
    body = request.get_json(silent=True)
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise ReviewValidationError("Request body must be a JSON object")
    return body


def _version(body):
    value = body.get("version")
    if type(value) is not int:
        raise ReviewValidationError("version is required and must be an integer")
    if value < 1:
        raise ReviewValidationError("version must be positive")
    return value


def _review_error(exc):
    if isinstance(exc, KeyError):
        return error_response("Monthly review not found", 404, error_code="review_not_found")
    if isinstance(exc, ReviewConflictError):
        return error_response(str(exc), 409, error_code="review_conflict")
    if isinstance(exc, ReviewValidationError):
        return error_response(str(exc), 422, error_code="review_validation")
    raise exc


@require_auth
def list_monthly_reviews():
    return success_response(
        {"reviews": MonthlyReviewRepository.list_summaries(g.account_id)}
    )


@require_auth
def create_monthly_review():
    try:
        body = _json_body()
        allowed = {"source_job_id", "period"}
        unexpected = set(body) - allowed
        if unexpected:
            raise ReviewValidationError(
                f"Unsupported fields: {', '.join(sorted(unexpected))}"
            )
        review = create_draft(
            g.account_id,
            source_job_id=body.get("source_job_id"),
            period=body.get("period"),
        )
        return success_response({"review": review}, status=201)
    except (KeyError, ReviewConflictError, ReviewValidationError) as exc:
        return _review_error(exc)


@require_auth
def get_monthly_review(review_id: int):
    review = MonthlyReviewRepository.get_by_id(review_id, g.account_id)
    if review is None:
        return error_response(
            "Monthly review not found", 404, error_code="review_not_found"
        )
    return success_response({"review": review})


@require_auth
def patch_monthly_review(review_id: int):
    try:
        body = _json_body()
        version = _version(body)
        changes = dict(body)
        changes.pop("version", None)
        if not changes:
            raise ReviewValidationError("At least one review change is required")
        review = update_draft(review_id, g.account_id, version, changes)
        return success_response({"review": review})
    except (KeyError, ReviewConflictError, ReviewValidationError) as exc:
        return _review_error(exc)


@require_auth
def complete_monthly_review(review_id: int):
    try:
        body = _json_body()
        unexpected = set(body) - {"version"}
        if unexpected:
            raise ReviewValidationError(
                f"Unsupported fields: {', '.join(sorted(unexpected))}"
            )
        review = complete_review(review_id, g.account_id, _version(body))
        return success_response({"review": review})
    except (KeyError, ReviewConflictError, ReviewValidationError) as exc:
        return _review_error(exc)
