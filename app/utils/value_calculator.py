"""
Centralized value calculation utility.
Single source of truth for calculating portfolio item values.

This module provides consistent value calculation across the entire application,
ensuring that custom values are properly used when available.

Philosophy: Simple, Modular, Elegant, Efficient, Robust
"""
from decimal import Decimal
from typing import Dict, Any, List, Union


def calculate_item_value(item: Dict[str, Any]) -> Decimal:
    """
    Calculate the total value of a portfolio item.

    Uses custom_total_value if available and valid,
    otherwise calculates from price_eur * effective_shares.

    This is the single source of truth for value calculation.
    Use this function everywhere to ensure consistency.

    Args:
        item: Portfolio item dict with keys:
              - is_custom_value (bool): Whether custom value is set
              - custom_total_value (float/Decimal/None): Custom total value if set
              - price_eur (float/Decimal/None): Market price in EUR
              - effective_shares (float/Decimal/None): Number of shares

    Returns:
        Decimal: Total value in EUR

    Examples:
        >>> # Item with custom value
        >>> item = {'is_custom_value': True, 'custom_total_value': 165938.39}
        >>> calculate_item_value(item)
        Decimal('165938.39')

        >>> # Item with market price
        >>> item = {'price_eur': 100, 'effective_shares': 10}
        >>> calculate_item_value(item)
        Decimal('1000.00')

        >>> # Item with no price or custom value
        >>> item = {}
        >>> calculate_item_value(item)
        Decimal('0')
    """
    # Use custom value if explicitly set
    if item.get('is_custom_value') and item.get('custom_total_value') is not None:
        return Decimal(str(item.get('custom_total_value', 0)))

    # Otherwise calculate from price * shares
    price = Decimal(str(item.get('price_eur', 0) or 0))
    shares = Decimal(str(item.get('effective_shares', 0) or 0))
    return price * shares


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

    # Has market price
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
        >>> get_value_source({'price_eur': 100, 'effective_shares': 10})
        'market'
        >>> get_value_source({})
        'none'
    """
    if item.get('is_custom_value') and item.get('custom_total_value') is not None:
        return 'custom'
    elif item.get('price_eur') is not None and item.get('price_eur') > 0:
        return 'market'
    else:
        return 'none'
