import sys
import types

# Provide a minimal flask stub if Flask is not available
if 'flask' not in sys.modules:
    flask_stub = types.ModuleType('flask')
    flask_stub.session = {}
    sys.modules['flask'] = flask_stub

from app.utils import db_utils


def test_update_prices_conversion(monkeypatch):
    items = [{'identifier': 'TEST'}]

    def fake_get_price(identifier):
        return True, {
            'price': 10.0,
            'currency': 'USD',
            'price_eur': 5.0,
            'country': None,
        }

    monkeypatch.setattr(db_utils, 'update_price_in_db', lambda *args, **kwargs: True)

    updated, success, failure = db_utils.update_prices(items, get_price_function=fake_get_price)

    assert updated[0]['price_eur'] == 5.0
    assert updated[0]['currency'] == 'USD'
    assert success == 1
    assert failure == 0
