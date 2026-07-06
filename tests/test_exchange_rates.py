"""
Tests for the DB-first exchange rate lookup in app/utils/yfinance_utils.py.

Contract under test (no silent 1.0 fallback):
1. Fresh DB rate (<24h) short-circuits — no network call.
2. DB miss/stale → network fetch; success is persisted to the DB.
3. Network failure → newest stored rate regardless of age, with a warning.
4. No rate ever stored + network failure → None (never a silent 1:1).
"""

import logging

import pytest

from app.utils import yfinance_utils as yfu
from tests.conftest import seed_rate


@pytest.fixture
def fx_cache(app):
    """yfinance_utils uses the shared Flask-Caching instance (negative cache);
    the bare test app doesn't initialize it, so do it here."""
    from app.cache import cache

    cache.init_app(app, config={"CACHE_TYPE": "SimpleCache"})
    return cache


def seed_stale_rate(conn, from_currency, rate, hours_old=100):
    conn.execute(
        """INSERT INTO exchange_rates (from_currency, to_currency, rate, last_updated)
           VALUES (?, 'EUR', ?, datetime('now', ?))""",
        [from_currency, rate, f"-{hours_old} hours"],
    )
    conn.commit()


def fail_network(monkeypatch):
    """Simulate yfinance being unreachable."""
    monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", lambda *a, **k: None)


def forbid_network(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("network fetch must not be called")

    monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", _boom)


class TestGetExchangeRate:
    def test_same_currency_short_circuits_to_1(self):
        assert yfu.get_exchange_rate("EUR", "EUR") == 1.0
        assert yfu.get_exchange_rate("USD", "USD") == 1.0

    def test_fresh_db_rate_skips_network(self, db, fx_cache, monkeypatch):
        seed_rate(db, "USD", 0.92)
        db.commit()
        forbid_network(monkeypatch)

        assert yfu.get_exchange_rate("USD") == pytest.approx(0.92)

    def test_db_miss_fetches_and_persists(self, db, fx_cache, monkeypatch):
        monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", lambda *a, **k: 0.91)

        assert yfu.get_exchange_rate("USD") == pytest.approx(0.91)

        from app.repositories.exchange_rate_repository import ExchangeRateRepository

        assert ExchangeRateRepository.get_rate("USD") == pytest.approx(0.91)

    def test_stale_db_rate_triggers_refetch(self, db, fx_cache, monkeypatch):
        seed_stale_rate(db, "USD", 0.80)
        monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", lambda *a, **k: 0.93)

        assert yfu.get_exchange_rate("USD") == pytest.approx(0.93)

    def test_network_failure_falls_back_to_newest_stored_rate(
        self, db, fx_cache, monkeypatch, caplog
    ):
        seed_stale_rate(db, "USD", 0.88)
        fail_network(monkeypatch)

        with caplog.at_level(logging.WARNING, logger="app.utils.yfinance_utils"):
            assert yfu.get_exchange_rate("USD") == pytest.approx(0.88)

        assert any("stale exchange rate" in r.message.lower() for r in caplog.records)

    def test_no_rate_ever_and_network_down_returns_none(self, db, fx_cache, monkeypatch):
        fail_network(monkeypatch)

        assert yfu.get_exchange_rate("USD") is None

    def test_failure_is_negative_cached_briefly(self, db, fx_cache, monkeypatch):
        calls = []

        def failing_fetch(*args, **kwargs):
            calls.append(args)
            return None

        monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", failing_fetch)

        assert yfu.get_exchange_rate("USD") is None
        assert yfu.get_exchange_rate("USD") is None
        assert len(calls) == 1  # second call hit the negative cache

    def test_negative_cache_never_blocks_a_good_db_rate(self, db, fx_cache, monkeypatch):
        fail_network(monkeypatch)
        assert yfu.get_exchange_rate("USD") is None  # sets fx_fail marker

        seed_rate(db, "USD", 0.92)  # e.g. startup refresh succeeded meanwhile
        db.commit()
        forbid_network(monkeypatch)

        assert yfu.get_exchange_rate("USD") == pytest.approx(0.92)

    def test_gbp_pence_uses_whole_gbp_rate(self, db, fx_cache, monkeypatch):
        seed_rate(db, "GBP", 1.17)
        db.commit()
        forbid_network(monkeypatch)

        assert yfu.get_exchange_rate("GBp") == pytest.approx(0.0117)


class TestGetIsinDataFxContract:
    """get_isin_data must surface priceEUR=None (not a 1:1 value) when no
    rate exists, and must not cache that result so conversion recovers."""

    @pytest.fixture
    def price_fetch(self, monkeypatch):
        import app.utils.identifier_normalization as idn

        monkeypatch.setattr(
            idn,
            "fetch_price_with_crypto_fallback",
            lambda identifier: {"price": 100.0, "currency": "USD"},
        )

    def test_missing_rate_yields_unconverted_price_and_no_cache(
        self, db, fx_cache, monkeypatch, price_fetch
    ):
        monkeypatch.setattr(yfu, "get_exchange_rate", lambda *a, **k: None)
        result = yfu.get_isin_data("TEST-FX")
        assert result["success"] is True
        assert result["data"]["currentPrice"] == 100.0
        assert result["data"]["priceEUR"] is None

        # Rate becomes available → next call converts (result wasn't cached)
        monkeypatch.setattr(yfu, "get_exchange_rate", lambda *a, **k: 0.9)
        result = yfu.get_isin_data("TEST-FX")
        assert result["data"]["priceEUR"] == pytest.approx(90.0)

    def test_converted_result_is_cached(self, db, fx_cache, monkeypatch, price_fetch):
        monkeypatch.setattr(yfu, "get_exchange_rate", lambda *a, **k: 0.9)
        first = yfu.get_isin_data("TEST-FX2")
        assert first["data"]["priceEUR"] == pytest.approx(90.0)

        # Cached: a later rate change doesn't re-fetch within the TTL
        monkeypatch.setattr(yfu, "get_exchange_rate", lambda *a, **k: None)
        assert yfu.get_isin_data("TEST-FX2")["data"]["priceEUR"] == pytest.approx(90.0)
