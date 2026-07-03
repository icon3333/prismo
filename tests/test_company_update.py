"""
Tests for the portfolio-resolution part of _apply_company_update
(app/routes/portfolio_api.py) — consolidated as part of R2-28.

Avoids the identifier-change path, which triggers price fetches.
"""

import pytest

from tests.conftest import seed_account, seed_company, seed_portfolio, seed_shares


@pytest.fixture
def account(db):
    account_id = seed_account(db)
    portfolio_id = seed_portfolio(db, account_id, "-")
    company_id = seed_company(db, account_id, portfolio_id, "TestCo", "TST")
    seed_shares(db, company_id, 5)
    db.commit()
    return {"id": account_id, "default_portfolio_id": portfolio_id, "company_id": company_id}


def apply_update(db, account, data):
    from app.routes.portfolio_api import _apply_company_update

    cursor = db.cursor()
    _apply_company_update(cursor, account["company_id"], data, account["id"])
    db.commit()


def company_portfolio_name(db, company_id):
    row = db.execute(
        """SELECT p.name FROM companies c JOIN portfolios p ON c.portfolio_id = p.id
           WHERE c.id = ?""",
        [company_id],
    ).fetchone()
    return row["name"]


class TestPortfolioResolution:
    def test_assigns_existing_portfolio_by_name(self, db, account):
        seed_portfolio(db, account["id"], "growth")
        db.commit()
        apply_update(db, account, {"portfolio": "growth"})
        assert company_portfolio_name(db, account["company_id"]) == "growth"
        # No duplicate portfolio was created
        count = db.execute(
            "SELECT COUNT(*) c FROM portfolios WHERE account_id = ?", [account["id"]]
        ).fetchone()["c"]
        assert count == 2  # '-' and 'growth'

    def test_creates_missing_portfolio(self, db, account):
        apply_update(db, account, {"portfolio": "brandnew"})
        assert company_portfolio_name(db, account["company_id"]) == "brandnew"

    def test_portfolio_name_is_normalized(self, db, account):
        seed_portfolio(db, account["id"], "growth")
        db.commit()
        # normalize_portfolio lowercases, so this must reuse 'growth'
        apply_update(db, account, {"portfolio": "  GROWTH  "})
        assert company_portfolio_name(db, account["company_id"]) == "growth"
        count = db.execute(
            "SELECT COUNT(*) c FROM portfolios WHERE account_id = ?", [account["id"]]
        ).fetchone()["c"]
        assert count == 2

    def test_empty_portfolio_falls_back_to_default(self, db, account):
        apply_update(db, account, {"portfolio": "", "sector": "Tech"})
        assert company_portfolio_name(db, account["company_id"]) == "-"

    def test_other_fields_update_alongside(self, db, account):
        apply_update(db, account, {"sector": "Tech", "thesis": "compounder"})
        row = db.execute(
            "SELECT sector, thesis FROM companies WHERE id = ?", [account["company_id"]]
        ).fetchone()
        assert row["sector"] == "Tech"
        assert row["thesis"] == "Compounder"  # normalize_thesis title-cases
