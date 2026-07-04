"""
Characterization tests for app/services/allocation_service.py.

Covers the rebalancer's core math: target allocation and type-constraint
capping with recursive redistribution. All functions under test are pure
(no DB access).
"""

import pytest

from app.services.allocation_service import (
    _apply_type_constraints_recursive,
    calculate_allocation_targets,
    calculate_allocation_targets_with_type_constraints,
    get_portfolio_positions,
)


def make_position(name, target_value, investment_type="Stock", identifier=None):
    return {
        "name": name,
        "targetValue": target_value,
        "investment_type": investment_type,
        "identifier": identifier or name,
    }


class TestTypeConstraints:
    def test_no_caps_hit_leaves_targets_unchanged(self):
        positions = [
            make_position("A", 100.0),
            make_position("B", 100.0),
        ]
        result = _apply_type_constraints_recursive(
            positions, 10_000.0, max_stock_pct=5.0, max_etf_pct=10.0, portfolio_name="P"
        )
        for pos in result:
            assert pos["constrained_target_value"] == 100.0
            assert pos["is_capped"] is False

    def test_stock_capped_at_max_pct_and_excess_redistributed(self):
        # A wants 20% of 10k (2000), cap is 5% (500). B and C absorb the rest
        # proportionally to their original weights.
        positions = [
            make_position("A", 2000.0),
            make_position("B", 400.0, investment_type="ETF"),
            make_position("C", 400.0, investment_type="ETF"),
        ]
        result = _apply_type_constraints_recursive(
            positions, 10_000.0, max_stock_pct=5.0, max_etf_pct=10.0, portfolio_name="P"
        )
        by_name = {p["name"]: p for p in result}
        assert by_name["A"]["is_capped"] is True
        assert by_name["A"]["applicable_rule"] == "maxPerStock"
        assert by_name["A"]["constrained_target_value"] == pytest.approx(500.0)
        # Excess redistributes over ALL remaining target value, split evenly
        # between B and C (equal original weights)
        assert by_name["B"]["constrained_target_value"] == pytest.approx(
            by_name["C"]["constrained_target_value"]
        )
        # Redistribution can push B/C over their own caps -> recursion caps them
        assert by_name["B"]["constrained_target_value"] <= 10_000.0 * 0.10 + 1e-6

    def test_total_never_exceeds_portfolio_target(self):
        positions = [
            make_position("A", 5000.0),
            make_position("B", 3000.0, investment_type="ETF"),
            make_position("C", 2000.0, investment_type="Crypto"),
        ]
        result = _apply_type_constraints_recursive(
            positions,
            10_000.0,
            max_stock_pct=5.0,
            max_etf_pct=10.0,
            portfolio_name="P",
            max_crypto_pct=5.0,
        )
        total = sum(p["constrained_target_value"] for p in result)
        assert total <= 10_000.0 + 1e-6

    def test_all_positions_capped_when_targets_exceed_caps(self):
        positions = [
            make_position("A", 6000.0),
            make_position("B", 4000.0),
        ]
        result = _apply_type_constraints_recursive(
            positions, 10_000.0, max_stock_pct=5.0, max_etf_pct=10.0, portfolio_name="P"
        )
        for pos in result:
            assert pos["is_capped"] is True
            assert pos["constrained_target_value"] == pytest.approx(500.0)

    def test_crypto_uses_crypto_cap(self):
        positions = [make_position("BTC", 1000.0, investment_type="Crypto")]
        result = _apply_type_constraints_recursive(
            positions,
            10_000.0,
            max_stock_pct=5.0,
            max_etf_pct=10.0,
            portfolio_name="P",
            max_crypto_pct=3.0,
        )
        assert result[0]["applicable_rule"] == "maxPerCrypto"
        assert result[0]["constrained_target_value"] == pytest.approx(300.0)

    def test_unknown_type_is_zeroed_and_capped(self):
        positions = [
            make_position("A", 500.0, investment_type="Bond"),
            make_position("B", 400.0),
        ]
        result = _apply_type_constraints_recursive(
            positions, 10_000.0, max_stock_pct=5.0, max_etf_pct=10.0, portfolio_name="P"
        )
        by_name = {p["name"]: p for p in result}
        assert by_name["A"]["constrained_target_value"] == 0
        assert by_name["A"]["applicable_rule"] == "unknown_type"

    def test_zero_portfolio_value_zeroes_everything(self):
        positions = [make_position("A", 500.0)]
        result = _apply_type_constraints_recursive(
            positions, 0.0, max_stock_pct=5.0, max_etf_pct=10.0, portfolio_name="P"
        )
        assert result[0]["constrained_target_value"] == 0
        assert result[0]["applicable_rule"] == "zero_portfolio_value"


def make_row(
    portfolio_id,
    portfolio_name,
    company_name,
    price_eur,
    shares,
    sector="Tech",
    investment_type="Stock",
):
    return {
        "portfolio_id": portfolio_id,
        "portfolio_name": portfolio_name,
        "company_name": company_name,
        "sector": sector,
        "identifier": company_name,
        "investment_type": investment_type,
        "price_eur": price_eur,
        "shares": shares,
    }


class TestGetPortfolioPositions:
    def test_groups_by_portfolio_and_sector_with_values(self):
        rows = [
            make_row(1, "Growth", "A", 10.0, 10),  # 100
            make_row(1, "Growth", "B", 20.0, 5, sector="Health"),  # 100
            make_row(2, "Core", "C", 50.0, 4),  # 200
        ]
        portfolio_map, builder_data = get_portfolio_positions(
            rows, target_allocations=[], rules=None
        )
        assert portfolio_map[1]["currentValue"] == pytest.approx(200.0)
        assert portfolio_map[2]["currentValue"] == pytest.approx(200.0)
        assert set(portfolio_map[1]["sectors"].keys()) == {"Tech", "Health"}

    def test_explicit_builder_weight_wins_over_type_default(self):
        rows = [make_row(1, "Growth", "A", 10.0, 10)]
        targets = [
            {
                "name": "Growth",
                "allocation": 50,
                "positions": [{"companyName": "A", "weight": 7.5}],
            }
        ]
        portfolio_map, _ = get_portfolio_positions(
            rows, targets, rules={"maxPerStock": 2.0}
        )
        pos = portfolio_map[1]["sectors"]["Tech"]["positions"][0]
        assert pos["targetAllocation"] == 7.5

    def test_type_default_weight_applied_when_no_explicit_weight(self):
        rows = [
            make_row(1, "P", "A", 10.0, 10, investment_type="Stock"),
            make_row(1, "P", "B", 10.0, 10, investment_type="ETF"),
        ]
        portfolio_map, _ = get_portfolio_positions(
            rows, [], rules={"maxPerStock": 2.0, "maxPerETF": 5.0}
        )
        positions = portfolio_map[1]["sectors"]["Tech"]["positions"]
        weights = {p["name"]: p["targetAllocation"] for p in positions}
        assert weights == {"A": 2.0, "B": 5.0}

    def test_null_investment_type_defaults_to_zero_weight(self):
        rows = [make_row(1, "P", "A", 10.0, 10, investment_type=None)]
        portfolio_map, _ = get_portfolio_positions(rows, [], None)
        pos = portfolio_map[1]["sectors"]["Tech"]["positions"][0]
        assert pos["targetAllocation"] == 0.0


class TestCalculateAllocationTargets:
    def _basic_inputs(self):
        rows = [
            make_row(1, "Growth", "A", 10.0, 10),  # 100 current
            make_row(1, "Growth", "B", 10.0, 30),  # 300 current
        ]
        targets = [
            {
                "name": "Growth",
                "allocation": 40,
                "positions": [
                    {"companyName": "A", "weight": 60},
                    {"companyName": "B", "weight": 40},
                ],
            }
        ]
        portfolio_map, builder_data = get_portfolio_positions(
            rows, targets, rules=None
        )
        return portfolio_map, builder_data, targets

    def test_position_targets_derive_from_portfolio_target(self):
        portfolio_map, builder_data, targets = self._basic_inputs()
        result = calculate_allocation_targets(
            portfolio_map, builder_data, targets, total_current_value=1000.0
        )
        assert len(result) == 1
        p = result[0]
        assert p["targetValue"] == pytest.approx(400.0)  # 40% of 1000
        positions = {
            pos["name"]: pos for sector in p["sectors"] for pos in sector["positions"]
        }
        assert positions["A"]["targetValue"] == pytest.approx(240.0)  # 60% of 400
        assert positions["B"]["targetValue"] == pytest.approx(160.0)  # 40% of 400

    def test_missing_positions_placeholder_sector_created(self):
        rows = [make_row(1, "Growth", "A", 10.0, 10)]
        targets = [
            {
                "name": "Growth",
                "allocation": 50,
                "desiredPositions": 3,
                "positions": [
                    {"companyName": "A", "weight": 20},
                    {"isPlaceholder": True, "weight": 40},
                ],
            }
        ]
        portfolio_map, builder_data = get_portfolio_positions(
            rows, targets, rules=None
        )
        result = calculate_allocation_targets(
            portfolio_map, builder_data, targets, total_current_value=1000.0
        )
        sector_names = [s["name"] for s in result[0]["sectors"]]
        assert "Missing Positions" in sector_names
        missing = next(s for s in result[0]["sectors"] if s["name"] == "Missing Positions")
        assert missing["positionCount"] == 2  # desired 3 - current 1

    def test_with_type_constraints_caps_positions(self):
        portfolio_map, builder_data, targets = self._basic_inputs()
        result = calculate_allocation_targets_with_type_constraints(
            portfolio_map,
            builder_data,
            targets,
            total_current_value=1000.0,
            rules={"maxPerStock": 5.0, "maxPerETF": 10.0},
        )
        positions = {
            pos["name"]: pos
            for sector in result[0]["sectors"]
            for pos in sector["positions"]
        }
        # Both A (240 = 60% of 400) and B (160 = 40%) exceed 5% of 400 (20)
        assert positions["A"]["is_capped"] is True
        assert positions["A"]["targetValue"] == pytest.approx(20.0)
        assert positions["B"]["targetValue"] == pytest.approx(20.0)
