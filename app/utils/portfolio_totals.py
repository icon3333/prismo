"""
Portfolio totals utility - single source of truth for portfolio totals including cash.

This module provides consistent calculation of portfolio totals across the application,
ensuring that cash balance is always included in allocation percentage calculations.
"""

from app.repositories.account_repository import AccountRepository
import logging

logger = logging.getLogger(__name__)


def get_portfolio_totals(account_id: int, holdings_value: float) -> dict:
    """
    Get portfolio totals including cash balance.

    This function provides the canonical way to calculate portfolio totals
    that should be used for all allocation percentage calculations.

    Formula change across the app:
    - Before: position_value / total_holdings * 100
    - After:  position_value / (total_holdings + cash) * 100

    Args:
        account_id: The account ID to get cash balance for
        holdings_value: Sum of all position values (excluding cash)

    Returns:
        Dictionary containing:
        - holdings: float - Sum of position values (excluding cash)
        - cash: float - Cash balance from account
        - total: float - holdings + cash (use this for percentage calculations)

    Example:
        totals = get_portfolio_totals(account_id, sum(p['value'] for p in positions))
        percentage = position_value / totals['total'] * 100
    """
    cash = AccountRepository.get_cash(account_id)

    totals = {
        'holdings': holdings_value,
        'cash': cash,
        'total': holdings_value + cash
    }

    logger.debug(f"Portfolio totals for account {account_id}: holdings={holdings_value:.2f}, cash={cash:.2f}, total={totals['total']:.2f}")

    return totals


def calculate_percentage(value: float, totals: dict) -> float:
    """
    Calculate percentage of a value against portfolio total (including cash).

    Args:
        value: The value to calculate percentage for
        totals: Dictionary from get_portfolio_totals()

    Returns:
        Percentage value (0-100), or 0 if total is 0
    """
    if totals['total'] <= 0:
        return 0.0
    return (value / totals['total']) * 100
