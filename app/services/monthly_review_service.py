"""Frozen monthly decision-review snapshots and recommendation lifecycle."""

from __future__ import annotations

import copy
import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.db_manager import get_db, query_db
from app.repositories.account_repository import AccountRepository
from app.repositories.monthly_review_repository import MonthlyReviewRepository
from app.repositories.portfolio_repository import PortfolioRepository
from app.services.rebalance_service import (
    VALID_MODES,
    calculate_detailed_rebalancing,
    calculate_rebalancing,
)


class ReviewValidationError(ValueError):
    """A review request is structurally valid JSON but invalid for the domain."""


class ReviewConflictError(RuntimeError):
    """A draft changed, completed, or became stale before the requested write."""


def _finite_number(value: Any, field: str, minimum: Optional[float] = None) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ReviewValidationError(f"{field} must be a valid number") from exc
    if not math.isfinite(result):
        raise ReviewValidationError(f"{field} must be a finite number")
    if minimum is not None and result < minimum:
        raise ReviewValidationError(f"{field} must be at least {minimum:g}")
    return result


def _normalized_identifier(item: Dict[str, Any]) -> str:
    identifier = item.get("override_identifier") or item.get("identifier") or ""
    return "".join(str(identifier).upper().split())


def stable_identity(item: Dict[str, Any], include_portfolio: bool = True) -> str:
    """Return the deterministic snapshot identity used for actions/fingerprints."""
    portfolio = str(item.get("portfolio") or item.get("portfolio_name") or "").strip()
    identifier = _normalized_identifier(item)
    if identifier:
        base = f"id:{identifier}"
    else:
        source = str(item.get("source") or "unknown").strip().lower()
        name = str(item.get("company") or item.get("name") or "").strip().casefold()
        base = f"fallback:{source}:{name}"
    return f"{portfolio.casefold()}|{base}" if include_portfolio else base


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def mutable_input_fingerprint(
    holdings: Iterable[Dict[str, Any]],
    targets: Any,
    rules: Any,
    cash: Any,
) -> str:
    """Hash mutable recommendation inputs while intentionally excluding prices/FX."""
    effective = [
        {
            "identity": stable_identity(item),
            "shares": float(item.get("effective_shares") or 0),
            "investment_type": item.get("investment_type"),
            "sector": item.get("sector"),
            "country": item.get("effective_country"),
        }
        for item in holdings
        if float(item.get("effective_shares") or 0) > 0
    ]
    effective.sort(key=lambda item: item["identity"])
    return _canonical_hash(
        {
            "holdings": effective,
            "targets": targets or [],
            "rules": rules or {},
            "cash": _finite_number(cash or 0, "cash", 0),
        }
    )


def _parse_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _age_days(value: Any, now: datetime) -> Optional[float]:
    parsed = _parse_time(value)
    if parsed is None:
        return None
    return max(0.0, (now - parsed).total_seconds() / 86400)


def evaluate_readiness(
    holdings: List[Dict[str, Any]],
    allocation_tree: Dict[str, Any],
    fx_provenance: Dict[str, Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Derive actionable blockers and stale-data warnings from frozen inputs."""
    now = now or datetime.now(timezone.utc)
    blockers: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    positive = [h for h in holdings if float(h.get("effective_shares") or 0) > 0]

    if not positive:
        blockers.append({"code": "no_positive_holdings", "message": "No positive holdings"})
    if not any(
        float(portfolio.get("targetWeight") or 0) > 0
        for portfolio in allocation_tree.get("portfolios") or []
    ):
        blockers.append({"code": "no_usable_targets", "message": "No usable portfolio targets"})

    for holding in positive:
        name = holding.get("company") or holding.get("name") or "Unknown holding"
        if holding.get("value_source") == "none" or float(holding.get("current_value") or 0) <= 0:
            blockers.append(
                {"code": "missing_valuation", "holding": name, "message": f"{name} has no authoritative valuation"}
            )
            continue

        timestamp = holding.get("custom_value_date") if holding.get("value_source") == "custom" else holding.get("last_updated")
        age = _age_days(timestamp, now)
        if age is None:
            warnings.append(
                {"code": "unknown_price_age", "holding": name, "message": f"{name} has no valuation timestamp"}
            )
        elif age > 180:
            blockers.append(
                {"code": "expired_price", "holding": name, "age_days": round(age, 1), "message": f"{name}'s valuation is older than 180 days"}
            )
        elif age >= 90:
            warnings.append(
                {"code": "stale_price", "holding": name, "age_days": round(age, 1), "message": f"{name}'s valuation is at least 90 days old"}
            )

        currency = str(holding.get("currency") or "EUR").upper()
        provenance = fx_provenance.get(currency) or {"source": "missing"}
        if currency != "EUR" and provenance.get("source") in ("missing", "approximate"):
            blockers.append(
                {
                    "code": "approximate_fx" if provenance.get("source") == "approximate" else "missing_fx",
                    "holding": name,
                    "currency": currency,
                    "message": f"{name} requires a non-authoritative {currency}/EUR rate",
                }
            )
        fx_age = _age_days(provenance.get("last_updated"), now)
        if currency != "EUR" and fx_age is not None:
            target = blockers if fx_age > 180 else warnings if fx_age >= 90 else None
            if target is not None:
                target.append(
                    {
                        "code": "expired_fx" if fx_age > 180 else "stale_fx",
                        "currency": currency,
                        "age_days": round(fx_age, 1),
                        "message": f"{currency}/EUR rate is {'older than 180' if fx_age > 180 else 'at least 90'} days old",
                    }
                )

    def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = set()
        result = []
        for item in items:
            key = (item.get("code"), item.get("holding"), item.get("currency"))
            if key not in seen:
                seen.add(key)
                result.append(item)
        return result

    return {"blocking": dedupe(blockers), "warnings": dedupe(warnings)}


def calculate_breaches(
    holdings: List[Dict[str, Any]], rules: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Calculate invested-value concentration breaches and largest contributors."""
    positive = [h for h in holdings if float(h.get("current_value") or 0) > 0]
    total = sum(float(h.get("current_value") or 0) for h in positive)
    if total <= 0:
        return []

    breaches: List[Dict[str, Any]] = []

    def cap_for(item: Dict[str, Any]) -> Optional[float]:
        kind = str(item.get("investment_type") or "Stock").lower()
        key = "maxPerETF" if kind == "etf" else "maxPerCrypto" if kind == "crypto" else "maxPerStock"
        value = rules.get(key)
        return float(value) if value is not None else None

    for item in positive:
        cap = cap_for(item)
        percentage = float(item.get("current_value") or 0) / total * 100
        if cap is not None and percentage > cap:
            name = item.get("company") or item.get("name") or "Unknown"
            breaches.append(
                {
                    "key": f"position:{stable_identity(item)}",
                    "kind": "position",
                    "name": name,
                    "percentage": percentage,
                    "limit": cap,
                    "excess_percentage_points": percentage - cap,
                    "contributors": [{"name": name, "value": float(item.get("current_value") or 0)}],
                }
            )

    def grouped(kind: str, rule_key: str, field: str, fallback: str) -> None:
        raw_limit = rules.get(rule_key)
        if raw_limit is None:
            return
        limit = float(raw_limit)
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for item in positive:
            label = str(item.get(field) or fallback)
            groups.setdefault(label, []).append(item)
        for label, members in groups.items():
            value = sum(float(item.get("current_value") or 0) for item in members)
            percentage = value / total * 100
            if percentage <= limit:
                continue
            contributors = sorted(
                (
                    {
                        "name": item.get("company") or item.get("name") or "Unknown",
                        "value": float(item.get("current_value") or 0),
                    }
                    for item in members
                ),
                key=lambda item: (-item["value"], item["name"].casefold()),
            )
            breaches.append(
                {
                    "key": f"{kind}:{label.casefold()}",
                    "kind": kind,
                    "name": label,
                    "percentage": percentage,
                    "limit": limit,
                    "excess_percentage_points": percentage - limit,
                    "contributors": contributors,
                }
            )

    grouped("sector", "maxPerCategory", "sector", "Uncategorized")
    grouped("country", "maxPerCountry", "effective_country", "Unknown")
    breaches.sort(
        key=lambda item: (-item["excess_percentage_points"], item["name"].casefold())
    )
    return breaches


def _action_key(portfolio: str, identifier: str, security: str, side: str) -> str:
    security_key = identifier or security.casefold()
    return f"{portfolio.casefold()}|{security_key}|{side}"


def build_recommendations(
    allocation_tree: Dict[str, Any],
    mode: str,
    deployable_cash: Any,
    holdings: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run the existing rebalancer over a deep copy and flatten executable rows."""
    if mode not in VALID_MODES:
        raise ReviewValidationError(f"Invalid capital mode: {mode}")
    amount = _finite_number(deployable_cash, "deployable cash", 0)
    portfolios = copy.deepcopy(allocation_tree.get("portfolios") or [])
    rebalanced = calculate_rebalancing(portfolios, mode, amount)
    actions: List[Dict[str, Any]] = []
    gaps: List[Dict[str, Any]] = []
    prices = {
        stable_identity(item): item for item in (holdings or [])
    }

    for portfolio in portfolios:
        for sector in portfolio.get("sectors") or []:
            for position in sector.get("positions") or []:
                if position.get("isPlaceholder") or sector.get("isPlaceholder"):
                    gaps.append(
                        {
                            "portfolio": portfolio.get("name"),
                            "sector": sector.get("name"),
                            "reason": "placeholder_target",
                        }
                    )

    for portfolio in rebalanced:
        name = str(portfolio.get("name") or "")
        detailed = calculate_detailed_rebalancing(
            portfolio, float(portfolio.get("action") or 0), mode
        )
        for sector in detailed.get("sectors") or []:
            for position in sector.get("positions") or []:
                if position.get("isPlaceholder") or sector.get("isPlaceholder"):
                    continue
                action = float(position.get("action") or 0)
                if abs(action) <= 0.01:
                    continue
                security = str(position.get("name") or "").strip()
                identifier = str(position.get("identifier") or "").strip().upper()
                if not security:
                    gaps.append(
                        {"portfolio": name, "sector": sector.get("name"), "reason": "missing_security"}
                    )
                    continue
                side = "buy" if action > 0 else "sell"
                holding = prices.get(f"{name.casefold()}|id:{identifier}") if identifier else None
                unit_price = None
                if holding and float(holding.get("effective_shares") or 0) > 0:
                    unit_price = float(holding.get("current_value") or 0) / float(holding["effective_shares"])
                if holdings is not None and (unit_price is None or unit_price <= 0):
                    gaps.append(
                        {
                            "portfolio": name,
                            "sector": sector.get("name"),
                            "security": security,
                            "identifier": identifier or None,
                            "reason": "missing_executable_price",
                        }
                    )
                    continue
                amount_eur = abs(action)
                actions.append(
                    {
                        "key": _action_key(name, identifier, security, side),
                        "portfolio": name,
                        "security": security,
                        "identifier": identifier or None,
                        "side": side,
                        "amount_eur": amount_eur,
                        "estimated_units": amount_eur / unit_price if unit_price and unit_price > 0 else None,
                        "snapshot_price_eur": unit_price,
                        "snapshot_price_time": holding.get("last_updated") if holding else None,
                        "post_action_allocation": (
                            float(position.get("valueAfter") or 0)
                            / float(detailed.get("portfolioTargetValue") or 1)
                            * 100
                        ),
                        "decision": "undecided",
                        "note": "",
                    }
                )

    actions.sort(
        key=lambda item: (
            -item["amount_eur"],
            item["security"].casefold(),
            item["portfolio"].casefold(),
            item["side"],
        )
    )
    return {"mode": mode, "actions": actions, "unresolved_gaps": gaps}


def preserve_decisions(
    actions: List[Dict[str, Any]], previous: Optional[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    previous_by_key = {
        item.get("key"): item for item in ((previous or {}).get("actions") or [])
    }
    result = []
    for item in actions:
        updated = dict(item)
        old = previous_by_key.get(item.get("key"))
        unchanged = (
            old
            and old.get("side") == item.get("side")
            and round(float(old.get("amount_eur") or 0), 2)
            == round(float(item.get("amount_eur") or 0), 2)
        )
        if unchanged:
            for field in ("decision", "adjusted_amount", "note"):
                if field in old:
                    updated[field] = old[field]
        else:
            updated.update({"decision": "undecided", "note": ""})
            updated.pop("adjusted_amount", None)
        result.append(updated)
    return result


def apply_action_decision(
    actions: List[Dict[str, Any]], change: Dict[str, Any]
) -> List[Dict[str, Any]]:
    key = change.get("key")
    decision = change.get("decision")
    if decision not in {"accepted", "deferred", "dismissed", "adjusted"}:
        raise ReviewValidationError("Invalid action decision")
    note = str(change.get("note") or "")
    if len(note) > 1000:
        raise ReviewValidationError("Action note is too long")
    found = False
    result = []
    for item in actions:
        updated = dict(item)
        if item.get("key") == key:
            found = True
            updated["decision"] = decision
            updated["note"] = note
            updated.pop("adjusted_amount", None)
            if decision == "adjusted":
                updated["adjusted_amount"] = _finite_number(
                    change.get("adjusted_amount"), "adjusted amount", 0
                )
        result.append(updated)
    if not found:
        raise ReviewValidationError("Unknown action key")
    return result


def reconcile_cash(
    current_cash: Any, contribution: Any, actions: List[Dict[str, Any]]
) -> Dict[str, float]:
    cash = _finite_number(current_cash or 0, "current cash", 0)
    extra = _finite_number(contribution or 0, "contribution", 0)
    buys = 0.0
    sales = 0.0
    for item in actions:
        if item.get("decision") not in {"accepted", "adjusted"}:
            continue
        amount = (
            item.get("adjusted_amount")
            if item.get("decision") == "adjusted"
            else item.get("amount_eur")
        )
        amount = _finite_number(amount or 0, "action amount", 0)
        if item.get("side") == "sell":
            sales += amount
        elif item.get("side") == "buy":
            buys += amount
    return {
        "current_cash": cash,
        "contribution": extra,
        "accepted_sales": sales,
        "accepted_buys": buys,
        "remaining_cash": cash + extra + sales - buys,
    }


def _unique_identifier_map(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        groups.setdefault(stable_identity(item, include_portfolio=False), []).append(item)
    return {key: group[0] for key, group in groups.items() if len(group) == 1}


def compare_snapshots(
    current: Dict[str, Any], previous: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Best-effort snapshot comparison; never claims transaction attribution."""
    if not previous:
        return {
            "baseline": True,
            "disclaimer": "Best-effort snapshot analysis, not transaction or tax accounting.",
            "added": [], "closed": [], "renamed": [], "moved": [],
            "share_changes": [], "value_changes": [], "allocation_changes": [],
            "cash_change": 0, "rules_changed": False, "targets_changed": False,
            "new_breaches": [], "resolved_breaches": [],
        }

    current_holdings = current.get("holdings") or []
    previous_holdings = previous.get("holdings") or []
    current_map = _unique_identifier_map(current_holdings)
    previous_map = _unique_identifier_map(previous_holdings)
    common = sorted(set(current_map) & set(previous_map))

    def compact(item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "identifier": _normalized_identifier(item) or None,
            "name": item.get("company") or item.get("name"),
            "portfolio": item.get("portfolio") or item.get("portfolio_name"),
        }

    added = [compact(current_map[key]) for key in sorted(set(current_map) - set(previous_map))]
    closed = [compact(previous_map[key]) for key in sorted(set(previous_map) - set(current_map))]
    renamed = []
    moved = []
    share_changes = []
    value_changes = []
    allocation_changes = []
    current_total = sum(float(item.get("current_value") or 0) for item in current_holdings)
    previous_total = sum(float(item.get("current_value") or 0) for item in previous_holdings)

    for key in common:
        after = current_map[key]
        before = previous_map[key]
        identifier = _normalized_identifier(after) or None
        before_name = before.get("company") or before.get("name")
        after_name = after.get("company") or after.get("name")
        if before_name != after_name:
            renamed.append({"identifier": identifier, "from": before_name, "to": after_name})
        before_portfolio = before.get("portfolio") or before.get("portfolio_name")
        after_portfolio = after.get("portfolio") or after.get("portfolio_name")
        if before_portfolio != after_portfolio:
            moved.append({"identifier": identifier, "from": before_portfolio, "to": after_portfolio})
        before_shares = float(before.get("effective_shares") or 0)
        after_shares = float(after.get("effective_shares") or 0)
        if before_shares != after_shares:
            share_changes.append({"identifier": identifier, "from": before_shares, "to": after_shares})
        before_value = float(before.get("current_value") or 0)
        after_value = float(after.get("current_value") or 0)
        if before_value != after_value:
            value_changes.append({"identifier": identifier, "from": before_value, "to": after_value})
        before_pct = before_value / previous_total * 100 if previous_total else 0
        after_pct = after_value / current_total * 100 if current_total else 0
        if round(before_pct, 8) != round(after_pct, 8):
            allocation_changes.append({"identifier": identifier, "from": before_pct, "to": after_pct})

    current_breaches = {item.get("key"): item for item in current.get("breaches") or []}
    previous_breaches = {item.get("key"): item for item in previous.get("breaches") or []}
    return {
        "baseline": False,
        "disclaimer": "Best-effort snapshot analysis, not transaction or tax accounting.",
        "added": added,
        "closed": closed,
        "renamed": renamed,
        "moved": moved,
        "share_changes": share_changes,
        "value_changes": value_changes,
        "allocation_changes": allocation_changes,
        "cash_change": float(current.get("cash") or 0) - float(previous.get("cash") or 0),
        "rules_changed": current.get("rules") != previous.get("rules"),
        "targets_changed": current.get("targets") != previous.get("targets"),
        "new_breaches": [current_breaches[key] for key in sorted(set(current_breaches) - set(previous_breaches))],
        "resolved_breaches": [previous_breaches[key] for key in sorted(set(previous_breaches) - set(current_breaches))],
    }


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
        "captured_at": datetime.now(timezone.utc).isoformat(),
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
        if source_job["status"] != "completed":
            raise ReviewValidationError("Only a completed import can create a review")
        if receipt is None and source_job.get("result"):
            try:
                stored_result = json.loads(source_job["result"])
            except (TypeError, json.JSONDecodeError):
                stored_result = None
            if isinstance(stored_result, dict):
                receipt = stored_result
    previous = MonthlyReviewRepository.get_latest_completed(account_id)
    snapshot = capture_snapshot(account_id, receipt)
    previous_snapshot = (previous or {}).get("payload", {}).get("snapshot")
    payload = {
        "payload_version": 1,
        "snapshot": snapshot,
        "comparison": compare_snapshots(snapshot, previous_snapshot),
        "reconciliation": {
            "items": [],
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
    return MonthlyReviewRepository.create(
        account_id=account_id,
        source_job_id=source_job_id,
        period=selected_period,
        previous_review_id=previous["id"] if previous else None,
        payload=payload,
    )


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
        payload["completed_at"] = datetime.now(timezone.utc).isoformat()
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
