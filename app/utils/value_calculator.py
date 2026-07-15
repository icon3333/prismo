"""
Centralized value calculation utility.
Single source of truth for calculating portfolio item values.

This module provides consistent value calculation across the entire application,
ensuring that custom values are properly used when available.

Currency Conversion Strategy:
- Prices are stored in native currency (USD, GBP, etc.)
- Exchange rates are fetched once per 24h and stored in database
- All EUR conversions use the same daily rate for consistency
- Fallback to price_eur for backward compatibility

Calculation Priority:
1. Custom value (if is_custom_value and custom_total_value)
2. Native currency: price * exchange_rate(currency) * shares
3. Legacy fallback: price_eur * shares

Philosophy: Simple, Modular, Elegant, Efficient, Robust
"""
from typing import Dict, Any, List, Optional
import logging
import time

logger = logging.getLogger(__name__)

# Module-level cache for exchange rates with a TTL. Rates change at most once a
# day; the TTL bounds staleness to a few minutes so an out-of-band DB refresh is
# picked up without holding first-request rates forever, and
# clear_exchange_rate_cache() still forces an immediate in-process reload.
_exchange_rates_cache: Optional[Dict[str, float]] = None
_exchange_rates_loaded_at: float = 0.0
_EXCHANGE_RATES_TTL_SECONDS = 300

# Hardcoded fallback rates (approximate) for common currencies when DB rates unavailable
# These are rough estimates - actual rates should come from the database
# Using 1.0 as fallback would cause USD assets to be valued as EUR (major error)
_FALLBACK_RATES: Dict[str, float] = {
    'EUR': 1.0,
    'USD': 0.92,   # ~0.92 EUR per USD
    'GBP': 1.17,   # ~1.17 EUR per GBP
    'CHF': 1.05,   # ~1.05 EUR per CHF
    'JPY': 0.0061, # ~0.0061 EUR per JPY
    'CAD': 0.68,   # ~0.68 EUR per CAD
    'AUD': 0.60,   # ~0.60 EUR per AUD
    'SEK': 0.087,  # ~0.087 EUR per SEK
    'NOK': 0.085,  # ~0.085 EUR per NOK
    'DKK': 0.134,  # ~0.134 EUR per DKK
    'HKD': 0.118,  # ~0.118 EUR per HKD
    'SGD': 0.69,   # ~0.69 EUR per SGD
    'NZD': 0.55,   # ~0.55 EUR per NZD
}


def _get_exchange_rate(currency: str) -> Optional[float]:
    """
    Get exchange rate for a currency to EUR.

    Uses cached rates from ExchangeRateRepository for consistency.
    All positions use the same daily rate.

    Args:
        currency: Currency code (e.g., 'USD', 'GBP')

    Returns:
        Exchange rate to EUR, fallback rate if not in DB, or None when the
        currency is unknown — valuing an unknown currency 1:1 with EUR would
        silently misprice the position (KRW would be ~1400x too high), so
        callers must fall back to price_eur or treat the value as missing.
    """
    global _exchange_rates_cache, _exchange_rates_loaded_at

    if currency == 'EUR' or not currency:
        return 1.0

    # Lazy load rates on first access, and reload after the TTL expires so
    # long-lived workers pick up rates refreshed by other processes.
    if (_exchange_rates_cache is None
            or time.monotonic() - _exchange_rates_loaded_at > _EXCHANGE_RATES_TTL_SECONDS):
        try:
            from app.repositories.exchange_rate_repository import ExchangeRateRepository
            _exchange_rates_cache = ExchangeRateRepository.get_all_rates('EUR')
            logger.debug(f"Loaded {len(_exchange_rates_cache)} exchange rates for value calculation")
        except Exception as e:
            logger.error(f"Failed to load exchange rates from database: {e}. Using fallback rates.")
            if _exchange_rates_cache is None:
                _exchange_rates_cache = _FALLBACK_RATES.copy()
        _exchange_rates_loaded_at = time.monotonic()

    rate = _exchange_rates_cache.get(currency)
    if rate is None:
        # Check fallback rates for common currencies
        fallback_rate = _FALLBACK_RATES.get(currency)
        if fallback_rate is not None:
            logger.warning(f"No exchange rate found for {currency} in DB, using fallback rate {fallback_rate}")
            return fallback_rate
        else:
            logger.error(f"No exchange rate available for currency {currency}; "
                         "position will fall back to stored price_eur or be valued as missing")
            return None

    return rate


def clear_exchange_rate_cache() -> None:
    """
    Clear the module-level exchange rate cache.

    Call this when exchange rates are refreshed to ensure
    subsequent calculations use the new rates.
    """
    global _exchange_rates_cache, _exchange_rates_loaded_at
    _exchange_rates_cache = None
    _exchange_rates_loaded_at = 0.0
    logger.debug("Cleared value_calculator exchange rate cache")


def calculate_item_value(item: Dict[str, Any]) -> float:
    """
    Calculate the total value of a portfolio item in EUR.

    Returns a float. This is display math (dashboards, allocation %), not
    money arithmetic — float is plenty precise and ~5–10× faster than the
    previous Decimal(str(...)) wrappers in the per-item hot loop.

    Priority:
    1. Custom value (is_custom_value=True, custom_total_value)
    2. Native currency: price * exchange_rate(currency) * shares
    3. Legacy: price_eur * shares
    """
    # Priority 1: explicit custom value
    if item.get('is_custom_value') and item.get('custom_total_value') is not None:
        return float(item.get('custom_total_value') or 0)

    # Nullish fallback (not `or`): an explicit 0 override means the position
    # is zeroed out and must value as 0 — matching the SQL path's
    # COALESCE(override_share, shares, 0) and the frontend's `?? ` semantics.
    shares_value = item.get('effective_shares')
    if shares_value is None:
        shares_value = item.get('shares')
    shares = float(shares_value or 0)

    # Priority 2: native currency conversion (skipped when no rate is known —
    # the legacy price_eur below is then the best available value)
    native_price = item.get('price')
    currency = item.get('currency')
    if native_price is not None and native_price > 0 and currency:
        rate = _get_exchange_rate(currency)
        if rate is not None:
            return float(native_price) * float(rate) * shares

    # Priority 3: legacy price_eur
    return float(item.get('price_eur') or 0) * shares


def calculate_portfolio_total(items: List[Dict[str, Any]]) -> float:
    """Total portfolio value in EUR (float)."""
    return sum((calculate_item_value(item) for item in items), 0.0)


# SQL fragment selecting the inputs calculate_item_value() needs, for queries
# joining companies c / company_shares cs / market_prices mp. Every endpoint
# computes values through calculate_item_value() in Python rather than
# re-implementing the formula in SQL — a SQL shares×price_eur copy drifts from
# the native price × daily FX path between price refreshes, so the same
# portfolio would show different totals on different pages.
VALUE_INPUT_COLUMNS_SQL = (
    "c.is_custom_value, c.custom_total_value, "
    "COALESCE(cs.override_share, cs.shares, 0) AS effective_shares, "
    "mp.price, mp.currency, mp.price_eur"
)


def get_value_source(item: Dict[str, Any]) -> str:
    """
    Get the source of the value for an item.

    Returns a string indicating whether the value comes from
    custom input or market price calculation.

    Args:
        item: Portfolio item dict

    Returns:
        str: 'custom', 'market', or 'none'

    Examples:
        >>> get_value_source({'is_custom_value': True, 'custom_total_value': 1000})
        'custom'
        >>> get_value_source({'price': 100, 'currency': 'USD', 'effective_shares': 10})
        'market'
        >>> get_value_source({'price_eur': 100, 'effective_shares': 10})
        'market'
        >>> get_value_source({})
        'none'
    """
    if item.get('is_custom_value') and item.get('custom_total_value') is not None:
        return 'custom'
    elif (item.get('price') is not None and item.get('price') > 0
          and item.get('currency')
          and _get_exchange_rate(item.get('currency')) is not None):
        return 'market'
    elif item.get('price_eur') is not None and item.get('price_eur') > 0:
        return 'market'
    else:
        return 'none'


def has_price_or_custom_value(item: Dict[str, Any]) -> bool:
    """
    Check if an item has either a market price or a custom value.

    This is useful for filtering items that have some form of valuation.

    Args:
        item: Portfolio item dict

    Returns:
        bool: True if item has price or custom value, False otherwise

    Examples:
        >>> has_price_or_custom_value({'price': 100, 'currency': 'USD'})
        True
        >>> has_price_or_custom_value({'price_eur': 100})
        True
        >>> has_price_or_custom_value({'is_custom_value': True, 'custom_total_value': 1000})
        True
        >>> has_price_or_custom_value({})
        False
    """
    return get_value_source(item) != 'none'
