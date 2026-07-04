"""
Characterization tests for app/utils/value_calculator.py — the single source
of truth for EUR position values.

Priority under test:
1. custom value (is_custom_value + custom_total_value)
2. native price x exchange rate x shares
3. legacy price_eur x shares
"""

import pytest

from app.utils import value_calculator as vc
from tests.conftest import seed_rate


@pytest.fixture
def rates(monkeypatch):
    """Pin the module-level rate cache so no DB access happens."""
    monkeypatch.setattr(
        vc, "_exchange_rates_cache", {"EUR": 1.0, "USD": 0.9, "GBP": 1.2}
    )


class TestCalculateItemValue:
    def test_custom_value_wins_over_everything(self, rates):
        item = {
            "is_custom_value": True,
            "custom_total_value": 5000.0,
            "price": 100.0,
            "currency": "USD",
            "shares": 10,
            "price_eur": 90.0,
        }
        assert vc.calculate_item_value(item) == 5000.0

    def test_custom_flag_without_value_falls_through_to_market(self, rates):
        item = {
            "is_custom_value": True,
            "custom_total_value": None,
            "price": 100.0,
            "currency": "USD",
            "shares": 10,
        }
        assert vc.calculate_item_value(item) == pytest.approx(100.0 * 0.9 * 10)

    def test_native_currency_conversion(self, rates):
        item = {"price": 150.0, "currency": "USD", "shares": 2}
        assert vc.calculate_item_value(item) == pytest.approx(150.0 * 0.9 * 2)

    def test_eur_native_price_uses_rate_1(self, rates):
        item = {"price": 50.0, "currency": "EUR", "shares": 4}
        assert vc.calculate_item_value(item) == pytest.approx(200.0)

    def test_effective_shares_beats_shares(self, rates):
        item = {"price": 10.0, "currency": "EUR", "shares": 100, "effective_shares": 7}
        assert vc.calculate_item_value(item) == pytest.approx(70.0)

    def test_zero_effective_shares_falls_back_to_shares(self, rates):
        # Characterization: `item.get('effective_shares') or item.get('shares')`
        # means an explicit 0 override is IGNORED and raw shares are used.
        # If a user zeroes out a position via override, it is valued at the
        # full CSV share count. Possibly surprising, but current behavior.
        item = {"price": 10.0, "currency": "EUR", "shares": 100, "effective_shares": 0}
        assert vc.calculate_item_value(item) == pytest.approx(1000.0)

    def test_legacy_price_eur_fallback(self, rates):
        item = {"price_eur": 25.0, "shares": 4}
        assert vc.calculate_item_value(item) == pytest.approx(100.0)

    def test_zero_native_price_falls_back_to_price_eur(self, rates):
        item = {"price": 0, "currency": "USD", "price_eur": 25.0, "shares": 4}
        assert vc.calculate_item_value(item) == pytest.approx(100.0)

    def test_missing_currency_falls_back_to_price_eur(self, rates):
        item = {"price": 100.0, "currency": None, "price_eur": 25.0, "shares": 4}
        assert vc.calculate_item_value(item) == pytest.approx(100.0)

    def test_empty_item_is_zero(self, rates):
        assert vc.calculate_item_value({}) == 0.0

    def test_none_shares_treated_as_zero(self, rates):
        item = {"price": 100.0, "currency": "USD", "shares": None}
        assert vc.calculate_item_value(item) == 0.0


class TestExchangeRateLookup:
    def test_fallback_rate_used_when_currency_missing_from_db(self, monkeypatch):
        monkeypatch.setattr(vc, "_exchange_rates_cache", {"EUR": 1.0})
        assert vc._get_exchange_rate("USD") == vc._FALLBACK_RATES["USD"]

    def test_unknown_currency_defaults_to_1(self, monkeypatch):
        monkeypatch.setattr(vc, "_exchange_rates_cache", {"EUR": 1.0})
        assert vc._get_exchange_rate("XYZ") == 1.0

    def test_empty_currency_is_1(self):
        assert vc._get_exchange_rate("") == 1.0
        assert vc._get_exchange_rate("EUR") == 1.0

    def test_rates_load_from_database(self, db):
        seed_rate(db, "USD", 0.85)
        db.commit()
        assert vc._get_exchange_rate("USD") == pytest.approx(0.85)

    def test_clear_cache_forces_reload(self, db):
        seed_rate(db, "USD", 0.85)
        db.commit()
        assert vc._get_exchange_rate("USD") == pytest.approx(0.85)

        db.execute("UPDATE exchange_rates SET rate = 0.95 WHERE from_currency = 'USD'")
        db.commit()
        # cached value survives until explicitly cleared
        assert vc._get_exchange_rate("USD") == pytest.approx(0.85)
        vc.clear_exchange_rate_cache()
        assert vc._get_exchange_rate("USD") == pytest.approx(0.95)


class TestPortfolioTotal:
    def test_sums_mixed_sources(self, rates):
        items = [
            {"is_custom_value": True, "custom_total_value": 1000.0},
            {"price": 100.0, "currency": "USD", "shares": 10},  # 900
            {"price_eur": 50.0, "shares": 2},  # 100
        ]
        assert vc.calculate_portfolio_total(items) == pytest.approx(2000.0)

    def test_empty_list_is_zero(self):
        assert vc.calculate_portfolio_total([]) == 0.0


class TestValueSource:
    def test_custom(self):
        assert (
            vc.get_value_source({"is_custom_value": True, "custom_total_value": 1})
            == "custom"
        )

    def test_market_native(self):
        assert vc.get_value_source({"price": 10, "currency": "USD"}) == "market"

    def test_market_legacy(self):
        assert vc.get_value_source({"price_eur": 10}) == "market"

    def test_none(self):
        assert vc.get_value_source({}) == "none"
        assert vc.get_value_source({"price_eur": 0}) == "none"

    def test_has_price_or_custom_value(self):
        assert vc.has_price_or_custom_value({"price_eur": 10}) is True
        assert vc.has_price_or_custom_value({}) is False
