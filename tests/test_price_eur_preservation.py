"""
Regression tests for price_eur=None handling.

get_isin_data can return success=True with priceEUR=None (no FX rate stored
and network down). The upsert must then update the native price but preserve
the previously stored price_eur — never clobber it with NULL (SQL valuation
paths use COALESCE(mp.price_eur, 0)) and never substitute the native price
1:1 as EUR.
"""

from tests.conftest import seed_price


def _get_row(conn, identifier):
    row = conn.execute(
        "SELECT price, currency, price_eur FROM market_prices WHERE identifier = ?",
        [identifier],
    ).fetchone()
    return dict(row) if row else None


class TestUpdatePriceInDb:
    def test_none_price_eur_preserves_existing_value(self, db):
        from app.utils.db_utils import update_price_in_db

        seed_price(db, "US0378331005", price=100.0, currency="USD", price_eur=92.0)
        db.commit()

        assert update_price_in_db("US0378331005", 110.0, "USD", None) is True

        row = _get_row(db, "US0378331005")
        assert row["price"] == 110.0
        assert row["price_eur"] == 92.0  # preserved, not NULLed

    def test_good_price_eur_overwrites(self, db):
        from app.utils.db_utils import update_price_in_db

        seed_price(db, "US0378331005", price=100.0, currency="USD", price_eur=92.0)
        db.commit()

        assert update_price_in_db("US0378331005", 110.0, "USD", 101.2) is True

        row = _get_row(db, "US0378331005")
        assert row["price"] == 110.0
        assert row["price_eur"] == 101.2

    def test_insert_new_row_with_none_price_eur(self, db):
        from app.utils.db_utils import update_price_in_db

        assert update_price_in_db("NEWTICKER", 50.0, "USD", None) is True

        row = _get_row(db, "NEWTICKER")
        assert row["price"] == 50.0
        assert row["price_eur"] is None  # nothing to preserve; must not be 50.0


class TestBatchExtractPriceData:
    def test_price_eur_none_passes_through(self):
        """No `or price` fallback: unconverted results keep price_eur=None."""
        from app.utils.batch_processing import _extract_price_data

        result = {
            "success": True,
            "data": {"currentPrice": 123.0, "priceEUR": None, "currency": "USD"},
        }
        extracted = _extract_price_data(result)
        assert extracted["price"] == 123.0
        assert extracted["price_eur"] is None

    def test_price_eur_present_is_used(self):
        from app.utils.batch_processing import _extract_price_data

        result = {
            "success": True,
            "data": {"currentPrice": 123.0, "priceEUR": 113.2, "currency": "USD"},
        }
        assert _extract_price_data(result)["price_eur"] == 113.2
