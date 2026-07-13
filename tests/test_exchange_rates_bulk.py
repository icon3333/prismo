"""
Tests for the bulk exchange-rate fetch path added alongside the hourly/startup
FX refresh:

- app/utils/yfinance_utils.py::fetch_exchange_rates_from_network_bulk — one
  yf.download for many currencies, with GBp->GBP 0.01 scaling, same-currency
  short-circuit, and per-currency omission on missing/NaN/non-positive close.
- app/utils/startup_tasks.py::_fetch_exchange_rates — bulk first, serial
  fallback for ONLY the currencies bulk did not resolve.

Network is never touched: the bulk path is exercised by monkeypatching the
download helper (_yf_download_close_columns) with a synthetic Close frame, and
the serial fallback by monkeypatching the two yfinance entry points.
"""

import pandas as pd
import pytest

from app.utils import yfinance_utils as yfu


def _patch_download(monkeypatch, close_df, columns_by_upper):
    monkeypatch.setattr(
        yfu, "_yf_download_close_columns", lambda tickers: (close_df, columns_by_upper)
    )


def test_bulk_rate_math_gbp_scaling_same_currency_and_missing(monkeypatch):
    # USDEUR=X and GBPEUR=X present; JPYEUR=X deliberately absent.
    df = pd.DataFrame({"USDEUR=X": [0.90, 0.92], "GBPEUR=X": [1.14, 1.15]})
    cols = {"USDEUR=X": "USDEUR=X", "GBPEUR=X": "GBPEUR=X"}
    _patch_download(monkeypatch, df, cols)

    rates = yfu.fetch_exchange_rates_from_network_bulk(["USD", "GBp", "EUR", "JPY"], "EUR")

    assert rates["USD"] == 0.92                        # last close, base_rate 1.0
    assert rates["GBp"] == pytest.approx(1.15 * 0.01)  # GBP ticker column * 0.01
    assert rates["EUR"] == 1.0                         # same-currency short-circuit
    assert "JPY" not in rates                          # no data column -> omitted


def test_bulk_omits_all_nan_and_non_positive_closes(monkeypatch):
    df = pd.DataFrame(
        {"USDEUR=X": [float("nan"), float("nan")], "CHFEUR=X": [-1.0, 0.0]}
    )
    cols = {"USDEUR=X": "USDEUR=X", "CHFEUR=X": "CHFEUR=X"}
    _patch_download(monkeypatch, df, cols)

    # SEK has no column at all; USD is all-NaN (dropna -> empty); CHF last <= 0.
    rates = yfu.fetch_exchange_rates_from_network_bulk(["USD", "CHF", "SEK"], "EUR")

    assert rates == {}


def test_bulk_empty_and_falsy_input_returns_empty():
    assert yfu.fetch_exchange_rates_from_network_bulk([], "EUR") == {}
    assert yfu.fetch_exchange_rates_from_network_bulk(None, "EUR") == {}
    # Only the base currency -> short-circuits without any network column.
    assert yfu.fetch_exchange_rates_from_network_bulk(["EUR"], "EUR") == {"EUR": 1.0}


def test_serial_fallback_runs_only_for_currencies_bulk_missed(monkeypatch):
    from app.utils import startup_tasks

    monkeypatch.setattr(
        yfu, "fetch_exchange_rates_from_network_bulk", lambda currs, to="EUR": {"USD": 0.92}
    )
    called = []

    def fake_serial(currency, to="EUR"):
        called.append(currency)
        return 1.5

    monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", fake_serial)

    rates = startup_tasks._fetch_exchange_rates(["USD", "GBP"])

    assert rates == {"USD": 0.92, "GBP": 1.5}
    assert called == ["GBP"]  # serial NOT invoked for the currency bulk resolved


def test_bulk_exception_degrades_to_full_serial(monkeypatch):
    from app.utils import startup_tasks

    def boom(*args, **kwargs):
        raise RuntimeError("yfinance unreachable")

    monkeypatch.setattr(yfu, "fetch_exchange_rates_from_network_bulk", boom)
    monkeypatch.setattr(yfu, "fetch_exchange_rate_from_network", lambda c, to="EUR": 2.0)

    rates = startup_tasks._fetch_exchange_rates(["USD", "GBP"])

    assert rates == {"USD": 2.0, "GBP": 2.0}
