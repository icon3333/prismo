"""Canonical holdings reads distinguish an empty account from failed retrieval."""

import pytest

from tests.conftest import (
    seed_account, seed_company, seed_portfolio, seed_price, seed_shares,
)


@pytest.fixture
def holdings_client(app, db):
    # Exercise the real authenticated handler without application startup tasks.
    from app.cache import cache
    from app.routes.portfolio_data_api import get_portfolio_data_api

    app.config.update(SECRET_KEY="holdings-read-test", TESTING=True)
    cache.init_app(app, config={"CACHE_TYPE": "NullCache"})
    app.add_url_rule("/portfolio/api/portfolio_data", view_func=get_portfolio_data_api)
    account_id = seed_account(db)
    db.commit()
    with app.test_client() as client:
        with client.session_transaction() as session:
            session["account_id"] = account_id
        yield client, account_id


def test_repository_read_failure_is_not_an_empty_account(holdings_client, monkeypatch):
    from app.repositories import portfolio_repository

    client, _ = holdings_client

    def fail_read(*args, **kwargs):
        raise RuntimeError("synthetic holdings read failure")

    monkeypatch.setattr(portfolio_repository, "query_db", fail_read)
    response = client.get("/portfolio/api/portfolio_data")

    assert response.status_code == 500
    assert response.get_json()["success"] is False


def test_failed_row_enrichment_is_not_partial_success(holdings_client, db):
    client, account_id = holdings_client
    portfolio_id = seed_portfolio(db, account_id)
    valid_id = seed_company(db, account_id, portfolio_id, "A valid holding", "VALID")
    invalid_id = seed_company(db, account_id, portfolio_id, "Z invalid holding", "INVALID")
    seed_shares(db, valid_id, 2)
    # SQLite's permissive REAL column can retain an invalid legacy value.
    seed_shares(db, invalid_id, "invalid-shares")
    db.commit()

    response = client.get("/portfolio/api/portfolio_data")

    assert response.status_code == 500
    assert response.get_json()["success"] is False


def test_legitimate_empty_account_is_success(holdings_client):
    client, _ = holdings_client

    response = client.get("/portfolio/api/portfolio_data")

    assert response.status_code == 200
    assert response.get_json() == []


@pytest.mark.parametrize("with_price", [True, False])
def test_canonical_rows_preserve_values_and_missing_price(holdings_client, db, with_price):
    client, account_id = holdings_client
    portfolio_id = seed_portfolio(db, account_id)
    company_id = seed_company(db, account_id, portfolio_id, "Canonical holding", "CANON")
    seed_shares(db, company_id, 4)
    if with_price:
        seed_price(db, "CANON", price=25, currency="EUR", price_eur=25)
    db.commit()

    response = client.get("/portfolio/api/portfolio_data")

    assert response.status_code == 200
    item, = response.get_json()
    assert item["id"] == company_id
    assert item["company"] == "Canonical holding"
    assert item["effective_shares"] == 4
    assert item["current_value"] == (100 if with_price else 0)
    assert item["value_source"] == ("market" if with_price else "none")
