#!/usr/bin/env python3
"""
Seed a "Demo Investor" account with realistic portfolio data.

Usage:
    python3 seed_demo.py

Idempotent: deletes existing Demo Investor data first, then recreates.
Fetches live prices from yfinance; falls back to hardcoded prices if unavailable.
"""

import json
import os
import sys
import sqlite3
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEMO_USERNAME = "Demo Investor"
CASH_BALANCE = 5200.0

PORTFOLIOS = [
    {"name": "Global Core", "target_pct": 45},
    {"name": "Tech & AI", "target_pct": 25},
    {"name": "Dividend Aristocrats", "target_pct": 20},
    {"name": "Alternatives", "target_pct": 10},
]

# fmt: off
STOCKS = [
    # Portfolio 1: Global Core (6 ETFs)
    {"portfolio": "Global Core", "ticker": "VT",   "name": "Vanguard Total World Stock",      "sector": "Global Equity",     "thesis": "Passive Core",        "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 100,  "invested": 9500,  "first_bought": "2019-03-15", "fallback_price": 110.0},
    {"portfolio": "Global Core", "ticker": "EEM",  "name": "iShares Emerging Markets",        "sector": "Emerging Markets",  "thesis": "EM Diversification",  "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 200,  "invested": 7200,  "first_bought": "2019-06-01", "fallback_price": 42.0},
    {"portfolio": "Global Core", "ticker": "VTI",  "name": "Vanguard Total Stock Market",     "sector": "Global Equity",     "thesis": "Passive Core",        "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 20,   "invested": 4500,  "first_bought": "2021-01-10", "fallback_price": 280.0},
    {"portfolio": "Global Core", "ticker": "AGG",  "name": "iShares Core US Aggregate Bond",  "sector": "Fixed Income",      "thesis": "Bond Ballast",        "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 70,   "invested": 7600,  "first_bought": "2020-05-20", "fallback_price": 100.0},
    {"portfolio": "Global Core", "ticker": "IJR",  "name": "iShares Core S&P Small-Cap",      "sector": "Small Cap",         "thesis": "Small Cap Premium",   "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 10,   "invested": 950,   "first_bought": "2022-03-01", "fallback_price": 110.0},
    {"portfolio": "Global Core", "ticker": "SPDW", "name": "SPDR Portfolio Developed ex-US",  "sector": "Global Equity",     "thesis": "Passive Core",        "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 140,  "invested": 4500,  "first_bought": "2020-09-15", "fallback_price": 37.0},

    # Portfolio 2: Tech & AI (10 Stocks)
    {"portfolio": "Tech & AI", "ticker": "AAPL",    "name": "Apple",             "sector": "Technology",          "thesis": "Platform Monopoly",   "type": "Stock", "country": "United States",  "currency": "USD", "shares": 15,   "invested": 2800,  "first_bought": "2020-04-01", "fallback_price": 230.0},
    {"portfolio": "Tech & AI", "ticker": "MSFT",    "name": "Microsoft",         "sector": "Technology",          "thesis": "Cloud Dominance",     "type": "Stock", "country": "United States",  "currency": "USD", "shares": 8,    "invested": 2200,  "first_bought": "2020-06-15", "fallback_price": 400.0},
    {"portfolio": "Tech & AI", "ticker": "NVDA",    "name": "NVIDIA",            "sector": "Semiconductors",      "thesis": "AI Infrastructure",   "type": "Stock", "country": "United States",  "currency": "USD", "shares": 25,   "invested": 1500,  "first_bought": "2021-09-01", "fallback_price": 130.0},
    {"portfolio": "Tech & AI", "ticker": "ASML.AS", "name": "ASML Holding",      "sector": "Semiconductors",      "thesis": "Chip Monopoly",       "type": "Stock", "country": "Netherlands",    "currency": "EUR", "shares": 4,    "invested": 2400,  "first_bought": "2021-03-15", "fallback_price": 700.0},
    {"portfolio": "Tech & AI", "ticker": "TSM",     "name": "TSMC",              "sector": "Semiconductors",      "thesis": "AI Infrastructure",   "type": "Stock", "country": "Taiwan",         "currency": "USD", "shares": 15,   "invested": 2100,  "first_bought": "2022-01-10", "fallback_price": 180.0},
    {"portfolio": "Tech & AI", "ticker": "SAP.DE",  "name": "SAP SE",            "sector": "Enterprise Software", "thesis": "European Tech",       "type": "Stock", "country": "Germany",        "currency": "EUR", "shares": 20,   "invested": 3800,  "first_bought": "2020-11-01", "fallback_price": 230.0},
    {"portfolio": "Tech & AI", "ticker": "GOOG",    "name": "Alphabet",          "sector": "Technology",          "thesis": "Platform Monopoly",   "type": "Stock", "country": "United States",  "currency": "USD", "shares": 5,    "invested": 700,   "first_bought": "2023-04-15", "fallback_price": 180.0},
    {"portfolio": "Tech & AI", "ticker": "PLTR",    "name": "Palantir",          "sector": "AI & Data",           "thesis": "AI Software",         "type": "Stock", "country": "United States",  "currency": "USD", "shares": 40,   "invested": 1200,  "first_bought": "2023-01-20", "fallback_price": 90.0},
    {"portfolio": "Tech & AI", "ticker": "SONY",    "name": "Sony Group",        "sector": "Consumer Electronics","thesis": "Content & Hardware",  "type": "Stock", "country": "Japan",          "currency": "USD", "shares": 50,   "invested": 1400,  "first_bought": "2022-10-01", "fallback_price": 25.0},
    {"portfolio": "Tech & AI", "ticker": "AMZN",    "name": "Amazon",            "sector": "Technology",          "thesis": "Cloud Dominance",     "type": "Stock", "country": "United States",  "currency": "USD", "shares": 12,   "invested": 1900,  "first_bought": "2022-08-01", "fallback_price": 200.0},

    # Portfolio 3: Dividend Aristocrats (9 Stocks)
    {"portfolio": "Dividend Aristocrats", "ticker": "JNJ",     "name": "Johnson & Johnson",  "sector": "Healthcare",        "thesis": "Dividend King",       "type": "Stock", "country": "United States",  "currency": "USD", "shares": 10,   "invested": 1600,  "first_bought": "2019-09-01", "fallback_price": 150.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "NVO",     "name": "Novo Nordisk",       "sector": "Healthcare",        "thesis": "GLP-1 Dominance",     "type": "Stock", "country": "Denmark",        "currency": "USD", "shares": 12,   "invested": 800,   "first_bought": "2021-05-10", "fallback_price": 110.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "NESN.SW", "name": "Nestle",             "sector": "Consumer Staples",  "thesis": "Defensive Income",    "type": "Stock", "country": "Switzerland",    "currency": "CHF", "shares": 15,   "invested": 1500,  "first_bought": "2019-12-01", "fallback_price": 90.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "ROG.SW",  "name": "Roche",              "sector": "Healthcare",        "thesis": "Pharma Giant",        "type": "Stock", "country": "Switzerland",    "currency": "CHF", "shares": 5,    "invested": 1600,  "first_bought": "2020-02-15", "fallback_price": 280.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "SHEL.L",  "name": "Shell",              "sector": "Energy",            "thesis": "Energy Transition",   "type": "Stock", "country": "United Kingdom", "currency": "GBP", "shares": 80,   "invested": 2000,  "first_bought": "2020-08-01", "fallback_price": 2700.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "ULVR.L",  "name": "Unilever",           "sector": "Consumer Staples",  "thesis": "Defensive Income",    "type": "Stock", "country": "United Kingdom", "currency": "GBP", "shares": 40,   "invested": 1900,  "first_bought": "2021-01-15", "fallback_price": 4500.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "SIE.DE",  "name": "Siemens",            "sector": "Industrials",       "thesis": "Infrastructure",      "type": "Stock", "country": "Germany",        "currency": "EUR", "shares": 8,    "invested": 1200,  "first_bought": "2022-02-01", "fallback_price": 190.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "ALV.DE",  "name": "Allianz",            "sector": "Financials",        "thesis": "Insurance Champion",  "type": "Stock", "country": "Germany",        "currency": "EUR", "shares": 6,    "invested": 1400,  "first_bought": "2021-07-01", "fallback_price": 300.0},
    {"portfolio": "Dividend Aristocrats", "ticker": "MC.PA",   "name": "LVMH",               "sector": "Luxury",            "thesis": "European Luxury",     "type": "Stock", "country": "France",         "currency": "EUR", "shares": 3,    "invested": 2200,  "first_bought": "2022-04-15", "fallback_price": 630.0},

    # Portfolio 4: Alternatives (5 with tickers)
    {"portfolio": "Alternatives", "ticker": "BTC-USD", "name": "Bitcoin",                "sector": "Digital Assets",  "thesis": "Digital Gold",        "type": "Stock", "country": "United States",  "currency": "USD", "shares": 0.15, "invested": 800,   "first_bought": "2021-11-01", "fallback_price": 95000.0},
    {"portfolio": "Alternatives", "ticker": "ETH-USD", "name": "Ethereum",               "sector": "Digital Assets",  "thesis": "Smart Contracts",     "type": "Stock", "country": "United States",  "currency": "USD", "shares": 2.5,  "invested": 400,   "first_bought": "2022-03-01", "fallback_price": 3200.0},
    {"portfolio": "Alternatives", "ticker": "GLD",     "name": "SPDR Gold Trust",         "sector": "Commodities",     "thesis": "Inflation Hedge",     "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 8,    "invested": 1500,  "first_bought": "2022-09-01", "fallback_price": 250.0},
    {"portfolio": "Alternatives", "ticker": "IBIT",    "name": "iShares Bitcoin ETF",     "sector": "Digital Assets",  "thesis": "Digital Gold",        "type": "ETF",   "country": "United States",  "currency": "USD", "shares": 20,   "invested": 700,   "first_bought": "2024-03-01", "fallback_price": 55.0},
    {"portfolio": "Alternatives", "ticker": "SOL-USD", "name": "Solana",                  "sector": "Digital Assets",  "thesis": "Smart Contracts",     "type": "Stock", "country": "United States",  "currency": "USD", "shares": 5,    "invested": 300,   "first_bought": "2023-06-01", "fallback_price": 180.0},
]
# fmt: on

# Manual stocks (no identifier, custom values)
MANUAL_STOCKS = [
    {
        "portfolio": "Alternatives",
        "name": "Private Equity Fund III",
        "sector": "Private Equity",
        "thesis": "Venture Upside",
        "type": "Stock",
        "country": "Germany",
        "shares": 1,
        "invested": 5000,
        "custom_value": 5000.0,
        "first_bought": "2023-01-15",
    },
    {
        "portfolio": "Alternatives",
        "name": "Berlin RE Direct Invest",
        "sector": "Real Estate",
        "thesis": "Real Asset Anchor",
        "type": "Stock",
        "country": "Germany",
        "shares": 1,
        "invested": 7500,
        "custom_value": 8000.0,
        "first_bought": "2022-05-01",
    },
]

SIMULATION_SCENARIOS = [
    {
        "name": "Conservative Rebalance",
        "scope": "global",
        "items": [
            {"name": "Global Core", "currentPct": 0, "targetPct": 50},
            {"name": "Tech & AI", "currentPct": 0, "targetPct": 20},
            {"name": "Dividend Aristocrats", "currentPct": 0, "targetPct": 20},
            {"name": "Alternatives", "currentPct": 0, "targetPct": 10},
        ],
    },
    {
        "name": "AI Concentration",
        "scope": "global",
        "items": [
            {"name": "Global Core", "currentPct": 0, "targetPct": 35},
            {"name": "Tech & AI", "currentPct": 0, "targetPct": 35},
            {"name": "Dividend Aristocrats", "currentPct": 0, "targetPct": 15},
            {"name": "Alternatives", "currentPct": 0, "targetPct": 15},
        ],
    },
    {
        "name": "Income Focus",
        "scope": "global",
        "items": [
            {"name": "Global Core", "currentPct": 0, "targetPct": 40},
            {"name": "Tech & AI", "currentPct": 0, "targetPct": 15},
            {"name": "Dividend Aristocrats", "currentPct": 0, "targetPct": 40},
            {"name": "Alternatives", "currentPct": 0, "targetPct": 5},
        ],
    },
]

# Fallback exchange rates (EUR = 1.0 base)
FALLBACK_RATES = {
    "USD": 0.92,
    "GBP": 1.17,
    "CHF": 1.05,
    "JPY": 0.0061,
    "CAD": 0.67,
    "AUD": 0.59,
    "SEK": 0.087,
    "NOK": 0.086,
    "DKK": 0.134,
    "HKD": 0.118,
    "SGD": 0.69,
    "NZD": 0.55,
    "GBp": 0.0117,  # pence to EUR
}


# ---------------------------------------------------------------------------
# Price fetching
# ---------------------------------------------------------------------------

def fetch_live_prices(tickers):
    """Fetch current prices from yfinance. Returns dict of {ticker: {price, currency, country}}."""
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("yfinance not installed, using fallback prices")
        return {}

    prices = {}
    logger.info(f"Fetching live prices for {len(tickers)} tickers...")

    try:
        # Batch download
        data = yf.download(tickers, period="1d", progress=False, threads=True)
        info_cache = {}

        for ticker in tickers:
            try:
                t = yf.Ticker(ticker)
                info = t.info
                info_cache[ticker] = info

                # Get price: prefer regularMarketPrice, then currentPrice, then last close
                price = (
                    info.get("regularMarketPrice")
                    or info.get("currentPrice")
                    or info.get("previousClose")
                )
                if price is None and not data.empty:
                    try:
                        price = float(data["Close"][ticker].iloc[-1])
                    except (KeyError, IndexError, TypeError):
                        pass

                currency = info.get("currency", "USD")
                country = info.get("country", "")

                if price is not None:
                    prices[ticker] = {
                        "price": float(price),
                        "currency": currency,
                        "country": country,
                    }
                    logger.info(f"  {ticker}: {price} {currency}")
                else:
                    logger.warning(f"  {ticker}: no price available")
            except Exception as e:
                logger.warning(f"  {ticker}: failed ({e})")

    except Exception as e:
        logger.warning(f"Batch download failed: {e}")

    return prices


def fetch_live_exchange_rates():
    """Fetch exchange rates from yfinance. Returns dict of {currency: rate_to_eur}."""
    try:
        import yfinance as yf
    except ImportError:
        return {}

    rates = {}
    pairs = {
        "USD": "USDEUR=X",
        "GBP": "GBPEUR=X",
        "CHF": "CHFEUR=X",
        "JPY": "JPYEUR=X",
        "CAD": "CADEUR=X",
        "AUD": "AUDEUR=X",
        "SEK": "SEKEUR=X",
        "NOK": "NOKEUR=X",
        "DKK": "DKKEUR=X",
        "HKD": "HKDEUR=X",
        "SGD": "SGDEUR=X",
        "NZD": "NZDEUR=X",
    }

    logger.info("Fetching live exchange rates...")
    for currency, pair in pairs.items():
        try:
            t = yf.Ticker(pair)
            info = t.info
            rate = info.get("regularMarketPrice") or info.get("previousClose")
            if rate:
                rates[currency] = float(rate)
                logger.info(f"  {currency}/EUR: {rate:.4f}")
        except Exception as e:
            logger.warning(f"  {currency}: failed ({e})")

    # GBp (pence) = GBP / 100
    if "GBP" in rates:
        rates["GBp"] = rates["GBP"] / 100.0

    return rates


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db_path():
    """Resolve the database path from .env or defaults."""
    from dotenv import load_dotenv
    load_dotenv()
    app_data_dir = os.environ.get("APP_DATA_DIR", "instance")
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        return db_url.replace("sqlite:///", "")
    return os.path.join(app_data_dir, "portfolio.db")


def connect_db(db_path):
    """Open a raw SQLite connection."""
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    return db


# ---------------------------------------------------------------------------
# Seed logic
# ---------------------------------------------------------------------------

def delete_existing_demo(db):
    """Remove all data belonging to the Demo Investor account."""
    row = db.execute(
        "SELECT id FROM accounts WHERE username = ?", [DEMO_USERNAME]
    ).fetchone()
    if row is None:
        logger.info("No existing Demo Investor account found.")
        return

    account_id = row["id"]
    logger.info(f"Deleting existing Demo Investor (account_id={account_id})...")

    # Order matters for foreign keys
    company_ids = [
        r["id"]
        for r in db.execute(
            "SELECT id FROM companies WHERE account_id = ?", [account_id]
        ).fetchall()
    ]
    if company_ids:
        placeholders = ",".join("?" * len(company_ids))
        db.execute(f"DELETE FROM company_shares WHERE company_id IN ({placeholders})", company_ids)

    db.execute("DELETE FROM simulations WHERE account_id = ?", [account_id])
    db.execute("DELETE FROM expanded_state WHERE account_id = ?", [account_id])
    db.execute("DELETE FROM companies WHERE account_id = ?", [account_id])
    db.execute("DELETE FROM portfolios WHERE account_id = ?", [account_id])
    db.execute("DELETE FROM identifier_mappings WHERE account_id = ?", [account_id])
    db.execute("DELETE FROM accounts WHERE id = ?", [account_id])
    db.commit()
    logger.info("Existing demo data deleted.")


def seed_account(db):
    """Create the demo account, return account_id."""
    cursor = db.execute(
        "INSERT INTO accounts (username, created_at, cash) VALUES (?, datetime('now'), ?)",
        [DEMO_USERNAME, CASH_BALANCE],
    )
    db.commit()
    account_id = cursor.lastrowid
    logger.info(f"Created account '{DEMO_USERNAME}' (id={account_id}, cash={CASH_BALANCE})")
    return account_id


def seed_portfolios(db, account_id):
    """Create portfolios, return {name: portfolio_id} map."""
    portfolio_map = {}
    for p in PORTFOLIOS:
        cursor = db.execute(
            "INSERT INTO portfolios (name, account_id) VALUES (?, ?)",
            [p["name"], account_id],
        )
        portfolio_map[p["name"]] = cursor.lastrowid
    db.commit()
    logger.info(f"Created {len(portfolio_map)} portfolios: {list(portfolio_map.keys())}")
    return portfolio_map


def seed_companies(db, account_id, portfolio_map, live_prices):
    """Insert companies and company_shares for ticker-based stocks."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    company_ids = []

    for s in STOCKS:
        portfolio_id = portfolio_map[s["portfolio"]]
        ticker = s["ticker"]

        cursor = db.execute(
            """INSERT INTO companies
               (name, identifier, sector, thesis, portfolio_id, account_id,
                total_invested, investment_type, source, first_bought_date,
                override_country, country_manually_edited)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'csv', ?, ?, 0)""",
            [
                s["name"], ticker, s["sector"], s["thesis"],
                portfolio_id, account_id, s["invested"], s["type"],
                s["first_bought"], s["country"],
            ],
        )
        company_id = cursor.lastrowid
        company_ids.append((company_id, s))

        # Insert shares
        db.execute(
            "INSERT INTO company_shares (company_id, shares) VALUES (?, ?)",
            [company_id, s["shares"]],
        )

    db.commit()
    logger.info(f"Inserted {len(company_ids)} ticker-based companies")
    return company_ids


def seed_manual_companies(db, account_id, portfolio_map):
    """Insert manual stocks with custom values."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for m in MANUAL_STOCKS:
        portfolio_id = portfolio_map[m["portfolio"]]
        custom_price_eur = m["custom_value"] / m["shares"] if m["shares"] else m["custom_value"]

        cursor = db.execute(
            """INSERT INTO companies
               (name, identifier, sector, thesis, portfolio_id, account_id,
                total_invested, investment_type, source, first_bought_date,
                override_country, country_manually_edited,
                custom_total_value, custom_price_eur, is_custom_value, custom_value_date)
               VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, 0, ?, ?, 1, ?)""",
            [
                m["name"], m["sector"], m["thesis"],
                portfolio_id, account_id, m["invested"], m["type"],
                m["first_bought"], m["country"],
                m["custom_value"], custom_price_eur, now,
            ],
        )
        company_id = cursor.lastrowid

        db.execute(
            "INSERT INTO company_shares (company_id, shares) VALUES (?, ?)",
            [company_id, m["shares"]],
        )

    db.commit()
    logger.info(f"Inserted {len(MANUAL_STOCKS)} manual companies")


def seed_market_prices(db, live_prices, exchange_rates):
    """Insert/update market_prices for all tickers."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    count = 0

    for s in STOCKS:
        ticker = s["ticker"]
        live = live_prices.get(ticker, {})
        price = live.get("price", s["fallback_price"])
        currency = live.get("currency", s["currency"])
        country = live.get("country", s["country"])

        # Calculate EUR price
        if currency == "EUR":
            price_eur = price
        elif currency == "GBp":
            # GBp = pence, convert to EUR
            rate = exchange_rates.get("GBp", FALLBACK_RATES.get("GBp", 0.0117))
            price_eur = price * rate
        else:
            rate = exchange_rates.get(currency, FALLBACK_RATES.get(currency, 1.0))
            price_eur = price * rate

        db.execute(
            """INSERT OR REPLACE INTO market_prices
               (identifier, price, currency, price_eur, last_updated, country)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [ticker, price, currency, price_eur, now, country],
        )
        count += 1

    db.commit()
    logger.info(f"Inserted {count} market prices")


def seed_exchange_rates(db, exchange_rates):
    """Insert exchange rates into the database."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    count = 0

    for currency, rate in exchange_rates.items():
        db.execute(
            """INSERT OR REPLACE INTO exchange_rates
               (from_currency, to_currency, rate, last_updated)
               VALUES (?, 'EUR', ?, ?)""",
            [currency, rate, now],
        )
        count += 1

    db.commit()
    logger.info(f"Inserted {count} exchange rates")


def seed_builder_state(db, account_id, portfolio_map):
    """Insert builder expanded_state with budget config and rules."""

    budget_data = json.dumps({
        "totalNetWorth": 150000,
        "alreadyInvested": 0,  # Will be auto-calculated by the app
        "emergencyFund": 15000,
        "availableToInvest": 0,
        "totalInvestableCapital": 135000,
    })

    rules = json.dumps({
        "maxPerStock": 5,
        "maxPerETF": 10,
        "maxPerCategory": 25,
        "maxPerCountry": 40,
    })

    # Build portfolio targets (matching the builder.js format)
    portfolios = []
    for p in PORTFOLIOS:
        pid = portfolio_map[p["name"]]
        portfolios.append({
            "id": pid,
            "name": p["name"],
            "weight": p["target_pct"],
            "isPlaceholder": False,
        })
    portfolios_json = json.dumps(portfolios)

    state_vars = [
        ("budgetData", "object", budget_data),
        ("rules", "object", rules),
        ("portfolios", "object", portfolios_json),
    ]

    for var_name, var_type, var_value in state_vars:
        db.execute(
            """INSERT INTO expanded_state
               (account_id, page_name, variable_name, variable_type, variable_value)
               VALUES (?, 'builder', ?, ?, ?)""",
            [account_id, var_name, var_type, var_value],
        )

    db.commit()
    logger.info("Inserted builder state (budget, rules, portfolio targets)")


def seed_simulations(db, account_id):
    """Insert simulation scenarios."""
    for scenario in SIMULATION_SCENARIOS:
        db.execute(
            """INSERT INTO simulations
               (account_id, name, scope, portfolio_id, items)
               VALUES (?, ?, ?, NULL, ?)""",
            [account_id, scenario["name"], scenario["scope"], json.dumps(scenario["items"])],
        )
    db.commit()
    logger.info(f"Inserted {len(SIMULATION_SCENARIOS)} simulation scenarios")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    db_path = get_db_path()
    logger.info(f"Database path: {db_path}")

    if not os.path.exists(db_path):
        logger.error(f"Database not found at {db_path}. Run the app first to create it.")
        sys.exit(1)

    # Fetch live data (with fallbacks)
    tickers = [s["ticker"] for s in STOCKS]
    live_prices = fetch_live_prices(tickers)
    live_rates = fetch_live_exchange_rates()

    # Merge live rates with fallbacks
    exchange_rates = dict(FALLBACK_RATES)
    exchange_rates.update(live_rates)

    # Seed the database
    db = connect_db(db_path)
    try:
        delete_existing_demo(db)
        account_id = seed_account(db)
        portfolio_map = seed_portfolios(db, account_id)
        seed_companies(db, account_id, portfolio_map, live_prices)
        seed_manual_companies(db, account_id, portfolio_map)
        seed_market_prices(db, live_prices, exchange_rates)
        seed_exchange_rates(db, exchange_rates)
        seed_builder_state(db, account_id, portfolio_map)
        seed_simulations(db, account_id)

        # Summary
        total_companies = db.execute(
            "SELECT COUNT(*) as c FROM companies WHERE account_id = ?", [account_id]
        ).fetchone()["c"]
        total_portfolios = db.execute(
            "SELECT COUNT(*) as c FROM portfolios WHERE account_id = ?", [account_id]
        ).fetchone()["c"]

        logger.info("")
        logger.info("=" * 60)
        logger.info("Demo account seeded successfully!")
        logger.info(f"  Account: {DEMO_USERNAME} (id={account_id})")
        logger.info(f"  Portfolios: {total_portfolios}")
        logger.info(f"  Companies: {total_companies}")
        logger.info(f"  Cash: EUR {CASH_BALANCE:,.0f}")
        logger.info(f"  Simulations: {len(SIMULATION_SCENARIOS)}")
        logger.info(f"  Live prices fetched: {len(live_prices)}/{len(tickers)}")
        logger.info(f"  Live exchange rates: {len(live_rates)}")
        logger.info("=" * 60)
        logger.info("")
        logger.info("Start the app and select 'Demo Investor' to explore.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
