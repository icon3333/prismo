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

# Module-level cache for exchange rates with a TTL. Rates change at most once
# a day, but long-lived gunicorn workers (max_requests=0) would otherwise keep
# first-request rates forever: the master process refreshes the DB, and the
# worker's module-level cache is never invalidated cross-process. The TTL
# bounds staleness to a few minutes; clear_exchange_rate_cache() still forces
# an immediate in-process reload.
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


def _get_exchange_rate(currency: str) -> float:
    """
    Get exchange rate for a currency to EUR.

    Uses cached rates from ExchangeRateRepository for consistency.
    All positions use the same daily rate.

    Args:
        currency: Currency code (e.g., 'USD', 'GBP')

    Returns:
        Exchange rate to EUR, or fallback rate if not found
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
            # Unknown currency - log error as this could cause significant valuation errors
            logger.error(f"No exchange rate found for unknown currency {currency}, using 1.0 (WILL CAUSE INCORRECT VALUATION)")
            return 1.0

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

    # Priority 2: native currency conversion
    native_price = item.get('price')
    currency = item.get('currency')
    if native_price is not None and native_price > 0 and currency:
        return float(native_price) * float(_get_exchange_rate(currency)) * shares

    # Priority 3: legacy price_eur
    return float(item.get('price_eur') or 0) * shares


def calculate_portfolio_total(items: List[Dict[str, Any]]) -> float:
    """Total portfolio value in EUR (float)."""
    return sum((calculate_item_value(item) for item in items), 0.0)


def get_value_calculation_sql() -> str:
    """
    Get SQL expression for calculating item value in database queries.

    Use this in SELECT statements to ensure consistent calculation
    at the database level. This is particularly useful for aggregations
    and when you need calculated values in the query result.

    The SQL assumes standard table aliases:
    - c: companies table
    - cs: company_shares table
    - mp: market_prices table

    Returns:
        str: SQL CASE statement for value calculation

    Example:
        >>> from app.utils.value_calculator import get_value_calculation_sql
        >>> sql = f'''
        ...     SELECT
        ...         c.name,
        ...         {get_value_calculation_sql()} as item_value
        ...     FROM companies c
        ...     LEFT JOIN company_shares cs ON c.id = cs.company_id
        ...     LEFT JOIN market_prices mp ON c.identifier = mp.identifier
        ... '''
    """
    # Note: Uses price_eur (pre-computed during price fetch) rather than joining
    # exchange_rates table. This stays in sync because price_eur is updated every
    # time prices are refreshed. Minor drift possible between refreshes if exchange
    # rates change independently, but acceptable for daily-refresh homeserver use.
    return """CASE
            WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL
            THEN c.custom_total_value
            ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
        END"""


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
    elif item.get('price') is not None and item.get('price') > 0 and item.get('currency'):
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
