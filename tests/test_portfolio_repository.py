"""
Tests for PortfolioRepository.delete_portfolio.

companies.portfolio_id has a foreign key with no ON DELETE action and the
connection runs with PRAGMA foreign_keys = ON, so delete_portfolio must
detach child companies (portfolio_id -> NULL) before deleting the row.
"""

from tests.conftest import seed_account, seed_company, seed_portfolio, seed_shares


def portfolio_exists(db, portfolio_id):
    return (
        db.execute(
            "SELECT 1 FROM portfolios WHERE id = ?", [portfolio_id]
        ).fetchone()
        is not None
    )


def company_portfolio_id(db, company_id):
    return db.execute(
        "SELECT portfolio_id FROM companies WHERE id = ?", [company_id]
    ).fetchone()["portfolio_id"]


class TestDeletePortfolio:
    def test_deletes_portfolio_and_nulls_child_companies(self, db):
        from app.repositories.portfolio_repository import PortfolioRepository

        account_id = seed_account(db)
        portfolio_id = seed_portfolio(db, account_id, "growth")
        company_id = seed_company(db, account_id, portfolio_id, "GrowthCo", "GRW")
        seed_shares(db, company_id, 3)
        db.commit()

        assert PortfolioRepository.delete_portfolio(portfolio_id, account_id) is True

        assert not portfolio_exists(db, portfolio_id)
        assert company_portfolio_id(db, company_id) is None

    def test_does_not_touch_other_accounts(self, db):
        from app.repositories.portfolio_repository import PortfolioRepository

        owner_id = seed_account(db, "owner")
        other_id = seed_account(db, "other")
        portfolio_id = seed_portfolio(db, owner_id, "growth")
        company_id = seed_company(db, owner_id, portfolio_id, "GrowthCo", "GRW")
        db.commit()

        # Wrong account: portfolio survives and the company stays attached
        PortfolioRepository.delete_portfolio(portfolio_id, other_id)

        assert portfolio_exists(db, portfolio_id)
        assert company_portfolio_id(db, company_id) == portfolio_id
