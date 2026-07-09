"""
Tests for data-freshness fixes:

1. Timestamps written for market_prices.last_updated / accounts.last_price_update
   must be timezone-aware UTC ISO strings (the frontend parses tz-less strings
   as browser-local time, misclassifying fresh prices as stale).
2. The startup price-update gate must parse both legacy naive and new aware
   timestamps without crashing.
3. Prices/FX must be re-checked periodically, not only at process startup.
"""

from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import seed_account, seed_company, seed_portfolio


class TestTimestampsAreUtcAware:
    def test_update_price_in_db_writes_aware_utc_timestamps(self, db):
        from app.utils.db_utils import update_price_in_db

        account_id = seed_account(db)
        portfolio_id = seed_portfolio(db, account_id)
        seed_company(db, account_id, portfolio_id, "ACME", identifier="US0000000001")
        db.commit()

        assert update_price_in_db("US0000000001", 100.0, "USD", 92.0)

        row = db.execute(
            "SELECT last_updated FROM market_prices WHERE identifier = 'US0000000001'"
        ).fetchone()
        parsed = datetime.fromisoformat(row["last_updated"])
        assert parsed.tzinfo is not None
        assert parsed.utcoffset() == timedelta(0)

        acct = db.execute(
            "SELECT last_price_update FROM accounts WHERE id = ?", [account_id]
        ).fetchone()
        parsed_acct = datetime.fromisoformat(acct["last_price_update"])
        assert parsed_acct.tzinfo is not None
        assert parsed_acct.utcoffset() == timedelta(0)


class TestPriceUpdateGate:
    """_needs_price_update(last_str, interval) — pure staleness gate."""

    def test_missing_timestamp_needs_update(self):
        from app.utils.startup_tasks import _needs_price_update

        assert _needs_price_update(None, timedelta(hours=24)) is True

    def test_fresh_aware_timestamp_skips_update(self):
        from app.utils.startup_tasks import _needs_price_update

        fresh = datetime.now(timezone.utc).isoformat()
        assert _needs_price_update(fresh, timedelta(hours=24)) is False

    def test_stale_aware_timestamp_needs_update(self):
        from app.utils.startup_tasks import _needs_price_update

        stale = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        assert _needs_price_update(stale, timedelta(hours=24)) is True

    def test_legacy_naive_timestamp_does_not_crash(self):
        from app.utils.startup_tasks import _needs_price_update

        # Legacy rows: naive local isoformat, and the older space-separated form.
        naive_fresh = datetime.now().isoformat()
        assert _needs_price_update(naive_fresh, timedelta(hours=24)) is False
        naive_old = "2020-01-01 12:00:00"
        assert _needs_price_update(naive_old, timedelta(hours=24)) is True

    def test_unparseable_timestamp_needs_update(self):
        from app.utils.startup_tasks import _needs_price_update

        assert _needs_price_update("not-a-date", timedelta(hours=24)) is True


class TestPeriodicRefresh:
    def test_refresh_cycle_runs_both_refreshers(self, app, monkeypatch):
        from app.utils import startup_tasks

        calls = []
        monkeypatch.setattr(
            startup_tasks, "refresh_exchange_rates_if_needed",
            lambda: calls.append("fx") or True,
        )
        monkeypatch.setattr(
            startup_tasks, "auto_update_prices_if_needed",
            lambda: calls.append("prices") or {"status": "skipped"},
        )

        startup_tasks.run_refresh_cycle(app)
        assert "fx" in calls and "prices" in calls

    def test_refresh_cycle_isolates_failures(self, app, monkeypatch):
        from app.utils import startup_tasks

        calls = []
        monkeypatch.setattr(
            startup_tasks, "refresh_exchange_rates_if_needed",
            lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        )
        monkeypatch.setattr(
            startup_tasks, "auto_update_prices_if_needed",
            lambda: calls.append("prices") or {"status": "skipped"},
        )

        # One refresher failing must not prevent the other from running.
        startup_tasks.run_refresh_cycle(app)
        assert calls == ["prices"]
