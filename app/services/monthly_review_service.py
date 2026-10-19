"""Monthly review persistence and snapshot workflow."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.db_manager import get_db, query_db
from app.repositories.account_repository import AccountRepository
from app.repositories.monthly_review_repository import MonthlyReviewRepository
from app.repositories.portfolio_repository import PortfolioRepository
from app.services.monthly_review_snapshot import (
    ReviewConflictError,
    ReviewValidationError,
    _finite_number,
    apply_action_decision,
    build_recommendations,
    calculate_breaches,
    compare_snapshots,
    evaluate_readiness,
    mutable_input_fingerprint,
    preserve_decisions,
    reconcile_cash,
    reconcile_previous_actions,
)
from app.services.rebalance_service import calculate_detailed_rebalancing
from app.utils.db_utils import utc_now_iso


def _load_builder_inputs(account_id: int) -> Tuple[Any, Dict[str, Any]]:
    rows = query_db(
        """SELECT variable_name, variable_value FROM expanded_state
           WHERE account_id = ? AND page_name = 'builder'
             AND variable_name IN ('portfolios', 'rules')""",
        [account_id],
    ) or []
    values = {row["variable_name"]: row["variable_value"] for row in rows}

    def parsed(name: str, fallback: Any) -> Any:
        try:
            return json.loads(values[name]) if values.get(name) else fallback
        except (TypeError, json.JSONDecodeError):
            return fallback

    return parsed("portfolios", []), parsed("rules", {})


def _load_holdings_uncached(account_id: int) -> List[Dict[str, Any]]:
    method = PortfolioRepository.get_portfolio_data_with_enrichment
    uncached = getattr(method, "uncached", None)
    return (uncached(account_id) if uncached else method(account_id)) or []


def _load_allocation_tree_uncached(account_id: int) -> Dict[str, Any]:
    from app.routes.portfolio_data_api import _get_simulator_portfolio_data_internal

    uncached = getattr(_get_simulator_portfolio_data_internal, "uncached", None)
    return copy.deepcopy(
        (uncached(account_id) if uncached else _get_simulator_portfolio_data_internal(account_id))
    )


def _load_fx_provenance(holdings: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    currencies = {str(item.get("currency") or "EUR").upper() for item in holdings}
    result: Dict[str, Dict[str, Any]] = {"EUR": {"source": "identity", "rate": 1.0}}
    if not currencies - {"EUR"}:
        return result
    placeholders = ",".join("?" for _ in currencies - {"EUR"})
    rows = query_db(
        f"""SELECT from_currency, rate, CAST(last_updated AS TEXT) AS last_updated
            FROM exchange_rates WHERE to_currency = 'EUR'
              AND from_currency IN ({placeholders})""",
        sorted(currencies - {"EUR"}),
    ) or []
    for row in rows:
        result[row["from_currency"]] = {
            "source": "stored",
            "rate": float(row["rate"]),
            "last_updated": row["last_updated"],
        }
    for currency in currencies - set(result):
        result[currency] = {"source": "approximate"}
    return result


def capture_snapshot(account_id: int, receipt: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Capture every frozen input without performing network requests."""
    holdings = _load_holdings_uncached(account_id)
    targets, rules = _load_builder_inputs(account_id)
    cash = float(AccountRepository.get_cash(account_id) or 0)
    allocation_tree = _load_allocation_tree_uncached(account_id)
    fx = _load_fx_provenance(holdings)
    breaches = calculate_breaches(holdings, rules)
    readiness = evaluate_readiness(holdings, allocation_tree, fx)
    if receipt:
        failed_prices = receipt.get("price_failures") or receipt.get("failed_prices") or []
        if failed_prices:
            readiness["warnings"].append(
                {
                    "code": "price_refresh_failures",
                    "items": copy.deepcopy(failed_prices),
                    "message": "One or more prices could not be refreshed during import",
                }
            )
    snapshot = {
        "captured_at": utc_now_iso(),
        "receipt": copy.deepcopy(receipt) if receipt else None,
        "holdings": holdings,
        "targets": targets,
        "rules": rules,
        "cash": cash,
        "allocation_tree": allocation_tree,
        "fx_provenance": fx,
        "breaches": breaches,
        "readiness": readiness,
    }
    snapshot["mutable_fingerprint"] = mutable_input_fingerprint(
        holdings, targets, rules, cash
    )
    return snapshot


def _recompute_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    result = copy.deepcopy(payload)
    snapshot = result["snapshot"]
    inputs = result.setdefault("inputs", {})
    mode = inputs.get("mode", "existing-only")
    contribution = _finite_number(inputs.get("contribution", 0), "contribution", 0)
    deployable = 0.0 if mode == "existing-only" else float(snapshot.get("cash") or 0) + contribution
    previous_recommendations = result.get("recommendations")
    recommendations = build_recommendations(
        snapshot["allocation_tree"], mode, deployable, snapshot.get("holdings")
    )
    recommendations["actions"] = preserve_decisions(
        recommendations["actions"], previous_recommendations
    )
    result["recommendations"] = recommendations
    result["cash_summary"] = reconcile_cash(
        snapshot.get("cash", 0), contribution, recommendations["actions"]
    )
    return result


def create_draft(
    account_id: int,
    source_job_id: Optional[str] = None,
    receipt: Optional[Dict[str, Any]] = None,
    period: Optional[str] = None,
) -> Dict[str, Any]:
    """Capture and idempotently persist one draft for an optional import job."""
    selected_period = period or datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        datetime.strptime(selected_period, "%Y-%m")
    except (TypeError, ValueError) as exc:
        raise ReviewValidationError("period must use YYYY-MM format") from exc
    source_job = None
    supplied_receipt = receipt is not None
    if source_job_id:
        existing = query_db(
            "SELECT id FROM monthly_reviews WHERE account_id = ? AND source_job_id = ?",
            [account_id, source_job_id],
            one=True,
        )
        if existing:
            return MonthlyReviewRepository.get_by_id(existing["id"], account_id)
        source_job = query_db(
            """SELECT status, result FROM background_jobs
               WHERE id = ? AND account_id = ?""",
            [source_job_id, account_id],
            one=True,
        )
        if source_job is None:
            raise ReviewValidationError("Import job was not found for this account")
        if source_job["status"] != "completed" and not (
            source_job["status"] == "processing" and supplied_receipt
        ):
            raise ReviewValidationError("Only a completed import can create a review")
        if receipt is None and source_job.get("result"):
            try:
                stored_result = json.loads(source_job["result"])
            except (TypeError, json.JSONDecodeError):
                stored_result = None
            if isinstance(stored_result, dict):
                receipt = stored_result
    recovering_completed_job = bool(
        source_job_id and source_job and source_job["status"] == "completed"
    )
    if recovering_completed_job:
        receipt = copy.deepcopy(receipt) if isinstance(receipt, dict) else {}
        receipt["review_creation"] = {"status": "recovered"}
    previous = MonthlyReviewRepository.get_latest_completed(account_id)
    snapshot = capture_snapshot(account_id, receipt)
    previous_snapshot = (previous or {}).get("payload", {}).get("snapshot")
    payload = {
        "payload_version": 1,
        "snapshot": snapshot,
        "comparison": compare_snapshots(snapshot, previous_snapshot),
        "reconciliation": {
            "items": reconcile_previous_actions(previous, snapshot),
            "disclaimer": "Best-effort snapshot analysis, not transaction or tax accounting.",
        },
        "inputs": {
            "mode": "existing-only",
            "contribution": 0.0,
            "contribution_label": "Additional contribution not already in account cash",
            "readiness_override": False,
        },
    }
    payload = _recompute_payload(payload)
    review = MonthlyReviewRepository.create(
        account_id=account_id,
        source_job_id=source_job_id,
        period=selected_period,
        previous_review_id=previous["id"] if previous else None,
        payload=payload,
    )
    # Recovery POSTs use the same account/job uniqueness key. Reflect a
    # successful retry in the durable receipt without changing import status.
    if recovering_completed_job:
        stored_receipt = copy.deepcopy(receipt)
        stored_receipt["review_id"] = review["id"]
        db = get_db()
        db.execute(
            "UPDATE background_jobs SET result = ?, updated_at = ? WHERE id = ? AND account_id = ?",
            [json.dumps(stored_receipt), datetime.now(timezone.utc), source_job_id, account_id],
        )
        db.commit()
    return review


def update_draft(
    review_id: int,
    account_id: int,
    expected_version: int,
    changes: Dict[str, Any],
) -> Dict[str, Any]:
    review = MonthlyReviewRepository.get_by_id(review_id, account_id)
    if review is None:
        raise KeyError(review_id)
    if review["status"] != "draft":
        raise ReviewConflictError("Completed reviews are immutable")
    if int(review["version"]) != int(expected_version):
        raise ReviewConflictError("Review version is stale")

    allowed = {"mode", "contribution", "readiness_override", "action_decision"}
    unexpected = set(changes) - allowed
    if unexpected:
        raise ReviewValidationError(f"Review-owned fields cannot be changed: {', '.join(sorted(unexpected))}")
    payload = copy.deepcopy(review["payload"])
    inputs = payload.setdefault("inputs", {})
    recompute = False
    if "mode" in changes:
        if changes["mode"] not in VALID_MODES:
            raise ReviewValidationError("Invalid capital mode")
        inputs["mode"] = changes["mode"]
        recompute = True
    if "contribution" in changes:
        inputs["contribution"] = _finite_number(changes["contribution"], "contribution", 0)
        recompute = True
    if "readiness_override" in changes:
        if not isinstance(changes["readiness_override"], bool):
            raise ReviewValidationError("readiness_override must be boolean")
        inputs["readiness_override"] = changes["readiness_override"]
    if recompute:
        payload = _recompute_payload(payload)
    if "action_decision" in changes:
        payload["recommendations"]["actions"] = apply_action_decision(
            payload["recommendations"]["actions"], changes["action_decision"]
        )
        payload["cash_summary"] = reconcile_cash(
            payload["snapshot"].get("cash", 0),
            payload["inputs"].get("contribution", 0),
            payload["recommendations"]["actions"],
        )
    updated = MonthlyReviewRepository.update_draft(
        review_id, account_id, expected_version, payload
    )
    if updated is None:
        raise ReviewConflictError("Review changed before the update was saved")
    return updated


def complete_review(
    review_id: int, account_id: int, expected_version: int
) -> Dict[str, Any]:
    """Validate and atomically freeze a draft against uncached mutable inputs."""
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        review = MonthlyReviewRepository.get_by_id(review_id, account_id)
        if review is None:
            raise KeyError(review_id)
        if review["status"] != "draft" or int(review["version"]) != int(expected_version):
            raise ReviewConflictError("Review version is stale or already completed")
        payload = copy.deepcopy(review["payload"])
        readiness = payload["snapshot"].get("readiness") or {}
        if readiness.get("blocking") and not payload.get("inputs", {}).get("readiness_override"):
            raise ReviewValidationError("Readiness blockers require an explicit override")
        undecided = [
            item.get("key")
            for item in payload.get("recommendations", {}).get("actions", [])
            if item.get("decision") == "undecided"
        ]
        if undecided:
            raise ReviewValidationError("Every action must be decided before completion")
        cash = payload.get("cash_summary") or {}
        if float(cash.get("remaining_cash") or 0) < -0.005:
            raise ReviewValidationError("Accepted actions would leave negative cash")

        holdings = _load_holdings_uncached(account_id)
        targets, rules = _load_builder_inputs(account_id)
        live_cash = float(AccountRepository.get_cash(account_id) or 0)
        live_fingerprint = mutable_input_fingerprint(holdings, targets, rules, live_cash)
        if live_fingerprint != payload["snapshot"].get("mutable_fingerprint"):
            raise ReviewConflictError("Portfolio inputs changed; start a fresh review draft")
        payload["completed_at"] = utc_now_iso()
        completed = MonthlyReviewRepository.complete(
            review_id, account_id, expected_version, payload
        )
        if completed is None:
            raise ReviewConflictError("Review changed before completion")
        return completed
    except Exception:
        if db.in_transaction:
            db.rollback()
        raise
