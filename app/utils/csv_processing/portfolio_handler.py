"""
Portfolio Handler Module
Handles portfolio creation and assignment for CSV imports.
"""

import logging
from app.db_manager import query_db

logger = logging.getLogger(__name__)


def assign_portfolios(account_id: int, cursor) -> int:
    """
    Get or create default portfolio for CSV imports.

    CSV imports use a default portfolio named '-' unless companies
    already have portfolio assignments.

    Args:
        account_id: Account ID for this import
        cursor: Database cursor for operations

    Returns:
        int: Default portfolio ID
    """
    default_portfolio = query_db(
        'SELECT id FROM portfolios WHERE account_id = ? AND name = "-"',
        [account_id],
        one=True,
    )

    if not default_portfolio:
        logger.info(f"Creating default portfolio '-' for account {account_id}")
        cursor.execute(
            'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
            ['-', account_id],
        )
        default_portfolio_id = cursor.lastrowid
        logger.info(f"Created default portfolio with ID: {default_portfolio_id}")
    else:
        default_portfolio_id = default_portfolio['id']
        logger.info(f"Using existing default portfolio ID: {default_portfolio_id}")

    return default_portfolio_id


def get_existing_overrides(account_id: int) -> dict:
    """
    Get existing override shares to preserve user manual edits.

    Args:
        account_id: Account ID

    Returns:
        Dict[int, float]: company_id -> override_share mapping
    """
    existing_overrides = query_db(
        '''SELECT cs.company_id, cs.override_share
           FROM company_shares cs
           JOIN companies c ON cs.company_id = c.id
           WHERE c.account_id = ?''',
        [account_id]
    )

    override_map = {
        row['company_id']: row['override_share']
        for row in existing_overrides
        if row['override_share'] is not None
    }

    if override_map:
        logger.info(f"Found {len(override_map)} companies with user override shares")

    return override_map


def get_user_edit_data(account_id: int) -> dict:
    """
    Get user edit data to handle transactions after manual edits.

    This allows the system to apply only newer transactions on top of
    manual edits, preserving user intent.

    Args:
        account_id: Account ID

    Returns:
        Dict[str, Dict]: company_name -> edit data mapping
    """
    user_edit_data = query_db(
        '''SELECT cs.company_id, cs.shares, cs.override_share, cs.manual_edit_date,
                  cs.is_manually_edited, cs.csv_modified_after_edit, c.name
           FROM company_shares cs
           JOIN companies c ON cs.company_id = c.id
           WHERE c.account_id = ? AND cs.is_manually_edited = 1''',
        [account_id]
    )

    user_edit_map = {}
    for row in user_edit_data:
        user_edit_map[row['name']] = {
            'company_id': row['company_id'],
            'original_shares': row['shares'],  # Original CSV shares
            'manual_shares': row['override_share'],  # User-edited shares
            'manual_edit_date': row['manual_edit_date'],
            'csv_modified_after_edit': row['csv_modified_after_edit']
        }

    if user_edit_map:
        logger.info(f"Found {len(user_edit_map)} companies with manual edits")

    return user_edit_map
