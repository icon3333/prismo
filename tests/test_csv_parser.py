"""
Characterization tests for app/utils/csv_processing/parser.py.

Covers Parqet (semicolon, German decimals, transaction-based) and IBKR Flex
Query (comma, snapshot) parsing plus format auto-detection. Pure pandas —
no DB, no network.
"""

import pandas as pd
import pytest

from app.utils.csv_processing.parser import (
    detect_csv_format,
    parse_csv_file,
    parse_ibkr_csv,
    _normalize_transaction_type,
)

PARQET_CSV = (
    "datetime;price;shares;tax;fee;type;holdingname;identifier;currency\n"
    "2023-05-15T08:00:00.000Z;100,50;2,5;0;1;buy;Apple Inc;US0378331005;EUR\n"
    "2023-06-01T08:00:00.000Z;110,00;1,0;0;1;sell;Apple Inc;US0378331005;EUR\n"
    "2023-04-01T08:00:00.000Z;50,00;10;0;0;buy;Siemens AG;DE0007236101;EUR\n"
)

IBKR_CSV = (
    "ClientAccountID,CurrencyPrimary,FXRateToBase,AssetClass,Symbol,Description,"
    "ISIN,Quantity,MarkPrice,PositionValue,CostBasisMoney,Side,OpenDateTime\n"
    "U123,USD,0.92,STK,AAPL,APPLE INC,US0378331005,10,150,1500,1200,Long,20230115;093000\n"
    "U123,USD,0.92,ETF,VOO,VANGUARD SP500,US9229083632,5,400,2000,1800,Long,20220601;120000\n"
    "U123,USD,0.92,OPT,AAPL C150,AAPL CALL OPTION,,2,5,1000,900,Long,20230201;100000\n"
    "U123,USD,0.92,STK,TSLA,TESLA INC,US88160R1014,3,200,600,700,SHORT,20230301;100000\n"
)


class TestFormatDetection:
    def test_parqet_detected_by_semicolon(self):
        assert detect_csv_format(PARQET_CSV) == "parqet"

    def test_ibkr_detected_by_columns(self):
        assert detect_csv_format(IBKR_CSV) == "ibkr"

    def test_ambiguous_defaults_to_parqet(self):
        assert detect_csv_format("foo,bar\n1,2\n") == "parqet"


class TestParqetParsing:
    def test_parses_german_decimals(self):
        df = parse_csv_file(PARQET_CSV)
        apple_buy = df[(df["holdingname"] == "Apple Inc") & (df["type"] == "buy")]
        assert apple_buy.iloc[0]["price"] == pytest.approx(100.50)
        assert apple_buy.iloc[0]["shares"] == pytest.approx(2.5)

    def test_rows_sorted_chronologically(self):
        df = parse_csv_file(PARQET_CSV)
        dates = df["parsed_date"].tolist()
        assert dates == sorted(dates)
        assert df.iloc[0]["holdingname"] == "Siemens AG"  # April buy first

    def test_missing_required_column_raises(self):
        bad = "price;shares;type\n1;1;buy\n"
        with pytest.raises(ValueError, match="Missing required columns"):
            parse_csv_file(bad)

    def test_rows_with_empty_identifier_dropped(self):
        csv = (
            "date;price;shares;type;holdingname;identifier\n"
            "01.05.2023;10,0;1;buy;Good Co;GOOD\n"
            "02.05.2023;10,0;1;buy;Bad Co;\n"
        )
        df = parse_csv_file(csv)
        assert list(df["holdingname"]) == ["Good Co"]

    def test_all_rows_invalid_raises(self):
        csv = "date;price;shares;type;holdingname;identifier\n01.05.2023;10,0;1;buy;X;\n"
        with pytest.raises(ValueError, match="No valid entries"):
            parse_csv_file(csv)

    def test_german_date_format_survives_thousands_separator_corruption(self):
        # pd.read_csv(thousands='.') turns '15.05.2023' into int 15052023;
        # the parser must reconstruct DD.MM.YYYY from it.
        csv = (
            "date;price;shares;type;holdingname;identifier\n"
            "15.05.2023;10,0;1;buy;A Co;AAA\n"
            "01.04.2023;10,0;1;buy;B Co;BBB\n"
        )
        df = parse_csv_file(csv)
        parsed = {r["holdingname"]: r["parsed_date"] for _, r in df.iterrows()}
        assert parsed["A Co"] == pd.Timestamp(2023, 5, 15)
        assert parsed["B Co"] == pd.Timestamp(2023, 4, 1)

    def test_missing_optional_columns_get_defaults(self):
        csv = (
            "date;price;shares;type;holdingname;identifier\n"
            "01.05.2023;10,0;1;buy;A Co;AAA\n"
        )
        df = parse_csv_file(csv)
        row = df.iloc[0]
        assert row["currency"] == "EUR"
        assert row["fee"] == 0
        assert row["tax"] == 0

    def test_invalid_numeric_rows_dropped(self):
        csv = (
            "date;price;shares;type;holdingname;identifier\n"
            "01.05.2023;10,0;1;buy;Good Co;GOOD\n"
            "02.05.2023;abc;1;buy;Bad Co;BAD\n"
        )
        df = parse_csv_file(csv)
        assert list(df["holdingname"]) == ["Good Co"]


class TestTransactionTypeNormalization:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("buy", "buy"),
            ("Purchase", "buy"),
            ("SELL", "sell"),
            ("TransferIn", "transferin"),
            ("transfer out", "transferout"),
            ("dividend", "dividend"),
            ("interest", "dividend"),
            ("mystery-type", "buy"),  # unknown defaults to buy
            (None, "buy"),
        ],
    )
    def test_normalization(self, raw, expected):
        if raw is None:
            raw = float("nan")
        assert _normalize_transaction_type(raw) == expected

    def test_deposit_is_buy_not_transferin(self):
        # 'deposit' appears in both _BUY_TYPES and _TRANSFERIN_TYPES;
        # buy wins because it is checked first.
        assert _normalize_transaction_type("deposit") == "buy"


class TestIbkrParsing:
    def test_prefers_isin_as_identifier(self):
        df = parse_ibkr_csv(IBKR_CSV)
        apple = df[df["holdingname"] == "APPLE INC"].iloc[0]
        assert apple["identifier"] == "US0378331005"

    def test_filters_options_and_shorts(self):
        df = parse_ibkr_csv(IBKR_CSV)
        names = set(df["holdingname"])
        assert "AAPL CALL OPTION" not in names  # OPT filtered
        assert "TESLA INC" not in names  # SHORT filtered
        assert names == {"APPLE INC", "VANGUARD SP500"}

    def test_cost_basis_converted_to_eur_with_fx_rate(self):
        df = parse_ibkr_csv(IBKR_CSV)
        apple = df[df["holdingname"] == "APPLE INC"].iloc[0]
        assert apple["total_invested"] == pytest.approx(1200 * 0.92)

    def test_investment_type_mapped_from_asset_class(self):
        df = parse_ibkr_csv(IBKR_CSV)
        by_name = {r["holdingname"]: r for _, r in df.iterrows()}
        assert by_name["APPLE INC"]["investment_type"] == "Stock"
        assert by_name["VANGUARD SP500"]["investment_type"] == "ETF"

    def test_open_datetime_parsed_as_first_bought(self):
        df = parse_ibkr_csv(IBKR_CSV)
        apple = df[df["holdingname"] == "APPLE INC"].iloc[0]
        assert apple["first_bought_date"].year == 2023
        assert apple["first_bought_date"].month == 1
        assert apple["first_bought_date"].day == 15

    def test_symbol_fallback_when_isin_empty(self):
        csv = (
            "CurrencyPrimary,AssetClass,Symbol,Description,ISIN,Quantity,MarkPrice\n"
            "USD,STK,GOOG,ALPHABET,,4,100\n"
        )
        df = parse_ibkr_csv(csv)
        assert df.iloc[0]["identifier"] == "GOOG"

    def test_price_derived_from_position_value_when_no_mark_price(self):
        csv = (
            "CurrencyPrimary,AssetClass,Symbol,Description,ISIN,Quantity,PositionValue\n"
            "USD,STK,GOOG,ALPHABET,US02079K3059,4,480\n"
        )
        df = parse_ibkr_csv(csv)
        assert df.iloc[0]["price"] == pytest.approx(120.0)

    def test_total_summary_rows_dropped(self):
        csv = (
            "CurrencyPrimary,AssetClass,Symbol,Description,ISIN,Quantity,MarkPrice\n"
            "USD,STK,AAPL,APPLE,US0378331005,10,150\n"
            "USD,STK,Total,,Total,10,150\n"
        )
        df = parse_ibkr_csv(csv)
        assert len(df) == 1

    def test_zero_share_positions_dropped(self):
        csv = (
            "CurrencyPrimary,AssetClass,Symbol,Description,ISIN,Quantity,MarkPrice\n"
            "USD,STK,AAPL,APPLE,US0378331005,0,150\n"
            "USD,STK,MSFT,MICROSOFT,US5949181045,5,300\n"
        )
        df = parse_ibkr_csv(csv)
        assert list(df["holdingname"]) == ["MICROSOFT"]

    def test_missing_required_columns_raises(self):
        with pytest.raises(ValueError, match="Missing required IBKR columns"):
            parse_ibkr_csv("Foo,Bar\n1,2\n")
