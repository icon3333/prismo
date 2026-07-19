"""Monthly decision-review domain tests."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import seed_account


def _holding(**overrides):
    item = {
        "company": "Alpha",
        "identifier": "AAA",
        "portfolio": "Core",
        "sector": "Technology",
        "investment_type": "Stock",
        "effective_country": "US",
        "effective_shares": 10.0,
        "current_value": 1000.0,
        "price_eur": 100.0,
        "currency": "EUR",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "value_source": "market",
        "source": "parqet",
    }
    item.update(overrides)
    return item


def _tree():
    return {
        "portfolios": [
            {
                "name": "Core",
                "currentValue": 1000.0,
                "targetWeight": 100.0,
                "sectors": [
                    {
                        "name": "Technology",
                        "positions": [
                            {
                                "name": "Alpha",
                                "identifier": "AAA",
                                "currentValue": 1000.0,
                                "targetAllocation": 50.0,
                            }
                        ],
                    },
                    {
                        "name": "Industry",
                        "positions": [
                            {
                                "name": "Beta",
                                "identifier": "BBB",
                                "currentValue": 0.0,
                                "targetAllocation": 50.0,
                            }
                        ],
                    },
                ],
                "builderPositions": [
                    {"companyName": "Alpha", "weight": 50.0},
                    {"companyName": "Beta", "weight": 50.0},
                ],
            }
        ]
    }


def test_fingerprint_covers_mutable_inputs_but_not_frozen_prices():
    from app.services.monthly_review_service import mutable_input_fingerprint

    holdings = [_holding()]
    base = mutable_input_fingerprint(holdings, [{"name": "Core"}], {"maxPerStock": 20}, 50)

    repriced = deepcopy(holdings)
    repriced[0]["price_eur"] = 150
    repriced[0]["current_value"] = 1500
    assert mutable_input_fingerprint(
        repriced, [{"name": "Core"}], {"maxPerStock": 20}, 50
    ) == base

    moved = deepcopy(holdings)
    moved[0]["effective_shares"] = 11
    assert mutable_input_fingerprint(
        moved, [{"name": "Core"}], {"maxPerStock": 20}, 50
    ) != base
    assert mutable_input_fingerprint(
        holdings, [{"name": "Core"}], {"maxPerStock": 20}, 51
    ) != base


def test_reconcile_previous_actions_observes_partial_pending_and_deferred():
    from app.services.monthly_review_service import reconcile_previous_actions

    previous_snapshot = {
        "holdings": [
            _holding(identifier="BUY", effective_shares=10),
            _holding(identifier="SELL", company="Sell", effective_shares=10),
            _holding(identifier="WAIT", company="Wait", effective_shares=10),
            _holding(identifier="DEFER", company="Deferred", effective_shares=10),
        ]
    }
    previous = {
        "payload": {
            "snapshot": previous_snapshot,
            "recommendations": {
                "actions": [
                    {"key": "buy", "identifier": "BUY", "portfolio": "Core", "side": "buy", "decision": "accepted", "estimated_units": 2},
                    {"key": "sell", "identifier": "SELL", "portfolio": "Core", "side": "sell", "decision": "adjusted", "adjusted_amount": 50, "snapshot_price_eur": 50, "estimated_units": 2},
                    {"key": "wait", "identifier": "WAIT", "portfolio": "Core", "side": "buy", "decision": "accepted", "estimated_units": 2},
                    {"key": "defer", "identifier": "DEFER", "portfolio": "Core", "side": "buy", "decision": "deferred", "estimated_units": 2},
                ]
            },
        }
    }
    current = {
        "holdings": [
            _holding(identifier="BUY", effective_shares=12),
            _holding(identifier="SELL", company="Sell", effective_shares=9.5),
            _holding(identifier="WAIT", company="Wait", effective_shares=10),
            _holding(identifier="DEFER", company="Deferred", effective_shares=99),
        ]
    }

    items = {item["action_key"]: item for item in reconcile_previous_actions(previous, current)}

    assert items["buy"]["status"] == "observed"
    assert items["sell"]["status"] == "partial"
    assert items["wait"]["status"] == "pending"
    assert items["defer"]["status"] == "deferred"
    assert all(item["advisory"] is True for item in items.values())


def test_reconcile_previous_actions_marks_ambiguous_identity_and_units():
    from app.services.monthly_review_service import reconcile_previous_actions

    previous = {
        "payload": {
            "snapshot": {"holdings": [_holding()]},
            "recommendations": {
                "actions": [
                    {"key": "duplicate", "identifier": "AAA", "portfolio": "Core", "side": "buy", "decision": "accepted", "estimated_units": 1},
                    {"key": "units", "identifier": "MISSING", "portfolio": "Core", "side": "buy", "decision": "accepted", "estimated_units": None},
                ]
            },
        }
    }
    current = {
        "holdings": [
            _holding(portfolio="Core"),
            _holding(portfolio="Satellite"),
        ]
    }

    items = {item["action_key"]: item for item in reconcile_previous_actions(previous, current)}

    assert items["duplicate"]["status"] == "ambiguous"
    assert items["duplicate"]["reason"] == "duplicate_identity"
    assert items["units"]["status"] == "ambiguous"
    assert items["units"]["reason"] == "missing_estimated_units"


def test_readiness_age_and_approximate_fx_rules():
    from app.services.monthly_review_service import evaluate_readiness

    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    fresh = _holding(last_updated=(now - timedelta(days=20)).isoformat())
    result = evaluate_readiness([fresh], _tree(), {"EUR": {"source": "identity"}}, now)
    assert result["blocking"] == []
    assert result["warnings"] == []

    stale = _holding(last_updated=(now - timedelta(days=100)).isoformat())
    result = evaluate_readiness([stale], _tree(), {"EUR": {"source": "identity"}}, now)
    assert any(item["code"] == "stale_price" for item in result["warnings"])

    ancient = _holding(last_updated=(now - timedelta(days=181)).isoformat())
    result = evaluate_readiness([ancient], _tree(), {"EUR": {"source": "identity"}}, now)
    assert any(item["code"] == "expired_price" for item in result["blocking"])

    approximate = _holding(currency="USD")
    result = evaluate_readiness(
        [approximate], _tree(), {"USD": {"source": "approximate"}}, now
    )
    assert any(item["code"] == "approximate_fx" for item in result["blocking"])


def test_breaches_rank_excess_and_show_largest_contributor():
    from app.services.monthly_review_service import calculate_breaches

    holdings = [
        _holding(company="Alpha", current_value=800),
        _holding(company="Beta", identifier="BBB", current_value=200),
    ]
    rules = {"maxPerStock": 50, "maxPerCategory": 70, "maxPerCountry": 75}
    breaches = calculate_breaches(holdings, rules)

    assert breaches[0]["kind"] == "position"
    assert breaches[0]["excess_percentage_points"] == pytest.approx(30)
    sector = next(item for item in breaches if item["kind"] == "sector")
    assert sector["contributors"][0]["name"] == "Alpha"


def test_actions_reuse_all_three_rebalance_modes_and_rank_deterministically():
    from app.services.monthly_review_service import build_recommendations

    existing = build_recommendations(_tree(), "existing-only", 0)
    assert {(a["side"], a["security"]) for a in existing["actions"]} == {
        ("sell", "Alpha"),
        ("buy", "Beta"),
    }

    new_only = build_recommendations(_tree(), "new-only", 200)
    assert [(a["side"], a["security"]) for a in new_only["actions"]] == [
        ("buy", "Beta")
    ]
    assert new_only["actions"][0]["amount_eur"] == pytest.approx(200)

    with_sells = build_recommendations(_tree(), "new-with-sells", 200)
    assert any(a["side"] == "sell" for a in with_sells["actions"])
    assert any(a["side"] == "buy" for a in with_sells["actions"])


def test_placeholder_targets_become_gaps_not_actions():
    from app.services.monthly_review_service import build_recommendations

    tree = _tree()
    tree["portfolios"][0]["sectors"].append(
        {
            "name": "Missing Positions",
            "isPlaceholder": True,
            "positions": [
                {"name": "Missing", "isPlaceholder": True, "positionsRemaining": 1}
            ],
        }
    )
    result = build_recommendations(tree, "new-with-sells", 100)
    assert all(not item.get("is_placeholder") for item in result["actions"])
    assert result["unresolved_gaps"]


def test_missing_snapshot_price_becomes_gap_instead_of_fake_action():
    from app.services.monthly_review_service import build_recommendations

    result = build_recommendations(
        _tree(), "new-with-sells", 100, holdings=[_holding()]
    )
    assert all(item["security"] != "Beta" for item in result["actions"])
    assert any(
        item["reason"] == "missing_executable_price"
        for item in result["unresolved_gaps"]
    )


def test_decisions_survive_only_unchanged_side_and_rounded_amount():
    from app.services.monthly_review_service import preserve_decisions

    original = {
        "actions": [
            {
                "key": "Core|AAA|buy",
                "side": "buy",
                "amount_eur": 100.004,
                "decision": "accepted",
                "note": "keep",
            }
        ]
    }
    unchanged = [{"key": "Core|AAA|buy", "side": "buy", "amount_eur": 100.001}]
    assert preserve_decisions(unchanged, original)[0]["decision"] == "accepted"

    changed = [{"key": "Core|AAA|buy", "side": "buy", "amount_eur": 100.02}]
    assert preserve_decisions(changed, original)[0]["decision"] == "undecided"


def test_cash_reconciliation_uses_only_accepted_or_adjusted_actions():
    from app.services.monthly_review_service import reconcile_cash

    actions = [
        {"side": "sell", "amount_eur": 100, "decision": "accepted"},
        {"side": "buy", "amount_eur": 80, "decision": "adjusted", "adjusted_amount": 90},
        {"side": "buy", "amount_eur": 1000, "decision": "dismissed"},
    ]
    result = reconcile_cash(50, 25, actions)
    assert result == {
        "current_cash": 50.0,
        "contribution": 25.0,
        "accepted_sales": 100.0,
        "accepted_buys": 90.0,
        "remaining_cash": 85.0,
    }


def test_comparison_baseline_and_position_changes():
    from app.services.monthly_review_service import compare_snapshots

    current = {
        "holdings": [
            _holding(company="Alpha Renamed", effective_shares=12, current_value=1200),
            _holding(company="New", identifier="NEW", current_value=100),
        ],
        "cash": 20,
        "rules": {"maxPerStock": 25},
        "targets": [{"name": "Core", "weight": 100}],
        "breaches": [],
    }
    assert compare_snapshots(current, None)["baseline"] is True

    previous = {
        "holdings": [
            _holding(),
            _holding(company="Closed", identifier="OLD", current_value=50),
        ],
        "cash": 10,
        "rules": {"maxPerStock": 20},
        "targets": [{"name": "Core", "weight": 90}],
        "breaches": [{"key": "position:AAA"}],
    }
    diff = compare_snapshots(current, previous)
    assert diff["baseline"] is False
    assert {item["identifier"] for item in diff["added"]} == {"NEW"}
    assert {item["identifier"] for item in diff["closed"]} == {"OLD"}
    assert diff["renamed"][0]["from"] == "Alpha"
    assert diff["share_changes"][0]["from"] == 10
    assert diff["cash_change"] == 10
    assert diff["rules_changed"] is True
    assert diff["targets_changed"] is True


def test_apply_action_decision_validates_adjustments():
    from app.services.monthly_review_service import ReviewValidationError, apply_action_decision

    actions = [{"key": "Core|AAA|buy", "side": "buy", "amount_eur": 100}]
    updated = apply_action_decision(
        actions,
        {"key": "Core|AAA|buy", "decision": "adjusted", "adjusted_amount": 75, "note": "cap"},
    )
    assert updated[0]["decision"] == "adjusted"
    assert updated[0]["adjusted_amount"] == 75

    with pytest.raises(ReviewValidationError):
        apply_action_decision(
            actions,
            {"key": "Core|AAA|buy", "decision": "adjusted", "adjusted_amount": -1},
        )


def _captured_snapshot():
    holding = _holding()
    targets = [{"name": "Core", "weight": 100}]
    rules = {"maxPerStock": 100}
    from app.services.monthly_review_service import mutable_input_fingerprint

    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "receipt": None,
        "holdings": [holding],
        "targets": targets,
        "rules": rules,
        "cash": 50.0,
        "allocation_tree": _tree(),
        "fx_provenance": {"EUR": {"source": "identity", "rate": 1}},
        "breaches": [],
        "readiness": {"blocking": [], "warnings": []},
        "mutable_fingerprint": mutable_input_fingerprint(
            [holding], targets, rules, 50
        ),
    }


def test_create_update_complete_round_trip_is_versioned_and_immutable(db, monkeypatch):
    from app.services import monthly_review_service as service

    account_id = seed_account(db)
    db.execute("UPDATE accounts SET cash = 50 WHERE id = ?", [account_id])
    snapshot = _captured_snapshot()
    monkeypatch.setattr(service, "capture_snapshot", lambda *_args, **_kwargs: deepcopy(snapshot))

    review = service.create_draft(account_id, period="2026-07")
    assert review["payload"]["comparison"]["baseline"] is True
    assert review["payload"]["inputs"]["contribution"] == 0

    first_action = review["payload"]["recommendations"]["actions"][0]
    updated = service.update_draft(
        review["id"],
        account_id,
        review["version"],
        {"action_decision": {"key": first_action["key"], "decision": "dismissed"}},
    )
    for action in updated["payload"]["recommendations"]["actions"]:
        if action["decision"] == "undecided":
            updated = service.update_draft(
                review["id"],
                account_id,
                updated["version"],
                {"action_decision": {"key": action["key"], "decision": "dismissed"}},
            )

    monkeypatch.setattr(service, "_load_holdings_uncached", lambda _account: snapshot["holdings"])
    monkeypatch.setattr(service, "_load_builder_inputs", lambda _account: (snapshot["targets"], snapshot["rules"]))
    completed = service.complete_review(review["id"], account_id, updated["version"])
    assert completed["status"] == "completed"
    assert completed["payload"]["completed_at"]

    with pytest.raises(service.ReviewConflictError, match="immutable"):
        service.update_draft(
            review["id"], account_id, completed["version"], {"contribution": 1}
        )


def test_processing_import_can_capture_exact_receipt_idempotently(db, monkeypatch):
    from app.services import monthly_review_service as service

    account_id = seed_account(db, "processing-review")
    db.execute(
        """INSERT INTO background_jobs
           (id, name, account_id, status, progress, total, result)
           VALUES ('processing-review-job', 'csv_upload', ?, 'processing', 90, 100, '{}')""",
        [account_id],
    )
    db.commit()
    receipt = {"receipt_version": 1, "filename": "july.csv"}
    snapshot = _captured_snapshot()
    monkeypatch.setattr(
        service,
        "capture_snapshot",
        lambda _account_id, captured_receipt=None: {
            **deepcopy(snapshot),
            "receipt": deepcopy(captured_receipt),
        },
    )

    first = service.create_draft(
        account_id, source_job_id="processing-review-job", receipt=receipt
    )
    second = service.create_draft(
        account_id, source_job_id="processing-review-job", receipt=receipt
    )

    assert first["id"] == second["id"]
    assert first["payload"]["snapshot"]["receipt"] == receipt


def test_completion_blocks_stale_inputs_and_undecided_actions(db, monkeypatch):
    from app.services import monthly_review_service as service

    account_id = seed_account(db)
    db.execute("UPDATE accounts SET cash = 50 WHERE id = ?", [account_id])
    snapshot = _captured_snapshot()
    monkeypatch.setattr(service, "capture_snapshot", lambda *_args, **_kwargs: deepcopy(snapshot))
    review = service.create_draft(account_id)

    with pytest.raises(service.ReviewValidationError, match="Every action"):
        service.complete_review(review["id"], account_id, review["version"])

    payload = deepcopy(review["payload"])
    for action in payload["recommendations"]["actions"]:
        action["decision"] = "dismissed"
    stored = service.MonthlyReviewRepository.update_draft(
        review["id"], account_id, review["version"], payload
    )
    changed = deepcopy(snapshot["holdings"])
    changed[0]["effective_shares"] = 99
    monkeypatch.setattr(service, "_load_holdings_uncached", lambda _account: changed)
    monkeypatch.setattr(service, "_load_builder_inputs", lambda _account: (snapshot["targets"], snapshot["rules"]))

    with pytest.raises(service.ReviewConflictError, match="Portfolio inputs changed"):
        service.complete_review(review["id"], account_id, stored["version"])
