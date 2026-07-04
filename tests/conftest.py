"""
Shared fixtures for the backend test suite.

Tests run against a throwaway on-disk SQLite database seeded from
app/schema.sql inside a bare Flask app context, so query_db()/get_db()
work exactly as in production. No network, no yfinance, no startup tasks.
"""

from pathlib import Path

import pytest
from flask import Flask, g

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "app" / "schema.sql"


@pytest.fixture(autouse=True)
def _reset_exchange_rate_cache():
    """value_calculator caches rates in a module-level dict; isolate tests."""
    from app.utils.value_calculator import clear_exchange_rate_cache

    clear_exchange_rate_cache()
    yield
    clear_exchange_rate_cache()


@pytest.fixture
def app(tmp_path):
    flask_app = Flask("prismo-test")
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{tmp_path / 'test.db'}"
    return flask_app


@pytest.fixture
def db(app):
    """Open an app context with a schema-seeded SQLite connection."""
    from app.db_manager import get_db

    with app.app_context():
        conn = get_db()
        conn.executescript(SCHEMA_PATH.read_text())
        conn.commit()
        yield conn
        g.pop("db", None)
        conn.close()


# --- Seed helpers -----------------------------------------------------------


def seed_account(conn, username="tester"):
    cur = conn.execute(
        "INSERT INTO accounts (username, created_at) VALUES (?, datetime('now'))",
        [username],
    )
    return cur.lastrowid


def seed_portfolio(conn, account_id, name="-"):
    cur = conn.execute(
        "INSERT INTO portfolios (name, account_id) VALUES (?, ?)",
        [name, account_id],
    )
    return cur.lastrowid


def seed_company(
    conn,
    account_id,
    portfolio_id,
    name,
    identifier=None,
    source="parqet",
    sector="",
    investment_type=None,
    total_invested=0,
    is_custom_value=0,
    custom_total_value=None,
    identifier_manually_edited=0,
    override_identifier=None,
):
    cur = conn.execute(
        """INSERT INTO companies
           (name, identifier, sector, portfolio_id, account_id, total_invested,
            source, investment_type, is_custom_value, custom_total_value,
            identifier_manually_edited, override_identifier)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            name,
            identifier,
            sector,
            portfolio_id,
            account_id,
            total_invested,
            source,
            investment_type,
            is_custom_value,
            custom_total_value,
            identifier_manually_edited,
            override_identifier,
        ],
    )
    return cur.lastrowid


def seed_shares(
    conn,
    company_id,
    shares,
    override_share=None,
    is_manually_edited=0,
    manual_edit_date=None,
):
    conn.execute(
        """INSERT INTO company_shares
           (company_id, shares, override_share, is_manually_edited, manual_edit_date)
           VALUES (?, ?, ?, ?, ?)""",
        [company_id, shares, override_share, is_manually_edited, manual_edit_date],
    )


def seed_price(conn, identifier, price=None, currency=None, price_eur=None):
    conn.execute(
        """INSERT INTO market_prices (identifier, price, currency, price_eur, last_updated)
           VALUES (?, ?, ?, ?, datetime('now'))""",
        [identifier, price, currency, price_eur],
    )


def seed_rate(conn, from_currency, rate):
    conn.execute(
        """INSERT INTO exchange_rates (from_currency, to_currency, rate, last_updated)
           VALUES (?, 'EUR', ?, datetime('now'))""",
        [from_currency, rate],
    )
