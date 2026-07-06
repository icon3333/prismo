"""
HTTP-level integration tests through the real Flask app.

Everything the unit suite bypasses is exercised here: blueprint wiring
after the monolith split, @require_auth session handling, memoized-read
cache invalidation on writes, and the global ETag/304 hook.

The app is created once per module with a temp APP_DATA_DIR;
FLASK_ENV=development skips the background startup tasks (exchange
rates / price updates), so no network is touched.
"""

import os

import pytest


@pytest.fixture(scope="module")
def http_app(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("prismo-http")
    os.environ.setdefault("SECRET_KEY", "test-secret-key")
    os.environ["APP_DATA_DIR"] = str(data_dir)
    os.environ["FLASK_ENV"] = "development"  # skips startup background tasks
    os.environ.pop("DATABASE_URL", None)

    from app.main import create_app

    return create_app("development")


@pytest.fixture(scope="module")
def client(http_app):
    with http_app.test_client() as c:
        yield c


@pytest.fixture(scope="module")
def account(http_app, client):
    """Create an account through the API and seed one company via SQL."""
    resp = client.post("/account/create", json={"username": "httptester"})
    assert resp.status_code == 200, resp.get_json()
    account_id = resp.get_json()["account_id"]

    from app.db_manager import get_db

    with http_app.app_context():
        db = get_db()
        cur = db.execute(
            "INSERT INTO portfolios (name, account_id) VALUES ('-', ?)", [account_id]
        )
        portfolio_id = cur.lastrowid
        cur = db.execute(
            """INSERT INTO companies (name, identifier, sector, portfolio_id, account_id, source)
               VALUES ('HttpCo', 'HTTP', '', ?, ?, 'manual')""",
            [portfolio_id, account_id],
        )
        company_id = cur.lastrowid
        db.execute(
            "INSERT INTO company_shares (company_id, shares) VALUES (?, 4)", [company_id]
        )
        db.execute(
            """INSERT INTO market_prices (identifier, price, currency, price_eur, last_updated)
               VALUES ('HTTP', 25.0, 'EUR', 25.0, datetime('now'))"""
        )
        db.commit()

    return {"id": account_id, "company_id": company_id}


class TestHealthAndAuth:
    def test_health_endpoint(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "healthy"

    def test_portfolio_api_requires_auth(self, client):
        # Fresh client state before account fixture selects one
        client.post("/api/clear_account")
        resp = client.get("/portfolio/api/portfolios")
        assert resp.status_code == 401
        assert "Authentication required" in resp.get_json()["error"]


class TestAccountFlow:
    def test_create_selects_account_in_session(self, client, account):
        resp = client.get("/api/accounts")
        data = resp.get_json()
        assert data["current_account_id"] == account["id"]
        assert any(a["username"] == "httptester" for a in data["accounts"])

    def test_select_unknown_account_404s(self, client):
        resp = client.post("/api/select_account/99999")
        assert resp.status_code == 404


class TestPortfolioApi:
    def test_portfolio_data_returns_seeded_company(self, client, account):
        resp = client.get("/portfolio/api/portfolio_data")
        assert resp.status_code == 200
        items = resp.get_json()
        names = [i["company"] if "company" in i else i.get("name") for i in items]
        assert "HttpCo" in names

    def test_manage_portfolios_add_and_list(self, client, account):
        resp = client.post(
            "/portfolio/manage_portfolios",
            data={"action": "add", "add_portfolio_name": "growth"},
        )
        assert resp.status_code == 200, resp.get_json()
        assert "growth" in client.get("/portfolio/api/portfolios").get_json()
        with_ids = client.get("/portfolio/api/portfolios?include_ids=true").get_json()
        assert {"name": "growth"}.items() <= next(
            p for p in with_ids if p["name"] == "growth"
        ).items()

    def test_write_invalidates_memoized_read(self, client, account):
        # Prime the 30s-memoized aggregate read...
        before = client.get("/portfolio/api/portfolio_data/all").get_json()
        company = next(c for c in before["companies"] if c["name"] == "HttpCo")
        assert company.get("sector") in ("", None, "Unknown")

        # ...write through the batch-update endpoint...
        resp = client.post(
            "/portfolio/api/update_portfolio",
            json=[{"company": "HttpCo", "sector": "Infrastructure"}],
        )
        assert resp.status_code == 200, resp.get_json()

        # ...and the very next read must see the change (cache invalidated).
        after = client.get("/portfolio/api/portfolio_data/all").get_json()
        company = next(c for c in after["companies"] if c["name"] == "HttpCo")
        assert company["sector"] == "Infrastructure"

    def test_batch_update_is_partial(self, client, account):
        """A sector-only batch update must not wipe identifier or move the
        company to the default portfolio (regression: fields not present in
        the payload used to be overwritten with empty defaults)."""
        resp = client.post(
            "/portfolio/api/update_portfolio",
            json=[{"company": "HttpCo", "sector": "Shipping"}],
        )
        assert resp.status_code == 200, resp.get_json()

        items = client.get("/portfolio/api/portfolio_data").get_json()
        item = next(i for i in items if i["company"] == "HttpCo")
        assert item["sector"] == "Shipping"
        assert item["identifier"] == "HTTP"

    def test_state_roundtrip(self, client, account):
        resp = client.post(
            "/portfolio/api/state",
            json={"page": "performance", "selectedPortfolio": "7"},
        )
        assert resp.status_code == 200
        resp = client.get("/portfolio/api/state?page=performance")
        assert resp.get_json()["selectedPortfolio"] == "7"

    def test_etag_returns_304_on_revalidation(self, client, account):
        first = client.get("/portfolio/api/portfolio_data")
        etag = first.headers.get("ETag")
        assert etag, "GET JSON responses must carry an ETag"
        assert "max-age=30" in first.headers.get("Cache-Control", "")

        revalidation = client.get(
            "/portfolio/api/portfolio_data", headers={"If-None-Match": etag}
        )
        assert revalidation.status_code == 304

    def test_clear_account_revokes_access(self, client, account):
        client.post("/api/clear_account")
        assert client.get("/portfolio/api/portfolios").status_code == 401
        # Restore session for any later tests
        client.post(f"/api/select_account/{account['id']}")


class TestCanonicalValuation:
    """The backend is the single source of truth for position values:
    every holdings item carries current_value + value_source, and writes
    return the recomputed item so clients never re-derive values."""

    def test_portfolio_data_carries_server_computed_value(self, client, account):
        items = client.get("/portfolio/api/portfolio_data").get_json()
        item = next(i for i in items if i["company"] == "HttpCo")
        assert item["current_value"] == pytest.approx(100.0)  # 4 shares x 25 EUR
        assert item["value_source"] == "market"

    def test_update_returns_recomputed_item_and_invalidates_cache(self, client, account):
        cid = account["company_id"]
        # Prime the memoized read
        client.get("/portfolio/api/portfolio_data")

        resp = client.post(
            f"/portfolio/api/update_portfolio/{cid}",
            json={
                "custom_total_value": 500.0,
                "custom_price_eur": 125.0,
                "is_custom_value_edit": True,
            },
        )
        assert resp.status_code == 200, resp.get_json()
        returned = resp.get_json()["data"]["item"]
        assert returned["id"] == cid
        assert returned["current_value"] == pytest.approx(500.0)
        assert returned["value_source"] == "custom"

        # The very next read must see the same value (cache invalidated)
        items = client.get("/portfolio/api/portfolio_data").get_json()
        item = next(i for i in items if i["id"] == cid)
        assert item["current_value"] == pytest.approx(500.0)
        assert item["value_source"] == "custom"

        # Back to market pricing
        resp = client.post(
            f"/portfolio/api/update_portfolio/{cid}", json={"reset_custom_value": True}
        )
        assert resp.get_json()["data"]["item"]["value_source"] == "market"

    def test_update_returns_null_item_when_position_drops_out(self, client, account):
        cid = account["company_id"]
        resp = client.post(
            f"/portfolio/api/update_portfolio/{cid}",
            json={"override_share": 0, "is_user_edit": True},
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["data"]["item"] is None

        resp = client.post(
            f"/portfolio/api/update_portfolio/{cid}", json={"reset_shares": True}
        )
        item = resp.get_json()["data"]["item"]
        assert item["effective_shares"] == 4


class TestRebalanceModeParam:
    def test_portfolio_data_without_mode_has_no_rebalanced(self, client, account):
        resp = client.get("/portfolio/api/simulator/portfolio-data")
        assert resp.status_code == 200
        assert "rebalanced" not in resp.get_json()

    def test_mode_param_returns_server_computed_plan(self, client, account):
        resp = client.get(
            "/portfolio/api/simulator/portfolio-data?mode=new-with-sells&amount=100")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "rebalanced" in data
        # No builder targets exist in this fixture, so every portfolio comes
        # back as a zeroTarget entry that still carries a detailed plan.
        assert data["rebalanced"], "expected zeroTarget entries for untargeted portfolios"
        assert all(e.get("zeroTarget") for e in data["rebalanced"])
        for entry in data["rebalanced"]:
            assert {"targetValue", "discrepancy", "action", "detailed"} <= set(entry)
            detailed = entry["detailed"]
            assert {"sectors", "totalBuys", "totalSells",
                    "portfolioTargetValue"} <= set(detailed)

    def test_invalid_mode_rejected(self, client, account):
        resp = client.get("/portfolio/api/simulator/portfolio-data?mode=bogus")
        assert resp.status_code == 400
