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
    progress_callback=None,
    source: str = 'parqet'
) -> Dict[str, List[str]]:
    """
    Apply share changes to database within a transaction.

    This function:
    1. Updates or inserts companies with new share counts
    2. Preserves user manual edits and portfolio assignments
    3. Removes companies not in CSV or with zero shares (scoped to source)
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
        source: Import source ('parqet' or 'ibkr') for new companies and scoped deletion

    Returns:
        Dict with 'added', 'updated', 'removed' lists of company names, and 'protected_identifiers_count'
    """
    positions_added = []
    positions_updated = []
    positions_removed = []
    protected_identifiers_count = 0

    total_companies = len(share_calculations)
    processed_companies = 0

    # Pre-fetch all company data (identifier edits + shares + source) in a single query to avoid N+1
    # This combines what used to be two separate queries into one efficient JOIN
    identifier_edit_map = {}
    shares_exist_map = {}
    manual_company_ids = set()  # Track manually-added companies for protection
    company_data_rows = query_db(
        '''SELECT
            c.id,
            c.identifier_manually_edited,
            c.override_identifier,
            c.source,
            cs.shares,
            cs.override_share,
            cs.is_manually_edited,
            cs.manual_edit_date
           FROM companies c
           LEFT JOIN company_shares cs ON cs.company_id = c.id
           WHERE c.account_id = ?''',
        [account_id]
    )

    # Track company sources for broker-scoped deletion
    company_source_map = {}  # company_id -> source

    # Build lookup maps from the combined query result
    for row in company_data_rows:
        company_id = row['id']
        # Build identifier edit map
        identifier_edit_map[company_id] = {
            'identifier_manually_edited': row['identifier_manually_edited'],
            'override_identifier': row['override_identifier']
        }
        # Build shares existence map
        if row['shares'] is not None:
            shares_exist_map[company_id] = True
        # Track manual companies for protection during removal
        if row.get('source') == 'manual':
            manual_company_ids.add(company_id)
        # Track all company sources
        company_source_map[company_id] = row.get('source', 'parqet')

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
                cursor=cursor,
                identifier_edit_map=identifier_edit_map,
                shares_exist_map=shares_exist_map
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
                cursor=cursor,
                source=source
            )
            positions_added.append(company_name)

    # Pre-fetch identifiers used by OTHER accounts to avoid N+1 queries during removal
    # This single query replaces the per-company query in _remove_company
    identifiers_to_check = {
        existing_company_map[name]['identifier']
        for name in companies_to_remove
        if name in existing_company_map and existing_company_map[name].get('identifier')
    }

    shared_identifiers = set()
    if identifiers_to_check:
        # Single query to find all identifiers used by other accounts
        placeholders = ','.join('?' * len(identifiers_to_check))
        shared_rows = query_db(
            f'''SELECT DISTINCT identifier FROM companies
                WHERE identifier IN ({placeholders}) AND account_id != ?''',
            list(identifiers_to_check) + [account_id]
        )
        # Guard against None result from query_db
        if shared_rows:
            shared_identifiers = {row['identifier'] for row in shared_rows}
            logger.debug(f"Found {len(shared_identifiers)} identifiers shared with other accounts")

    # Remove companies not in CSV or with zero shares
    # Broker-scoped: only remove companies matching the import source
    manual_protected_count = 0
    source_protected_count = 0
    for company_name in companies_to_remove:
        result = _remove_company(
            company_name, existing_company_map, account_id, cursor,
            shared_identifiers, manual_company_ids,
            company_source_map=company_source_map,
            import_source=source
        )
        if result == 'removed':
            positions_removed.append(company_name)
        elif result == 'protected':
            manual_protected_count += 1
        elif result == 'source_protected':
            source_protected_count += 1

    return {
        'added': positions_added,
        'updated': positions_updated,
        'removed': positions_removed,
        'protected_identifiers_count': protected_identifiers_count,
        'manual_protected_count': manual_protected_count
    }


def _update_existing_company(
    company_name: str,
    existing_company_map: Dict,
    position: Dict,
    share_data: Dict,
    override_map: Dict,
    default_portfolio_id: int,
    cursor,
    identifier_edit_map: Dict,
    shares_exist_map: Dict
) -> bool:
    """
    Update an existing company record.

    Returns:
        bool: True if identifier was protected (manually edited), False otherwise
    """
    company_id = existing_company_map[company_name]['id']
    existing_portfolio_id = existing_company_map[company_name]['portfolio_id']

    # Use pre-fetched identifier manual edit data (avoids N+1 query)
    manual_edit_data = identifier_edit_map.get(company_id, {})

    # Determine which identifier to use
    identifier_protected = False
    if manual_edit_data.get('identifier_manually_edited'):
        # Keep the manually edited identifier
        final_identifier = manual_edit_data.get('override_identifier')
        identifier_protected = True
        logger.info(f"Protecting manually edited identifier for {company_name}: {final_identifier}")
    else:
        # Use CSV identifier
        final_identifier = position['identifier']

    # Preserve existing portfolio assignment unless it's None
    final_portfolio_id = existing_portfolio_id if existing_portfolio_id else default_portfolio_id

    # Convert first_bought_date to string if it's a pandas Timestamp
    first_bought = position.get('first_bought_date')
    if first_bought is not None and hasattr(first_bought, 'strftime'):
        first_bought = first_bought.strftime('%Y-%m-%d %H:%M:%S')

    # Update company record (now with protected identifier)
    # Only update first_bought_date if new value is earlier than existing, or existing is NULL
    # This prevents corrupted dates (e.g. import timestamps) from overwriting correct historical dates
    cursor.execute(
        '''UPDATE companies SET identifier = ?, portfolio_id = ?, total_invested = ?,
           first_bought_date = CASE
               WHEN first_bought_date IS NULL THEN ?
               WHEN ? IS NOT NULL AND ? < first_bought_date THEN ?
               ELSE first_bought_date
           END
           WHERE id = ?''',
        [final_identifier, final_portfolio_id, position['total_invested'],
         first_bought, first_bought, first_bought, first_bought, company_id]
    )

    # Get existing override if any
    existing_override = override_map.get(company_id)

    # Use pre-fetched share existence data (avoids N+1 query)
    share_exists = shares_exist_map.get(company_id, False)

    # Update or insert shares based on manual edit status
    if share_data['has_manual_edit']:
        # User has manually edited - handle accordingly
        _update_shares_with_manual_edit(company_id, share_data, cursor, share_exists)
    else:
        # Normal CSV processing - use existing override if any
        _update_shares_normal(
            company_id,
            share_data['csv_shares'],
            existing_override,
            cursor,
            share_exists
        )

    return identifier_protected


def _update_shares_with_manual_edit(company_id: int, share_data: Dict, cursor, share_exists: bool) -> None:
    """Update shares for a manually edited company."""
    if share_data['csv_modified_after_edit']:
        # CSV has newer transactions - update both CSV and override shares
        if share_exists:
            cursor.execute(
                '''UPDATE company_shares
                   SET shares = ?, override_share = ?, csv_modified_after_edit = 1
                   WHERE company_id = ?''',
                [share_data['csv_shares'], share_data['override_shares'], company_id]
            )
        else:
            cursor.execute(
                '''INSERT INTO company_shares
                   (company_id, shares, override_share, is_manually_edited, csv_modified_after_edit, manual_edit_date)
                   VALUES (?, ?, ?, 1, 1, CURRENT_TIMESTAMP)''',
                [company_id, share_data['csv_shares'], share_data['override_shares']]
            )
    else:
        # No newer transactions - update CSV shares but keep override as is
        if share_exists:
            cursor.execute(
                'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                [share_data['csv_shares'], share_data['override_shares'], company_id]
            )
        else:
            cursor.execute(
                '''INSERT INTO company_shares
                   (company_id, shares, override_share, is_manually_edited, manual_edit_date)
                   VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)''',
                [company_id, share_data['csv_shares'], share_data['override_shares']]
            )


def _update_shares_normal(company_id: int, csv_shares: float, existing_override: float, cursor, share_exists: bool) -> None:
    """Update shares for a non-manually-edited company."""
    if share_exists:
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
    cursor,
    source: str = 'parqet'
) -> None:
    """Insert a new company record."""
    # Convert first_bought_date to string if it's a pandas Timestamp
    first_bought = position.get('first_bought_date')
    if first_bought is not None and hasattr(first_bought, 'strftime'):
        first_bought = first_bought.strftime('%Y-%m-%d %H:%M:%S')

    # Get investment_type from position data (e.g., IBKR provides this)
    investment_type = position.get('investment_type')

    cursor.execute(
        '''INSERT INTO companies
           (name, identifier, sector, portfolio_id, account_id, total_invested, first_bought_date, source, investment_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        [company_name, position['identifier'], '', default_portfolio_id,
         account_id, position['total_invested'], first_bought, source, investment_type]
    )
    company_id = cursor.lastrowid

    cursor.execute(
        'INSERT INTO company_shares (company_id, shares) VALUES (?, ?)',
        [company_id, current_shares]
    )

    logger.info(f"Added new company: {company_name} with {current_shares} shares (source={source})")


def _remove_company(
    company_name: str,
    existing_company_map: Dict,
    account_id: int,
    cursor,
    shared_identifiers: Set[str] = None,
    manual_company_ids: Set[int] = None,
    company_source_map: Dict[int, str] = None,
    import_source: str = None
) -> str:
    """
    Remove a company and clean up related records.

    Supports broker-scoped deletion: only removes companies matching the import source.

    Args:
        company_name: Name of company to remove
        existing_company_map: Map of company names to their DB records
        account_id: Current account ID
        cursor: Database cursor
        shared_identifiers: Pre-computed set of identifiers used by other accounts
        manual_company_ids: Pre-computed set of company IDs that were manually added
        company_source_map: Pre-computed map of company_id -> source
        import_source: Current import source ('parqet' or 'ibkr') for scoped deletion

    Returns:
        'removed' if company was removed successfully
        'protected' if company was protected (manual source)
        'source_protected' if company belongs to a different broker
        'not_found' if company was not found
    """
    if company_name not in existing_company_map:
        logger.warning(
            f"Cannot remove company '{company_name}' - not found in existing_company_map. "
            f"Available companies: {list(existing_company_map.keys())}"
        )
        return 'not_found'

    company_id = existing_company_map[company_name]['id']
    identifier = existing_company_map[company_name]['identifier']

    # Protect manually-added companies from removal during CSV import
    if manual_company_ids and company_id in manual_company_ids:
        logger.info(f"Protecting manual company '{company_name}' (ID: {company_id}) from CSV removal")
        return 'protected'

    # Broker-scoped deletion: only remove companies from the same source
    if import_source and company_source_map:
        company_source = company_source_map.get(company_id)
        if company_source and company_source != import_source:
            logger.info(
                f"Protecting '{company_name}' (source={company_source}) from "
                f"{import_source} import removal"
            )
            return 'source_protected'

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
    # Use pre-computed shared_identifiers set (avoids N+1 queries)
    if identifier and shared_identifiers is not None:
        if identifier not in shared_identifiers:
            logger.info(f"No other accounts use {identifier}, removing from market_prices")
            cursor.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])
    elif identifier:
        # Fallback to query if shared_identifiers not provided (backwards compatibility)
        other_companies_count = query_db(
            'SELECT COUNT(*) as count FROM companies WHERE identifier = ? AND account_id != ?',
            [identifier, account_id],
            one=True
        )
        if other_companies_count and other_companies_count['count'] == 0:
            logger.info(f"No other accounts use {identifier}, removing from market_prices")
            cursor.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])

    return 'removed'
