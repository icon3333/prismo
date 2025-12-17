"""
Transaction Manager Module
Applies share changes to database with transaction safety.
"""

import logging
from typing import Dict, Set, List
from app.db_manager import query_db

logger = logging.getLogger(__name__)


def apply_share_changes(
    account_id: int,
    company_positions: Dict[str, Dict],
    share_calculations: Dict[str, Dict],
    existing_company_map: Dict[str, Dict],
    override_map: Dict[int, float],
    default_portfolio_id: int,
    companies_to_remove: Set[str],
    cursor,
    progress_callback=None
) -> Dict[str, List[str]]:
    """
    Apply share changes to database within a transaction.

    This function:
    1. Updates or inserts companies with new share counts
    2. Preserves user manual edits and portfolio assignments
    3. Removes companies not in CSV or with zero shares
    4. Provides progress updates if callback provided

    Args:
        account_id: Account ID for this import
        company_positions: Dict of company_name -> position data
        share_calculations: Dict of company_name -> calculated shares
        existing_company_map: Dict of company_name -> existing DB record
        override_map: Dict of company_id -> existing override_share
        default_portfolio_id: Default portfolio for new companies
        companies_to_remove: Set of company names to remove
        cursor: Database cursor for operations
        progress_callback: Optional callback(current, total, message, status)

    Returns:
        Dict with 'added', 'updated', 'removed' lists of company names, and 'protected_identifiers_count'
    """
    positions_added = []
    positions_updated = []
    positions_removed = []
    protected_identifiers_count = 0

    total_companies = len(share_calculations)
    processed_companies = 0

    # Process company updates and additions
    for company_name, share_data in share_calculations.items():
        processed_companies += 1

        if progress_callback:
            progress_percentage = 60 + int((processed_companies / total_companies) * 20)  # 60-80% range
            progress_callback(
                progress_percentage, 100,
                f"Processing company {processed_companies}/{total_companies}: {company_name[:30]}...",
                "processing"
            )

        position = company_positions[company_name]
        current_shares = share_data['csv_shares']
        override_shares = share_data['override_shares']
        total_invested = position['total_invested']

        # Update or insert company
        if company_name in existing_company_map:
            identifier_was_protected = _update_existing_company(
                company_name=company_name,
                existing_company_map=existing_company_map,
                position=position,
                share_data=share_data,
                override_map=override_map,
                default_portfolio_id=default_portfolio_id,
                cursor=cursor
            )
            if identifier_was_protected:
                protected_identifiers_count += 1
            positions_updated.append(company_name)
        else:
            _insert_new_company(
                company_name=company_name,
                position=position,
                current_shares=current_shares,
                default_portfolio_id=default_portfolio_id,
                account_id=account_id,
                cursor=cursor
            )
            positions_added.append(company_name)

    # Remove companies not in CSV or with zero shares
    for company_name in companies_to_remove:
        if _remove_company(company_name, existing_company_map, account_id, cursor):
            positions_removed.append(company_name)

    return {
        'added': positions_added,
        'updated': positions_updated,
        'removed': positions_removed,
        'protected_identifiers_count': protected_identifiers_count
    }


def _update_existing_company(
    company_name: str,
    existing_company_map: Dict,
    position: Dict,
    share_data: Dict,
    override_map: Dict,
    default_portfolio_id: int,
    cursor
) -> bool:
    """
    Update an existing company record.

    Returns:
        bool: True if identifier was protected (manually edited), False otherwise
    """
    company_id = existing_company_map[company_name]['id']
    existing_portfolio_id = existing_company_map[company_name]['portfolio_id']

    # Check if identifier was manually edited
    manual_edit_check = query_db(
        'SELECT identifier_manually_edited, override_identifier FROM companies WHERE id = ?',
        [company_id],
        one=True
    )

    # Determine which identifier to use
    identifier_protected = False
    if manual_edit_check and manual_edit_check.get('identifier_manually_edited'):
        # Keep the manually edited identifier
        final_identifier = manual_edit_check.get('override_identifier')
        identifier_protected = True
        logger.info(f"Protecting manually edited identifier for {company_name}: {final_identifier}")
    else:
        # Use CSV identifier
        final_identifier = position['identifier']

    # Preserve existing portfolio assignment unless it's None
    final_portfolio_id = existing_portfolio_id if existing_portfolio_id else default_portfolio_id

    # Update company record (now with protected identifier)
    cursor.execute(
        'UPDATE companies SET identifier = ?, portfolio_id = ?, total_invested = ? WHERE id = ?',
        [final_identifier, final_portfolio_id, position['total_invested'], company_id]
    )

    # Get existing override if any
    existing_override = override_map.get(company_id)

    # Update or insert shares based on manual edit status
    if share_data['has_manual_edit']:
        # User has manually edited - handle accordingly
        _update_shares_with_manual_edit(company_id, share_data, cursor)
    else:
        # Normal CSV processing - use existing override if any
        _update_shares_normal(
            company_id,
            share_data['csv_shares'],
            existing_override,
            cursor
        )

    return identifier_protected


def _update_shares_with_manual_edit(company_id: int, share_data: Dict, cursor) -> None:
    """Update shares for a manually edited company."""
    share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)

    if share_data['csv_modified_after_edit']:
        # CSV has newer transactions - update both CSV and override shares
        if share_row:
            cursor.execute(
                '''UPDATE company_shares
                   SET shares = ?, override_share = ?, csv_modified_after_edit = 1
                   WHERE company_id = ?''',
                [share_data['csv_shares'], share_data['override_shares'], company_id]
            )
        else:
            cursor.execute(
                '''INSERT INTO company_shares
                   (company_id, shares, override_share, is_manually_edited, csv_modified_after_edit)
                   VALUES (?, ?, ?, 1, 1)''',
                [company_id, share_data['csv_shares'], share_data['override_shares']]
            )
    else:
        # No newer transactions - update CSV shares but keep override as is
        if share_row:
            cursor.execute(
                'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                [share_data['csv_shares'], share_data['override_shares'], company_id]
            )
        else:
            cursor.execute(
                '''INSERT INTO company_shares
                   (company_id, shares, override_share, is_manually_edited)
                   VALUES (?, ?, ?, 1)''',
                [company_id, share_data['csv_shares'], share_data['override_shares']]
            )


def _update_shares_normal(company_id: int, csv_shares: float, existing_override: float, cursor) -> None:
    """Update shares for a non-manually-edited company."""
    share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)

    if share_row:
        cursor.execute(
            'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
            [csv_shares, existing_override, company_id]
        )
    else:
        cursor.execute(
            'INSERT INTO company_shares (company_id, shares, override_share) VALUES (?, ?, ?)',
            [company_id, csv_shares, existing_override]
        )


def _insert_new_company(
    company_name: str,
    position: Dict,
    current_shares: float,
    default_portfolio_id: int,
    account_id: int,
    cursor
) -> None:
    """Insert a new company record."""
    cursor.execute(
        '''INSERT INTO companies
           (name, identifier, category, portfolio_id, account_id, total_invested)
           VALUES (?, ?, ?, ?, ?, ?)''',
        [company_name, position['identifier'], '', default_portfolio_id,
         account_id, position['total_invested']]
    )
    company_id = cursor.lastrowid

    cursor.execute(
        'INSERT INTO company_shares (company_id, shares) VALUES (?, ?)',
        [company_id, current_shares]
    )

    logger.info(f"Added new company: {company_name} with {current_shares} shares")


def _remove_company(company_name: str, existing_company_map: Dict, account_id: int, cursor) -> bool:
    """Remove a company and clean up related records."""
    if company_name not in existing_company_map:
        logger.warning(
            f"Cannot remove company '{company_name}' - not found in existing_company_map. "
            f"Available companies: {list(existing_company_map.keys())}"
        )
        return False

    company_id = existing_company_map[company_name]['id']
    identifier = existing_company_map[company_name]['identifier']

    # Determine removal reason for logging
    logger.info(f"Removing company '{company_name}' (ID: {company_id}, identifier: {identifier})")

    # Remove shares first (foreign key constraint)
    cursor.execute('DELETE FROM company_shares WHERE company_id = ?', [company_id])
    shares_deleted = cursor.rowcount
    logger.debug(f"Deleted {shares_deleted} share record(s) for company_id {company_id}")

    # Remove company
    cursor.execute('DELETE FROM companies WHERE id = ?', [company_id])
    companies_deleted = cursor.rowcount
    logger.debug(f"Deleted {companies_deleted} company record(s) for company_id {company_id}")

    if companies_deleted == 0:
        logger.error(f"Failed to delete company '{company_name}' (ID: {company_id}) from database")

    # Clean up market prices if no other accounts use this identifier
    if identifier:
        other_companies_count = query_db(
            'SELECT COUNT(*) as count FROM companies WHERE identifier = ? AND account_id != ?',
            [identifier, account_id],
            one=True
        )
        if other_companies_count and other_companies_count['count'] == 0:
            logger.info(f"No other accounts use {identifier}, removing from market_prices")
            cursor.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])

    return True
