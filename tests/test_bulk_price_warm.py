"""Tests for the bulk price-cache warmer (warm_price_cache_bulk).

yfinance is mocked — the warmer's contract is: one yf.download call, seed the
isin_data_ cache with get_isin_data-shaped results for proven tickers only,
never touch ISINs or never-resolved identifiers, and report accurate stats.
"""
import pandas as pd
import pytest

from app.cache import cache
from app.utils import yfinance_utils
from tests.conftest import seed_price, seed_rate


class FakeYF:
    """Stands in for the yfinance module; records download() calls."""

    def __init__(self, close_frame):
        self.close_frame = close_frame
        self.calls = []

    def download(self, tickers, **kwargs):
        self.calls.append(tickers)
        return pd.DataFrame({'Close': self.close_frame}) if isinstance(
            self.close_frame, pd.Series) else self.close_frame


def make_close_df(prices: dict) -> pd.DataFrame:
    """Multi-ticker yf.download shape: top-level 'Close' column group."""
    idx = pd.to_datetime(['2026-07-06'])
    return pd.concat(
        {'Close': pd.DataFrame({t: [p] for t, p in prices.items()}, index=idx)},
        axis=1)


@pytest.fixture(autouse=True)
def _cache(app):
    cache.init_app(app, config={'CACHE_TYPE': 'SimpleCache'})
    with app.app_context():
        cache.clear()
    yield


def warm(monkeypatch, db, identifiers, close_df):
    fake = FakeYF(close_df)
    monkeypatch.setattr(yfinance_utils, '_get_yfinance', lambda: fake)
    stats = yfinance_utils.warm_price_cache_bulk(identifiers)
    return stats, fake


class TestWarmPriceCacheBulk:
    def test_warms_proven_tickers_with_one_download(self, db, monkeypatch):
        seed_price(db, 'AAPL', price=100, currency='USD', price_eur=90)
        seed_price(db, 'AIR.PA', price=150, currency='EUR', price_eur=150)
        seed_rate(db, 'USD', 0.9)
        db.commit()

        stats, fake = warm(monkeypatch, db, ['AAPL', 'AIR.PA'],
                           make_close_df({'AAPL': 200.0, 'AIR.PA': 160.0}))

        assert len(fake.calls) == 1
        assert sorted(stats['warmed']) == ['AAPL', 'AIR.PA']
        assert stats['fallback'] == []

        cached = cache.get('isin_data_AAPL')
        assert cached['success'] is True
        assert cached['data']['currentPrice'] == 200.0
        assert cached['data']['priceEUR'] == pytest.approx(180.0)
        assert cached['data']['currency'] == 'USD'
        assert cached['modified_identifier'] is None

        # get_isin_data must now be a pure cache hit (no network path)
        monkeypatch.setattr(
            'app.utils.identifier_normalization.fetch_price_with_crypto_fallback',
            lambda *_: (_ for _ in ()).throw(AssertionError('network hit')))
        assert yfinance_utils.get_isin_data('AAPL') == cached

    def test_reuses_stored_country(self, db, monkeypatch):
        db.execute(
            "INSERT INTO market_prices (identifier, price, currency, price_eur, country, last_updated)"
            " VALUES ('AAPL', 100, 'USD', 90, 'United States', datetime('now'))")
        seed_rate(db, 'USD', 0.9)
        db.commit()

        warm(monkeypatch, db, ['AAPL'], make_close_df({'AAPL': 200.0}))
        assert cache.get('isin_data_AAPL')['data']['country'] == 'United States'

    def test_isins_and_unknown_identifiers_fall_back(self, db, monkeypatch):
        seed_price(db, 'AAPL', price=100, currency='USD', price_eur=90)
        seed_rate(db, 'USD', 0.9)
        db.commit()

        isin = 'US0378331005'
        stats, fake = warm(monkeypatch, db, [isin, 'NEVERSEEN', 'AAPL'],
                           make_close_df({'AAPL': 200.0}))

        # Only the proven ticker was attempted/downloaded
        assert fake.calls == [['AAPL']]
        assert stats['warmed'] == ['AAPL']
        assert sorted(stats['fallback']) == ['NEVERSEEN', isin]
        assert cache.get(f'isin_data_{isin}') is None
        assert cache.get('isin_data_NEVERSEEN') is None

    def test_missing_column_and_nan_fall_back(self, db, monkeypatch):
        seed_price(db, 'AAPL', price=100, currency='USD', price_eur=90)
        seed_price(db, 'MSFT', price=100, currency='USD', price_eur=90)
        seed_rate(db, 'USD', 0.9)
        db.commit()

        # MSFT column entirely NaN; AAPL fine
        df = make_close_df({'AAPL': 200.0, 'MSFT': float('nan')})
        stats, _ = warm(monkeypatch, db, ['AAPL', 'MSFT'], df)

        assert stats['warmed'] == ['AAPL']
        assert 'MSFT' in stats['fallback']
        assert cache.get('isin_data_MSFT') is None

    def test_no_fx_rate_means_fallback(self, db, monkeypatch):
        # USD price but no stored USD rate and network fetch unavailable
        seed_price(db, 'AAPL', price=100, currency='USD', price_eur=90)
        db.commit()
        monkeypatch.setattr(
            yfinance_utils, 'fetch_exchange_rate_from_network', lambda *a, **k: None)

        stats, _ = warm(monkeypatch, db, ['AAPL'], make_close_df({'AAPL': 200.0}))
        assert stats['warmed'] == []
        assert cache.get('isin_data_AAPL') is None

    def test_gbp_pence_uses_scaled_rate(self, db, monkeypatch):
        seed_price(db, 'BARC.L', price=200, currency='GBp', price_eur=2.3)
        seed_rate(db, 'GBP', 1.15)
        db.commit()

        warm(monkeypatch, db, ['BARC.L'], make_close_df({'BARC.L': 250.0}))
        cached = cache.get('isin_data_BARC.L')
        # 250 pence × 1.15 EUR/GBP × 0.01 = 2.875 EUR
        assert cached['data']['priceEUR'] == pytest.approx(2.875)

    def test_empty_and_no_candidates_are_noops(self, db, monkeypatch):
        fake = FakeYF(make_close_df({}))
        monkeypatch.setattr(yfinance_utils, '_get_yfinance', lambda: fake)
        assert yfinance_utils.warm_price_cache_bulk([])['attempted'] == []
        stats = yfinance_utils.warm_price_cache_bulk(['US0378331005'])
        assert stats['attempted'] == []
        assert fake.calls == []
