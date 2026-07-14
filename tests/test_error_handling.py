"""Global error handler behavior (app/errors.py).

A dedicated app instance gets throwaway routes that raise each exception
class, verifying that routes can rely on propagation instead of
per-handler try/except boilerplate, and that the API stays JSON-only
(no HTML error pages).
"""

import os

import pytest


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("prismo-errors")
    db_path = data_dir / "portfolio.db"
    os.environ.setdefault("SECRET_KEY", "test-secret-key")
    os.environ["APP_DATA_DIR"] = str(data_dir)
    os.environ["FLASK_ENV"] = "development"  # skips startup background tasks
    # Pin the DB to a throwaway file. Popping DATABASE_URL is NOT enough:
    # config.py's load_dotenv() re-adds the real DATABASE_URL from .env, which
    # takes precedence over APP_DATA_DIR — so create_app() would otherwise run
    # init_db/migrate against the real instance DB. Setting it wins because
    # load_dotenv() never overrides an env var that is already present.
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

    from app.main import create_app

    flask_app = create_app("development")

    resolved = flask_app.config["SQLALCHEMY_DATABASE_URI"]
    assert str(db_path) in resolved, (
        f"error-handling test app must use the throwaway DB, got {resolved!r}"
    )

    from app.exceptions import (
        ValidationError,
        NotFoundError,
        DataIntegrityError,
        PriceFetchError,
    )

    # Throwaway routes: raise instead of returning error responses.
    @flask_app.route("/boom/validation")
    def _boom_validation():
        raise ValidationError("bad input")

    @flask_app.route("/boom/notfound")
    def _boom_notfound():
        raise NotFoundError("Company", 42)

    @flask_app.route("/boom/integrity")
    def _boom_integrity():
        raise DataIntegrityError("constraint violated")

    @flask_app.route("/boom/price")
    def _boom_price():
        raise PriceFetchError("yfinance down")

    @flask_app.route("/boom/unexpected")
    def _boom_unexpected():
        raise RuntimeError("secret internals leaked?")

    return flask_app


@pytest.fixture(scope="module")
def client(app):
    with app.test_client() as c:
        yield c


class TestTypedExceptionMapping:
    @pytest.mark.parametrize(
        "path,status,fragment",
        [
            ("/boom/validation", 400, "bad input"),
            ("/boom/notfound", 404, "Company not found: 42"),
            ("/boom/integrity", 409, "constraint violated"),
            ("/boom/price", 502, "yfinance down"),
        ],
    )
    def test_typed_exceptions_map_to_json_status(self, client, path, status, fragment):
        resp = client.get(path)
        assert resp.status_code == status
        body = resp.get_json()
        assert body["success"] is False
        assert fragment in body["error"]

    def test_unexpected_exception_is_500_without_leaking_details(self, client):
        resp = client.get("/boom/unexpected")
        assert resp.status_code == 500
        body = resp.get_json()
        assert body == {"success": False, "error": "Internal server error"}
        assert b"secret internals" not in resp.data

    def test_unknown_url_returns_json_not_html(self, client):
        resp = client.get("/no/such/route")
        assert resp.status_code == 404
        assert resp.is_json
        assert resp.get_json()["success"] is False

    def test_wrong_method_returns_json_405(self, client):
        resp = client.post("/health")
        assert resp.status_code == 405
        assert resp.is_json
