"""Synthetic regressions for full-history imports; never open application data."""
import pandas as pd
import pytest

from app.utils.csv_processing.parser import parse_csv_file
from app.utils.csv_processing.company_processor import process_companies
from tests.conftest import seed_account, seed_company, seed_portfolio, seed_shares
from tests.test_csv_import_db import make_txn_df


HEADER = "datetime;price;shares;fee;tax;type;holdingname;identifier\n"


@pytest.mark.parametrize("date", ["", "not-a-date", "2026-02-30"])
def test_invalid_history_dates_are_rejected_even_in_add_mode(date):
    csv = HEADER + f"{date};10;1;0;0;buy;Example;EXAMPLE\n"
    with pytest.raises(ValueError, match="date"):
        parse_csv_file(csv)


def test_iso_and_german_dates_keep_calendar_meaning_and_utc_order():
    csv = HEADER + (
        "2026-07-01T00:30:00+02:00;10;1;0;0;buy;A;A\n"
        "01.07.2026;10;1;0;0;buy;B;B\n"
        "2026-07-02T01:00:00Z;10;1;0;0;buy;C;C\n"
    )
    df = parse_csv_file(csv)
    assert list(df["parsed_date"]) == [
        pd.Timestamp("2026-06-30 22:30:00"),
        pd.Timestamp("2026-07-01"),
        pd.Timestamp("2026-07-02 01:00:00"),
    ]


@pytest.mark.parametrize("column", ["shares", "price", "fee", "tax"])
@pytest.mark.parametrize("value", ["inf", "-inf", "1e309", "garbage"])
def test_replace_rejects_nonfinite_or_invalid_numbers(column, value):
    row = dict(datetime="2026-07-01", price="10", shares="1", fee="0", tax="0",
               type="buy", holdingname="Example", identifier="EXAMPLE")
    row[column] = value
    csv = HEADER + ";".join(row.values()) + "\n"
    with pytest.raises(ValueError, match="Invalid holding row"):
        parse_csv_file(csv, strict_rows=True)


@pytest.mark.parametrize("column", ["shares", "price"])
def test_blank_required_number_is_not_zero(column):
    row = ["2026-07-01", "10", "1", "", "", "buy", "Example", "EXAMPLE"]
    row[2 if column == "shares" else 1] = ""
    with pytest.raises(ValueError, match="Invalid holding row"):
        parse_csv_file(HEADER + ";".join(row) + "\n", strict_rows=True)


def test_reconstruction_follows_time_not_transaction_direction(db):
    account = seed_account(db)
    df = make_txn_df([
        ("Example", "EXAMPLE", "buy", 10, 20, "2026-03-01"),
        ("Example", "EXAMPLE", "sell", 5, 30, "2026-02-01"),
        ("Example", "EXAMPLE", "buy", 10, 10, "2026-01-01"),
    ])
    _, positions = process_companies(df, account, db.cursor())
    assert positions["Example"]["total_shares"] == 15
    assert positions["Example"]["total_invested"] == pytest.approx(250)


@pytest.mark.parametrize("source", ["manual", "ibkr"])
@pytest.mark.parametrize("new_name", ["Example", "Renamed"])
def test_other_source_cannot_be_updated_or_renamed(db, source, new_name):
    account = seed_account(db)
    portfolio = seed_portfolio(db, account)
    company = seed_company(db, account, portfolio, "Example", "EXAMPLE", source=source)
    seed_shares(db, company, 7)
    db.commit()
    df = make_txn_df([(new_name, "EXAMPLE", "buy", 2, 10, "2026-01-01")])
    with pytest.raises(ValueError, match="source conflict"):
        process_companies(df, account, db.cursor())
    assert db.execute("SELECT name FROM companies WHERE id=?", [company]).fetchone()["name"] == "Example"


@pytest.mark.parametrize("kind,expected_shares,expected_basis", [
    ("buy", 15, 200), ("sell", 5, 50), ("transferout", 5, 50),
])
def test_historical_names_reconstruct_one_identifier(db, kind, expected_shares, expected_basis):
    account = seed_account(db)
    df = make_txn_df([
        ("New Name", " same ", kind, 5, 20, "2026-02-01"),
        ("Old Name", "SAME", "buy", 10, 10, "2026-01-01"),
    ])
    _, positions = process_companies(df, account, db.cursor())
    assert list(positions) == ["New Name"]
    assert positions["New Name"]["identifier"] == "SAME"
    assert positions["New Name"]["total_shares"] == expected_shares
    assert positions["New Name"]["total_invested"] == expected_basis
    assert positions["New Name"]["first_bought_date"] == pd.Timestamp("2026-01-01")


def test_same_timestamp_preserves_file_order_for_reopened_holding(db):
    account = seed_account(db)
    df = make_txn_df([
        ("Example", "EXAMPLE", "buy", 10, 10, "2026-01-01"),
        ("Example", "EXAMPLE", "sell", 10, 30, "2026-01-01"),
        ("Example", "EXAMPLE", "transferin", 5, 20, "2026-01-01"),
    ])
    _, positions = process_companies(df, account, db.cursor())
    assert positions["Example"]["total_shares"] == 5
    assert positions["Example"]["total_invested"] == pytest.approx(100)


@pytest.mark.parametrize("imported_name", ["Example", "Renamed"])
def test_identical_history_reimport_preserves_manual_shares(db, monkeypatch, imported_name):
    from app.utils.portfolio_processing import process_csv_data
    monkeypatch.setattr("app.utils.csv_processing.update_prices_from_csv", lambda *a, **kw: [])
    account = seed_account(db)
    portfolio = seed_portfolio(db, account, "Assigned")
    company = seed_company(db, account, portfolio, "Example", "EXAMPLE")
    seed_shares(db, company, 10, override_share=20, is_manually_edited=1,
                manual_edit_date="2026-02-01 00:00:00")
    db.commit()
    csv = HEADER + (
        "2026-01-01;10;10;0;0;buy;Example;EXAMPLE\n"
        f"2026-03-01;20;2;0;0;buy;{imported_name};EXAMPLE\n"
    )
    for _ in range(2):
        success, message, _ = process_csv_data(account, csv, mode="add")
        assert success, message
        row = db.execute("SELECT shares,override_share FROM company_shares WHERE company_id=?", [company]).fetchone()
        assert row["shares"] == 12
        assert row["override_share"] == 22
        assert db.execute("SELECT portfolio_id FROM companies WHERE id=?", [company]).fetchone()["portfolio_id"] == portfolio
        assert db.execute("SELECT name FROM companies WHERE id=?", [company]).fetchone()["name"] == imported_name


@pytest.mark.parametrize("kind", ["sell", "transferout"])
def test_incomplete_history_rejected_without_changing_saved_holdings(db, monkeypatch, kind):
    from app.utils.portfolio_processing import process_csv_data
    monkeypatch.setattr("app.utils.csv_processing.update_prices_from_csv", lambda *a, **kw: [])
    account = seed_account(db)
    portfolio = seed_portfolio(db, account)
    company = seed_company(db, account, portfolio, "Example", "EXAMPLE", total_invested=70)
    seed_shares(db, company, 7)
    db.commit()
    before = dict(db.execute("SELECT * FROM companies WHERE id=?", [company]).fetchone())
    csv = HEADER + (
        f"2026-01-01;10;5;0;0;{kind};Example;EXAMPLE\n"
        "2026-02-01;10;10;0;0;buy;Example;EXAMPLE\n"
    )
    success, message, _ = process_csv_data(account, csv, mode="add")
    assert not success
    assert "Incomplete transaction history" in message
    assert dict(db.execute("SELECT * FROM companies WHERE id=?", [company]).fetchone()) == before
    assert db.execute("SELECT shares FROM company_shares WHERE company_id=?", [company]).fetchone()["shares"] == 7


def test_transfer_history_can_close_and_reopen_a_position(db):
    account = seed_account(db)
    df = make_txn_df([
        ("Example", "EXAMPLE", "transferin", 10, 10, "2026-01-01"),
        ("Example", "EXAMPLE", "transferout", 10, 20, "2026-02-01"),
        ("Example", "EXAMPLE", "buy", 2, 30, "2026-03-01"),
    ])
    _, positions = process_companies(df, account, db.cursor())
    assert positions["Example"]["total_shares"] == 2
    assert positions["Example"]["total_invested"] == 60


@pytest.mark.parametrize("value,expected", [("1.234", 1234), ("12.345.678", 12345678), ("1.234,50", 1234.5)])
def test_parqet_german_thousands_grouping_is_preserved(value, expected):
    csv = HEADER + f"2026-07-01;{value};1;0;0;buy;Example;EXAMPLE\n"
    assert parse_csv_file(csv).iloc[0]["price"] == expected


def test_ibkr_dot_decimal_conversion_is_not_treated_as_german_grouping():
    from app.utils.csv_processing.parser import _convert_numeric
    assert _convert_numeric("1.234", "price") == 1.234


@pytest.mark.parametrize("mode", ["add", "replace"])
@pytest.mark.parametrize("invalid_row", [
    "2026-01-01;10;2;0;0;buy;;EXAMPLE\n",
    "2026-01-01;10;-2;0;0;sell;Example;EXAMPLE\n",
    "2026-01-01;-10;2;0;0;buy;Example;EXAMPLE\n",
])
def test_invalid_name_or_signed_amount_preserves_state(db, monkeypatch, mode, invalid_row):
    from app.utils.portfolio_processing import process_csv_data
    monkeypatch.setattr("app.utils.csv_processing.update_prices_from_csv", lambda *a, **kw: [])
    account = seed_account(db)
    portfolio = seed_portfolio(db, account, "Preserved")
    company = seed_company(db, account, portfolio, "Example", "EXAMPLE", total_invested=20)
    seed_shares(db, company, shares=2)
    db.commit()
    success, _, _ = process_csv_data(account, HEADER + invalid_row, mode=mode)
    assert not success
    assert dict(db.execute("SELECT name,portfolio_id,total_invested FROM companies WHERE id=?", [company]).fetchone()) == {
        "name": "Example", "portfolio_id": portfolio, "total_invested": 20,
    }
    assert db.execute("SELECT shares FROM company_shares WHERE company_id=?", [company]).fetchone()["shares"] == 2


@pytest.mark.parametrize("second_name", ["Example", "EXAMPLE"])
def test_duplicate_display_name_different_identifiers_is_rejected(db, second_name):
    account = seed_account(db)
    df = make_txn_df([
        ("Example", "FIRST", "buy", 1, 10, "2026-01-01"),
        (second_name, "SECOND", "buy", 2, 20, "2026-02-01"),
    ])
    with pytest.raises(ValueError, match="identity collision"):
        process_companies(df, account, db.cursor())
    assert db.execute("SELECT COUNT(*) FROM companies WHERE account_id=?", [account]).fetchone()[0] == 0
