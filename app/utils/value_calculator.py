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
from decimal import Decimal
from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)

# Module-level cache for exchange rates (loaded once per request cycle)
_exchange_rates_cache: Optional[Dict[str, float]] = None


def _get_exchange_rate(currency: str) -> float:
    """
    Get exchange rate for a currency to EUR.

    Uses cached rates from ExchangeRateRepository for consistency.
    All positions use the same daily rate.

    Args:
        currency: Currency code (e.g., 'USD', 'GBP')

    Returns:
        Exchange rate to EUR, or 1.0 if not found
    """
    global _exchange_rates_cache

    if currency == 'EUR' or not currency:
        return 1.0

    # Lazy load rates on first access
    if _exchange_rates_cache is None:
        try:
            from app.repositories.exchange_rate_repository import ExchangeRateRepository
            _exchange_rates_cache = ExchangeRateRepository.get_all_rates('EUR')
            logger.debug(f"Loaded {len(_exchange_rates_cache)} exchange rates for value calculation")
        except Exception as e:
            logger.warning(f"Could not load exchange rates: {e}")
            _exchange_rates_cache = {'EUR': 1.0}

    rate = _exchange_rates_cache.get(currency)
    if rate is None:
        logger.warning(f"No exchange rate found for {currency}, using 1.0")
        return 1.0

    return rate


def clear_exchange_rate_cache() -> None:
    """
    Clear the module-level exchange rate cache.

    Call this when exchange rates are refreshed to ensure
    subsequent calculations use the new rates.
    """
    global _exchange_rates_cache
    _exchange_rates_cache = None
    logger.debug("Cleared value_calculator exchange rate cache")


def calculate_item_value(item: Dict[str, Any]) -> Decimal:
    """
    Calculate the total value of a portfolio item in EUR.

    Calculation Priority:
    1. Custom value: If is_custom_value=True, use custom_total_value
    2. Native currency: price * exchange_rate(currency) * shares
    3. Legacy fallback: price_eur * shares (for backward compatibility)

    This is the single source of truth for value calculation.
    Use this function everywhere to ensure consistency.

    Args:
        item: Portfolio item dict with keys:
              - is_custom_value (bool): Whether custom value is set
              - custom_total_value (float/Decimal/None): Custom total value if set
              - price (float/Decimal/None): Native currency price
              - currency (str/None): Currency code (e.g., 'USD', 'GBP')
              - price_eur (float/Decimal/None): Legacy EUR price (fallback)
              - effective_shares (float/Decimal/None): Number of shares

    Returns:
        Decimal: Total value in EUR

    Examples:
        >>> # Item with custom value (highest priority)
        >>> item = {'is_custom_value': True, 'custom_total_value': 165938.39}
        >>> calculate_item_value(item)
        Decimal('165938.39')

        >>> # Item with native currency (assumes USD/EUR rate loaded)
        >>> item = {'price': 150, 'currency': 'USD', 'effective_shares': 10}
        >>> calculate_item_value(item)  # 150 * rate * 10
        Decimal('1388.89')  # example with rate 0.926

        >>> # Item with legacy price_eur (fallback)
        >>> item = {'price_eur': 100, 'effective_shares': 10}
        >>> calculate_item_value(item)
        Decimal('1000.00')

        >>> # Item with no price or custom value
        >>> item = {}
        >>> calculate_item_value(item)
        Decimal('0')
    """
    # Priority 1: Use custom value if explicitly set
    if item.get('is_custom_value') and item.get('custom_total_value') is not None:
        return Decimal(str(item.get('custom_total_value', 0)))

    shares = Decimal(str(item.get('effective_shares', 0) or 0))

    # Priority 2: Native currency conversion (price * exchange_rate * shares)
    native_price = item.get('price')
    currency = item.get('currency')

    if native_price is not None and native_price > 0 and currency:
        exchange_rate = _get_exchange_rate(currency)
        price_eur = Decimal(str(native_price)) * Decimal(str(exchange_rate))
        return price_eur * shares

    # Priority 3: Legacy fallback (price_eur * shares)
    price_eur = Decimal(str(item.get('price_eur', 0) or 0))
    return price_eur * shares


def calculate_portfolio_total(items: List[Dict[str, Any]]) -> Decimal:
    """
    Calculate total value across multiple portfolio items.

    This uses calculate_item_value() for each item to ensure
    custom values are properly accounted for.

    Args:
        items: List of portfolio item dicts

    Returns:
        Decimal: Total portfolio value in EUR

    Examples:
        >>> items = [
        ...     {'price_eur': 100, 'effective_shares': 10},
        ...     {'is_custom_value': True, 'custom_total_value': 5000},
        ...     {'price_eur': 50, 'effective_shares': 20}
        ... ]
        >>> calculate_portfolio_total(items)
        Decimal('7000')  # 1000 + 5000 + 1000
    """
    return sum(calculate_item_value(item) for item in items)


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
    return """CASE
            WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL
            THEN c.custom_total_value
            ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
        END"""


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
    # Has custom value
    if item.get('is_custom_value') and item.get('custom_total_value') is not None:
        return True

    # Has native currency price
    if item.get('price') is not None and item.get('price') > 0 and item.get('currency'):
        return True

    # Has legacy EUR price (fallback)
    if item.get('price_eur') is not None and item.get('price_eur') > 0:
        return True

    return False


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
