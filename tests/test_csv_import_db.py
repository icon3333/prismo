"""
Integration tests for the CSV import write path against a real schema-seeded
SQLite database: process_companies (buy/sell math) and apply_share_changes
(insert/update/remove with manual + broker-source protection).
"""

import pandas as pd
import pytest

from tests.conftest import (
    seed_account,
    seed_company,
    seed_portfolio,
    seed_price,
    seed_shares,
)


def make_txn_df(rows):
    """rows: (holdingname, identifier, type, shares, price, date)"""
    return pd.DataFrame(
        [
            {
                "holdingname": name,
                "identifier": ident,
                "type": type_,
                "shares": shares,
                "price": price,
                "fee": 0,
                "tax": 0,
                "parsed_date": pd.Timestamp(date),
            }
            for name, ident, type_, shares, price, date in rows
        ]
    )


@pytest.fixture
def account(db):
    account_id = seed_account(db)
    portfolio_id = seed_portfolio(db, account_id, "-")
    db.commit()
    return {"id": account_id, "portfolio_id": portfolio_id}


class TestProcessCompanies:
    def test_buys_accumulate_shares_and_invested(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        df = make_txn_df(
            [
                ("Apple", "AAPL", "buy", 10, 10.0, "2023-01-01"),
                ("Apple", "AAPL", "buy", 10, 20.0, "2023-02-01"),
            ]
        )
        _, positions = process_companies(df, account["id"], db.cursor())
        assert positions["Apple"]["total_shares"] == 20
        assert positions["Apple"]["total_invested"] == pytest.approx(300.0)
        assert positions["Apple"]["first_bought_date"] == pd.Timestamp("2023-01-01")

    def test_sell_reduces_invested_proportionally(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        df = make_txn_df(
            [
                ("Apple", "AAPL", "buy", 20, 15.0, "2023-01-01"),  # 300 invested
                ("Apple", "AAPL", "sell", 10, 20.0, "2023-03-01"),  # sell half
            ]
        )
        _, positions = process_companies(df, account["id"], db.cursor())
        assert positions["Apple"]["total_shares"] == 10
        assert positions["Apple"]["total_invested"] == pytest.approx(150.0)

    def test_overselling_is_limited_to_available_shares(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        df = make_txn_df(
            [
                ("Apple", "AAPL", "buy", 5, 10.0, "2023-01-01"),
                ("Apple", "AAPL", "sell", 50, 10.0, "2023-02-01"),
            ]
        )
        _, positions = process_companies(df, account["id"], db.cursor())
        assert positions["Apple"]["total_shares"] == 0
        assert positions["Apple"]["total_invested"] == pytest.approx(0.0)

    def test_sell_without_position_is_skipped(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        df = make_txn_df([("Ghost", "GHST", "sell", 5, 10.0, "2023-01-01")])
        _, positions = process_companies(df, account["id"], db.cursor())
        assert "Ghost" not in positions

    def test_dividends_do_not_affect_position(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        df = make_txn_df(
            [
                ("Apple", "AAPL", "buy", 10, 10.0, "2023-01-01"),
                ("Apple", "AAPL", "dividend", 100, 0.5, "2023-02-01"),
            ]
        )
        _, positions = process_companies(df, account["id"], db.cursor())
        assert positions["Apple"]["total_shares"] == 10
        assert positions["Apple"]["total_invested"] == pytest.approx(100.0)

    def test_identifiers_normalized_to_uppercase(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        df = make_txn_df([("Apple", " aapl ", "buy", 1, 10.0, "2023-01-01")])
        _, positions = process_companies(df, account["id"], db.cursor())
        assert positions["Apple"]["identifier"] == "AAPL"

    def test_preferred_identifier_mapping_applied(self, db, account):
        from app.utils.csv_processing.company_processor import process_companies

        db.execute(
            """INSERT INTO identifier_mappings (account_id, csv_identifier, preferred_identifier)
               VALUES (?, ?, ?)""",
            [account["id"], "AAPL", "US0378331005"],
        )
        db.commit()
        df = make_txn_df([("Apple", "AAPL", "buy", 1, 10.0, "2023-01-01")])
        _, positions = process_companies(df, account["id"], db.cursor())
        assert positions["Apple"]["identifier"] == "US0378331005"


def run_apply(db, account, share_calcs, positions, to_remove=frozenset(), source="parqet", force=False):
    from app.db_manager import query_db
    from app.utils.csv_processing.transaction_manager import apply_share_changes

    existing = query_db(
        "SELECT id, name, identifier, total_invested, portfolio_id FROM companies WHERE account_id = ?",
        [account["id"]],
    )
    existing_map = {c["name"]: c for c in existing}
    result = apply_share_changes(
        account_id=account["id"],
        company_positions=positions,
        share_calculations=share_calcs,
        existing_company_map=existing_map,
        override_map={},
        default_portfolio_id=account["portfolio_id"],
        companies_to_remove=set(to_remove),
        cursor=db.cursor(),
        source=source,
        force_remove_all=force,
    )
    db.commit()
    return result


def plain_calc(shares):
    return {
        "csv_shares": shares,
        "override_shares": None,
        "has_manual_edit": False,
        "csv_modified_after_edit": False,
    }


def plain_position(identifier, invested=0.0):
    return {
        "identifier": identifier,
        "total_shares": 0,
        "total_invested": invested,
        "first_bought_date": None,
    }


class TestApplyShareChanges:
    def test_inserts_new_company_with_shares_and_source(self, db, account):
        result = run_apply(
            db,
            account,
            {"NewCo": plain_calc(5)},
            {"NewCo": plain_position("NEW", invested=50.0)},
            source="ibkr",
        )
        assert result["added"] == ["NewCo"]
        row = db.execute(
            """SELECT c.source, c.total_invested, cs.shares FROM companies c
               JOIN company_shares cs ON cs.company_id = c.id WHERE c.name = 'NewCo'"""
        ).fetchone()
        assert row["source"] == "ibkr"
        assert row["total_invested"] == 50.0
        assert row["shares"] == 5

    def test_updates_existing_company_shares(self, db, account):
        cid = seed_company(db, account["id"], account["portfolio_id"], "OldCo", "OLD")
        seed_shares(db, cid, 3)
        db.commit()

        result = run_apply(
            db,
            account,
            {"OldCo": plain_calc(8)},
            {"OldCo": plain_position("OLD", invested=99.0)},
        )
        assert result["updated"] == ["OldCo"]
        row = db.execute(
            "SELECT shares FROM company_shares WHERE company_id = ?", [cid]
        ).fetchone()
        assert row["shares"] == 8

    def test_manually_edited_identifier_survives_reimport(self, db, account):
        cid = seed_company(
            db,
            account["id"],
            account["portfolio_id"],
            "EditedCo",
            identifier="USER-PICKED",
            identifier_manually_edited=1,
            override_identifier="USER-PICKED",
        )
        seed_shares(db, cid, 3)
        db.commit()

        result = run_apply(
            db,
            account,
            {"EditedCo": plain_calc(5)},
            {"EditedCo": plain_position("CSV-IDENT")},
        )
        assert result["protected_identifiers_count"] == 1
        row = db.execute("SELECT identifier FROM companies WHERE id = ?", [cid]).fetchone()
        assert row["identifier"] == "USER-PICKED"

    def test_first_bought_date_only_moves_earlier(self, db, account):
        cid = seed_company(db, account["id"], account["portfolio_id"], "DateCo", "DTE")
        seed_shares(db, cid, 1)
        db.execute(
            "UPDATE companies SET first_bought_date = '2020-01-01 00:00:00' WHERE id = ?",
            [cid],
        )
        db.commit()

        pos = plain_position("DTE")
        pos["first_bought_date"] = pd.Timestamp("2023-05-01")  # later: ignored
        run_apply(db, account, {"DateCo": plain_calc(2)}, {"DateCo": pos})
        row = db.execute(
            "SELECT first_bought_date FROM companies WHERE id = ?", [cid]
        ).fetchone()
        assert str(row["first_bought_date"]).startswith("2020-01-01")

        pos["first_bought_date"] = pd.Timestamp("2019-03-01")  # earlier: wins
        run_apply(db, account, {"DateCo": plain_calc(2)}, {"DateCo": pos})
        row = db.execute(
            "SELECT first_bought_date FROM companies WHERE id = ?", [cid]
        ).fetchone()
        assert str(row["first_bought_date"]).startswith("2019-03-01")


class TestBrokerScopedDeletion:
    def _seed_three_sources(self, db, account):
        ids = {}
        for name, source in [("ParqetCo", "parqet"), ("IbkrCo", "ibkr"), ("ManualCo", "manual")]:
            cid = seed_company(
                db, account["id"], account["portfolio_id"], name, name.upper(), source=source
            )
            seed_shares(db, cid, 10)
            ids[name] = cid
        db.commit()
        return ids

    def test_parqet_import_only_removes_parqet_companies(self, db, account):
        self._seed_three_sources(db, account)
        result = run_apply(
            db,
            account,
            share_calcs={},
            positions={},
            to_remove={"ParqetCo", "IbkrCo", "ManualCo"},
            source="parqet",
        )
        assert result["removed"] == ["ParqetCo"]
        remaining = {
            r["name"] for r in db.execute("SELECT name FROM companies").fetchall()
        }
        assert remaining == {"IbkrCo", "ManualCo"}

    def test_ibkr_import_only_removes_ibkr_companies(self, db, account):
        self._seed_three_sources(db, account)
        result = run_apply(
            db,
            account,
            share_calcs={},
            positions={},
            to_remove={"ParqetCo", "IbkrCo", "ManualCo"},
            source="ibkr",
        )
        assert result["removed"] == ["IbkrCo"]

    def test_manual_positions_never_removed_by_imports(self, db, account):
        self._seed_three_sources(db, account)
        result = run_apply(
            db, account, {}, {}, to_remove={"ManualCo"}, source="parqet"
        )
        assert result["removed"] == []
        assert result["manual_protected_count"] == 1

    def test_force_remove_all_bypasses_protection(self, db, account):
        self._seed_three_sources(db, account)
        result = run_apply(
            db,
            account,
            {},
            {},
            to_remove={"ParqetCo", "IbkrCo", "ManualCo"},
            source="parqet",
            force=True,
        )
        assert set(result["removed"]) == {"ParqetCo", "IbkrCo", "ManualCo"}
        assert db.execute("SELECT COUNT(*) c FROM companies").fetchone()["c"] == 0


class TestMarketPriceCleanup:
    def test_price_removed_when_no_other_account_uses_identifier(self, db, account):
        cid = seed_company(db, account["id"], account["portfolio_id"], "SoloCo", "SOLO")
        seed_shares(db, cid, 1)
        seed_price(db, "SOLO", price_eur=10.0)
        db.commit()

        run_apply(db, account, {}, {}, to_remove={"SoloCo"}, source="parqet")
        assert (
            db.execute("SELECT COUNT(*) c FROM market_prices WHERE identifier='SOLO'").fetchone()["c"]
            == 0
        )

    def test_price_kept_when_other_account_shares_identifier(self, db, account):
        cid = seed_company(db, account["id"], account["portfolio_id"], "SharedCo", "SHRD")
        seed_shares(db, cid, 1)
        other_account = seed_account(db, "other")
        other_portfolio = seed_portfolio(db, other_account, "-")
        seed_company(db, other_account, other_portfolio, "SharedCo", "SHRD")
        seed_price(db, "SHRD", price_eur=10.0)
        db.commit()

        run_apply(db, account, {}, {}, to_remove={"SharedCo"}, source="parqet")
        assert (
            db.execute("SELECT COUNT(*) c FROM market_prices WHERE identifier='SHRD'").fetchone()["c"]
            == 1
        )
