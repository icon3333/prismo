"""
Golden-fixture parity tests for the backend allocation math.

The SAME fixture file (tests/fixtures/allocation_parity_cases.json) drives
frontend/src/lib/__tests__/allocation-parity.test.ts, so the duplicated
Python/TypeScript rebalancing math cannot silently drift: changing either
implementation forces an update of the shared golden numbers, which fails
the other side's suite.

Fixture conventions:
- `position_targets` / `portfolio_targets` are BACKEND-canonical values
  (for cases with `rules` they are the type-constrained targets).
- `*_frontend` overrides encode known, intentional divergences (the frontend
  normalizes weights to 100%; the backend applies raw weights) and are only
  consumed by the vitest side.
- `unconstrained_position_targets` / `capped` / `applicable_rules` pin the
  backend-only type-constraint capping metadata.
"""

import json
from pathlib import Path

import pytest

from app.services.allocation_service import (
    calculate_allocation_targets,
    calculate_allocation_targets_with_type_constraints,
    generate_rebalancing_plan,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "allocation_parity_cases.json"

with FIXTURE_PATH.open() as fh:
    FIXTURE = json.load(fh)

TOLERANCE = FIXTURE["float_tolerance"]
CASES = FIXTURE["cases"]
CASE_IDS = [case["name"] for case in CASES]
CONSTRAINT_CASES = [case for case in CASES if case["rules"] is not None]


def build_backend_inputs(case):
    """Adapt the language-neutral fixture shape into allocation_service inputs."""
    portfolio_map = {}
    target_allocations = []
    for idx, p in enumerate(case["portfolios"], start=1):
        sectors = {}
        current_value = 0.0
        for pos in p["positions"]:
            sector = sectors.setdefault(
                pos["sector"], {"positions": [], "currentValue": 0})
            sector["positions"].append({
                "name": pos["name"],
                "currentValue": pos["current_value"],
                "targetAllocation": pos["weight"],
                "identifier": pos["name"],
                "investment_type": pos["investment_type"],
            })
            sector["currentValue"] += pos["current_value"]
            current_value += pos["current_value"]
        portfolio_map[idx] = {
            "name": p["name"], "sectors": sectors, "currentValue": current_value}
        target_allocations.append(
            {"name": p["name"], "allocation": p["allocation"], "positions": []})
    return portfolio_map, target_allocations


def run_case(case):
    portfolio_map, target_allocations = build_backend_inputs(case)
    # Shared convention with the frontend suite: the target denominator is
    # the sum of current values plus fresh capital.
    total_value = case["investment"] + sum(
        pos["current_value"] for p in case["portfolios"] for pos in p["positions"])
    if case["rules"] is not None:
        return calculate_allocation_targets_with_type_constraints(
            portfolio_map, {}, target_allocations, total_value, rules=case["rules"])
    return calculate_allocation_targets(
        portfolio_map, {}, target_allocations, total_value)


def positions_by_name(portfolio_entry):
    return {
        pos["name"]: pos
        for sector in portfolio_entry["sectors"]
        for pos in sector["positions"]
    }


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_portfolio_target_values(case):
    result = run_case(case)
    by_name = {p["name"]: p for p in result}
    expected = case["expected"]["portfolio_targets"]
    assert set(by_name) == set(expected)
    for pname, want in expected.items():
        assert by_name[pname]["targetValue"] == pytest.approx(want, abs=TOLERANCE)


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_position_target_values(case):
    result = run_case(case)
    by_name = {p["name"]: p for p in result}
    for pname, expected_positions in case["expected"]["position_targets"].items():
        positions = positions_by_name(by_name[pname])
        assert set(positions) == set(expected_positions)
        for pos_name, want in expected_positions.items():
            assert positions[pos_name]["targetValue"] == pytest.approx(
                want, abs=TOLERANCE), f"{pname}/{pos_name}"


@pytest.mark.parametrize(
    "case", CONSTRAINT_CASES, ids=[c["name"] for c in CONSTRAINT_CASES])
def test_type_constraint_metadata(case):
    result = run_case(case)
    by_name = {p["name"]: p for p in result}
    expected = case["expected"]

    for pname, unconstrained in expected["unconstrained_position_targets"].items():
        positions = positions_by_name(by_name[pname])
        for pos_name, want in unconstrained.items():
            assert positions[pos_name]["unconstrained_target_value"] == pytest.approx(
                want, abs=TOLERANCE), f"{pname}/{pos_name}"

    for pname, capped_map in expected["capped"].items():
        positions = positions_by_name(by_name[pname])
        for pos_name, want in capped_map.items():
            assert positions[pos_name]["is_capped"] is want, f"{pname}/{pos_name}"

    for pname, rule_map in expected["applicable_rules"].items():
        positions = positions_by_name(by_name[pname])
        for pos_name, want in rule_map.items():
            assert positions[pos_name]["applicable_rule"] == want, f"{pname}/{pos_name}"


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_rebalancing_plan_wraps_portfolios(case):
    # generate_rebalancing_plan is currently a passthrough: the buy/sell
    # recommendation math lives only in the frontend (rebalancer-calc.ts).
    # Pin that contract so any backend recommendations become a visible change.
    result = run_case(case)
    plan = generate_rebalancing_plan(result)
    assert plan == {"portfolios": result}
