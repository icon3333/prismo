"""Company/portfolio write API — single + batch company updates, portfolio management."""

from flask import request, jsonify, g
from app.db_manager import query_db, execute_db, get_db, backup_database
from app.decorators import require_auth
from app.utils.db_utils import update_price_in_db
from app.utils.yfinance_utils import get_isin_data
from app.utils.response_helpers import success_response, error_response, validation_error_response
from app.exceptions import ValidationError, DataIntegrityError
from app.utils.identifier_mapping import store_identifier_mapping
from app.utils.identifier_normalization import normalize_identifier
from app.utils.text_normalization import normalize_sector, normalize_country, normalize_thesis, normalize_portfolio
from app.routes.portfolio_data_api import invalidate_portfolio_cache

import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

def _apply_company_update(cursor, company_id, data, account_id):
    """
    Internal helper to update company and share data.

    Security: Only whitelisted fields are processed to prevent SQL injection.
    """
    # Whitelist of allowed fields that can be updated via this function
    ALLOWED_FIELDS = {
        'identifier', 'name', 'sector', 'thesis', 'portfolio', 'investment_type',
        'custom_total_value', 'custom_price_eur', 'is_custom_value_edit',
        'country', 'reset_country', 'is_country_user_edit', 'reset_identifier',
        'is_identifier_user_edit',
        'shares', 'override_share', 'is_user_edit',
        'reset_shares', 'reset_custom_value'
    }

    # Validate that all keys in data are whitelisted
    for key in data.keys():
        if key not in ALLOWED_FIELDS:
            logger.warning(f"Ignoring non-whitelisted field '{key}' in company update")

    # Normalize text fields before processing
    if 'sector' in data:
        data['sector'] = normalize_sector(data.get('sector'))
    if 'thesis' in data:
        data['thesis'] = normalize_thesis(data.get('thesis'))

    # Resolve the target portfolio on the caller's cursor so the whole update
    # stays in one transaction (PortfolioRepository.get_or_create_portfolio
    # commits internally, which would break atomicity here).
    # No portfolio specified -> '-' default, consistent with CSV processing.
    portfolio_name = normalize_portfolio(data.get('portfolio'))
    if not portfolio_name or portfolio_name == 'None':
        portfolio_name = '-'
    portfolio = query_db(
        'SELECT id FROM portfolios WHERE name = ? AND account_id = ?',
        [portfolio_name, account_id],
        one=True
    )
    if portfolio:
        portfolio_id = portfolio['id']
    else:
        cursor.execute(
            'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
            [portfolio_name, account_id]
        )
        portfolio_id = cursor.lastrowid
        logger.info(f"Created portfolio '{portfolio_name}' for account_id: {account_id}")

    # Check if identifier is being changed to trigger price update and mapping storage
    identifier_changed = False
    new_identifier = None
    current_company_data = None
    
    if 'identifier' in data:
        new_identifier = data.get('identifier', '').strip()
        if new_identifier:  # Only if not empty
            # Get current company data including name for mapping
            current_company_data = query_db(
                'SELECT identifier, name FROM companies WHERE id = ? AND account_id = ?',
                [company_id, account_id], one=True
            )
            if current_company_data:
                if isinstance(current_company_data, dict):
                    current_identifier = current_company_data.get('identifier')
                    current_company_name = current_company_data.get('name')
                else:
                    current_identifier = None
                    current_company_name = None
            else:
                current_identifier = None
                current_company_name = None
            identifier_changed = (new_identifier != current_identifier)

    # Build the SET clause safely using whitelisted columns
    # This prevents SQL injection by explicitly mapping user input keys to known safe column names
    ALLOWED_UPDATES = {
        'identifier': 'identifier = ?',
        'name': 'name = ?',
        'sector': 'sector = ?',
        'thesis': 'thesis = ?',
        'portfolio': 'portfolio_id = ?',
    }

    set_clause_parts = []
    params = []

    # Handle simple field updates using whitelist
    for field_key, sql_fragment in ALLOWED_UPDATES.items():
        if field_key in data:
            if field_key == 'portfolio':
                # Special case: portfolio maps to portfolio_id
                set_clause_parts.append(sql_fragment)
                params.append(portfolio_id)
            elif field_key == 'identifier':
                # Check if this is a user edit (not CSV import)
                is_user_edit = data.get('is_identifier_user_edit', False)

                set_clause_parts.append(sql_fragment)
                params.append(data.get(field_key, ''))

                # If user is manually editing, set tracking fields
                if is_user_edit:
                    set_clause_parts.append('override_identifier = ?')
                    params.append(data.get(field_key, ''))
                    set_clause_parts.append('identifier_manually_edited = ?')
                    params.append(1)
                    set_clause_parts.append('identifier_manual_edit_date = CURRENT_TIMESTAMP')
                    logger.info(f"Marking identifier as manually edited for company {company_id}")
            else:
                set_clause_parts.append(sql_fragment)
                params.append(data.get(field_key, ''))

    # Handle investment_type with validation
    if 'investment_type' in data:
        investment_type = data.get('investment_type')
        # Validate investment_type value - allow Stock, ETF, or NULL
        if investment_type in ('Stock', 'ETF', 'Crypto'):
            set_clause_parts.append('investment_type = ?')
            params.append(investment_type)
        elif investment_type is None or investment_type == '':
            # Allow clearing investment_type (no param needed for NULL)
            set_clause_parts.append('investment_type = NULL')

    # Handle custom total value when no price is available
    if 'custom_total_value' in data or 'custom_price_eur' in data:
        custom_total_value = data.get('custom_total_value')
        custom_price = data.get('custom_price_eur')
        is_custom_edit = data.get('is_custom_value_edit', False)

        if is_custom_edit:
            # User is manually entering a custom total value (when no market price exists)
            set_clause_parts.append('custom_total_value = ?')
            params.append(custom_total_value)
            set_clause_parts.append('custom_price_eur = ?')
            params.append(custom_price)
            set_clause_parts.append('is_custom_value = ?')
            params.append(1)
            # CURRENT_TIMESTAMP is a SQLite keyword, not a user value, so it's safe
            set_clause_parts.append('custom_value_date = CURRENT_TIMESTAMP')
            logger.info(f"User set custom total value {custom_total_value} (price: {custom_price}) for company {company_id}")

    # Execute UPDATE if there are changes
    if set_clause_parts:
        # Build query with parameterized WHERE clause
        set_clause = ', '.join(set_clause_parts)
        query = f'UPDATE companies SET {set_clause} WHERE id = ?'
        params.append(company_id)

        # Log for debugging (safe because set_clause is built from whitelisted parts)
        logger.debug(f"Executing UPDATE: {query} with params: {params}")
        cursor.execute(query, params)

    # If identifier was changed, store mapping and fetch price
    if identifier_changed and new_identifier and current_company_data:
        current_identifier = current_company_data.get('identifier') if isinstance(current_company_data, dict) else None
        current_company_name = current_company_data.get('name') if isinstance(current_company_data, dict) else None
        
        logger.info(f"Identifier changed for company {company_id} to '{new_identifier}', storing mapping and fetching price...")
        
        # NEW: Try to detect and store identifier mapping
        if current_identifier and current_company_name:
            # Try to reverse-engineer what the original CSV identifier might have been
            # This is a best-effort approach for creating mappings
            possible_csv_identifier = None
            
            # Check if current identifier looks like a normalized crypto identifier
            if current_identifier.endswith('-USD'):
                # Likely came from a crypto symbol like "BTC" -> "BTC-USD"
                possible_csv_identifier = current_identifier.replace('-USD', '')
            elif current_identifier.upper() == current_identifier and len(current_identifier) <= 10:
                # Likely a stock ticker that wasn't changed during normalization
                possible_csv_identifier = current_identifier
            
            if possible_csv_identifier:
                # Store the mapping from the probable CSV identifier to the user's preferred identifier
                success = store_identifier_mapping(
                    account_id=account_id,
                    csv_identifier=possible_csv_identifier,
                    preferred_identifier=new_identifier,
                    company_name=current_company_name
                )
                
                if success:
                    logger.info(f"Stored identifier mapping: {possible_csv_identifier} -> {new_identifier} for {current_company_name}")
                else:
                    logger.warning(f"Failed to store identifier mapping for {current_company_name}")
        
        try:
            # Clean up identifier (trim, uppercase) - no format conversion
            cleaned_identifier = normalize_identifier(new_identifier)

            logger.info(f"Cleaned identifier: '{new_identifier}' -> '{cleaned_identifier}'")
            logger.info(f"Fetching price with two-step cascade...")

            # Fetch price data from yfinance with cascade
            # Cascade will try original, then crypto format if needed
            price_data = get_isin_data(cleaned_identifier)
            if price_data.get('success'):
                # Extract nested data dictionary (matches pattern from batch_processing.py)
                data = price_data.get('data', {})
                price = data.get('currentPrice')
                currency = data.get('currency', 'EUR')
                price_eur = data.get('priceEUR')
                country = data.get('country')
                modified_identifier = price_data.get('modified_identifier')

                # Ensure required parameters are not None
                if price is not None and currency is not None and price_eur is not None:
                    # update_price_in_db will update identifier if cascade found different format
                    # e.g., BTC → BTC-USD
                    update_price_in_db(
                        identifier=cleaned_identifier,
                        price=float(price),
                        currency=str(currency),
                        price_eur=float(price_eur),
                        country=country,
                        modified_identifier=modified_identifier
                    )
                    logger.info(f"Successfully updated price for '{cleaned_identifier}': {price_eur} EUR")
                else:
                    logger.warning(f"Missing required price data for '{cleaned_identifier}'")
            else:
                logger.warning(f"Failed to fetch price for '{cleaned_identifier}': {price_data.get('error', 'Unknown error')}")
        except Exception as e:
            logger.error(f"Error fetching price for '{cleaned_identifier}': {str(e)}")

    # Handle identifier reset
    if data.get('reset_identifier', False):
        # Reset identifier to original state - clear manual edit flags
        cursor.execute('''
            UPDATE companies
            SET identifier_manually_edited = 0,
                override_identifier = NULL,
                identifier_manual_edit_date = NULL
            WHERE id = ?
        ''', [company_id])
        logger.info(f"Reset identifier manual edit for company {company_id}")

    # Handle country updates
    if 'country' in data or 'reset_country' in data:
        if data.get('reset_country', False):
            # Reset country to yfinance data
            cursor.execute('''
                UPDATE companies
                SET override_country = NULL,
                    country_manually_edited = 0,
                    country_manual_edit_date = NULL
                WHERE id = ?
            ''', [company_id])
            logger.info(f"Reset country override for company {company_id}")
        elif 'country' in data:
            country = normalize_country(data.get('country'))
            is_user_edit = data.get('is_country_user_edit', False)
            
            if is_user_edit:
                cursor.execute('''
                    UPDATE companies 
                    SET override_country = ?, 
                        country_manual_edit_date = CURRENT_TIMESTAMP,
                        country_manually_edited = 1
                    WHERE id = ?
                ''', [country, company_id])
                logger.info(f"User updated country to '{country}' for company {company_id}")

    if 'shares' in data or 'override_share' in data:
        shares = data.get('shares')
        override = data.get('override_share')
        is_user_edit = data.get('is_user_edit', False)  # Flag to indicate user vs system edit
        
        exists = query_db(
            'SELECT company_id, shares, override_share, is_manually_edited FROM company_shares WHERE company_id = ?',
            [company_id], one=True)
        
        if exists:
            if is_user_edit and 'override_share' in data:
                # User is manually editing shares - store in override_share column
                cursor.execute('''
                    UPDATE company_shares 
                    SET override_share = ?, 
                        manual_edit_date = CURRENT_TIMESTAMP, 
                        is_manually_edited = 1,
                        csv_modified_after_edit = 0
                    WHERE company_id = ?
                ''', [override, company_id])
            else:
                # System update (e.g., CSV import) - update shares, preserve override_share if it exists
                current_override = exists.get('override_share') if exists.get('is_manually_edited') else None
                cursor.execute(
                    'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                    [shares, current_override or override, company_id]
                )
        else:
            if is_user_edit and 'override_share' in data:
                # New entry with user edit - set override_share
                cursor.execute('''
                    INSERT INTO company_shares 
                    (company_id, shares, override_share, manual_edit_date, is_manually_edited, csv_modified_after_edit) 
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, 0)
                ''', [company_id, shares or 0, override])
            else:
                # New entry from system
                cursor.execute(
                    'INSERT INTO company_shares (company_id, shares, override_share) VALUES (?, ?, ?)',
                    [company_id, shares, override]
                )

    # Handle shares reset
    if data.get('reset_shares', False):
        cursor.execute('''
            UPDATE company_shares
            SET override_share = NULL,
                is_manually_edited = 0,
                manual_edit_date = NULL,
                csv_modified_after_edit = 0
            WHERE company_id = ?
        ''', [company_id])
        logger.info(f"Reset shares override for company {company_id}")

    # Handle custom value reset
    if data.get('reset_custom_value', False):
        cursor.execute('''
            UPDATE companies
            SET custom_total_value = NULL,
                custom_price_eur = NULL,
                is_custom_value = 0,
                custom_value_date = NULL
            WHERE id = ?
        ''', [company_id])
        logger.info(f"Reset custom value for company {company_id}")


def _validate_batch_updates(updates: List[Dict], account_id: int) -> tuple:
    """
    Validate batch updates before applying to database.

    Returns:
        tuple: (is_valid: bool, error_message: Optional[str], validation_data: Optional[Dict])
        If valid: (True, None, {'company_map': {...}, 'portfolio_map': {...}, ...})
        If invalid: (False, error_message, None)
    """
    # Validate data format
    if not updates or not isinstance(updates, list):
        return (False, 'Invalid data format: expected non-empty list', None)

    # Preload existing data for validation
    company_rows = query_db(
        'SELECT id, name, identifier FROM companies WHERE account_id = ?',
        [account_id]
    )
    company_map = {}
    if company_rows:
        company_map = {row['name']: row for row in company_rows if isinstance(row, dict)}

    portfolio_rows = query_db(
        'SELECT id, name FROM portfolios WHERE account_id = ?',
        [account_id]
    )
    portfolio_map = {}
    if portfolio_rows:
        portfolio_map = {row['name']: row['id'] for row in portfolio_rows if isinstance(row, dict)}

    share_rows = query_db(
        '''SELECT cs.company_id FROM company_shares cs
           JOIN companies c ON cs.company_id = c.id
           WHERE c.account_id = ?''',
        [account_id]
    )
    shares_set = set()
    if share_rows:
        shares_set = {row['company_id'] for row in share_rows if isinstance(row, dict)}

    # Validate each update item
    validation_errors = []
    for idx, item in enumerate(updates):
        # Check required fields
        if 'company' not in item:
            validation_errors.append({
                'index': idx,
                'error': 'Missing required field: company'
            })
            continue

        company_name = item['company']

        # Verify company exists
        if company_name not in company_map:
            validation_errors.append({
                'index': idx,
                'company': company_name,
                'error': 'Company not found'
            })
            continue

        # Validate data types if shares provided
        if 'shares' in item:
            try:
                shares_val = item['shares']
                if shares_val is not None:
                    shares_float = float(shares_val)
                    if shares_float < 0:
                        validation_errors.append({
                            'index': idx,
                            'company': company_name,
                            'error': f'Shares cannot be negative: {shares_val}'
                        })
            except (ValueError, TypeError):
                validation_errors.append({
                    'index': idx,
                    'company': company_name,
                    'error': f'Invalid shares value: {item["shares"]}'
                })

        if 'override_share' in item:
            try:
                override_val = item['override_share']
                if override_val is not None:
                    override_float = float(override_val)
                    if override_float < 0:
                        validation_errors.append({
                            'index': idx,
                            'company': company_name,
                            'error': f'Override shares cannot be negative: {override_val}'
                        })
            except (ValueError, TypeError):
                validation_errors.append({
                    'index': idx,
                    'company': company_name,
                    'error': f'Invalid override_share value: {item["override_share"]}'
                })

    # Return validation results
    if validation_errors:
        return (False, f'Validation failed for {len(validation_errors)} items', {
            'errors': validation_errors
        })

    return (True, None, {
        'company_map': company_map,
        'portfolio_map': portfolio_map,
        'shares_set': shares_set
    })


@require_auth
def update_portfolio_api():
    """
    API endpoint to update portfolio data in batch.

    Uses two-phase approach:
    1. Validation Phase: Validate ALL updates before touching database
    2. Transaction Phase: Apply all changes in single atomic transaction
    """
    try:
        account_id = g.account_id
        data = request.json

        # Validate input data
        if not data:
            raise ValidationError('No update data provided')

        # PHASE 1: VALIDATION
        # Validate all updates before starting any database operations
        try:
            is_valid, error_msg, validation_data = _validate_batch_updates(data, account_id)
        except Exception as e:
            logger.error(f"Error during validation: {e}")
            raise ValidationError(f'Validation failed: {str(e)}')

        if not is_valid:
            logger.warning(f"Batch update validation failed: {error_msg}")
            return validation_error_response('batch_update', error_msg)

        # Extract validated data
        company_map = validation_data['company_map']
        portfolio_map = validation_data['portfolio_map']
        shares_set = validation_data['shares_set']

        logger.info(f"Validation passed for {len(data)} updates")

        # PHASE 2: TRANSACTION
        # Create backup before any changes
        try:
            backup_database()
        except Exception as e:
            logger.error(f"Failed to create database backup: {e}")
            raise DataIntegrityError('Failed to create database backup before update')

        # Apply all changes in single atomic transaction
        db = get_db()
        cursor = db.cursor()

        try:
            cursor.execute('BEGIN TRANSACTION')

            updated_count = 0

            for item in data:
                company_result = company_map[item['company']]
                company_id = company_result['id']
                original_identifier = company_result.get('identifier')
                new_identifier = item.get('identifier', '')

                # Handle portfolio assignment
                portfolio_name = normalize_portfolio(item.get('portfolio'))
                if portfolio_name and portfolio_name != 'None':
                    portfolio_id = portfolio_map.get(portfolio_name)
                    if portfolio_id is None:
                        cursor.execute(
                            'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                            [portfolio_name, account_id]
                        )
                        portfolio_id = cursor.lastrowid
                        portfolio_map[portfolio_name] = portfolio_id
                else:
                    portfolio_id = portfolio_map.get('-')
                    if portfolio_id is None:
                        cursor.execute(
                            'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                            ['-', account_id]
                        )
                        portfolio_id = cursor.lastrowid
                        portfolio_map['-'] = portfolio_id

                # Update company
                # Build dynamic UPDATE based on which fields are provided
                update_fields = []
                update_values = []

                # Always update these fields
                update_fields.append('identifier = ?')
                update_values.append(new_identifier)
                update_fields.append('sector = ?')
                update_values.append(normalize_sector(item.get('sector', '')))
                update_fields.append('portfolio_id = ?')
                update_values.append(portfolio_id)

                # Conditionally update investment_type if provided
                if 'investment_type' in item:
                    investment_type = item.get('investment_type')
                    # Validate investment_type value
                    if investment_type and investment_type in ('Stock', 'ETF', 'Crypto'):
                        update_fields.append('investment_type = ?')
                        update_values.append(investment_type)
                    elif investment_type is None or investment_type == '':
                        # Allow clearing investment_type
                        update_fields.append('investment_type = NULL')
                    else:
                        # Reject invalid investment_type values
                        logger.warning(f"Invalid investment_type value: {investment_type}")
                        return error_response(
                            f"Invalid investment_type: '{investment_type}'. Must be 'Stock', 'ETF', 'Crypto', or empty.",
                            status=400
                        )

                # Add company_id for WHERE clause
                update_values.append(company_id)

                cursor.execute(f'''
                    UPDATE companies
                    SET {', '.join(update_fields)}
                    WHERE id = ?
                ''', update_values)

                # Handle identifier changes (cleanup and fetch price with cascade)
                if new_identifier and new_identifier != original_identifier:

                    # Clean up identifier (trim whitespace, uppercase)
                    # No format conversion - cascade at fetch time handles stock vs crypto
                    cleaned_identifier = normalize_identifier(new_identifier)

                    logger.info(f"Identifier changed for {item['company']}: '{original_identifier}' → '{cleaned_identifier}'")
                    logger.info(f"Fetching price with two-step cascade...")

                    try:
                        # Cascade in get_isin_data will:
                        # 1. Try cleaned_identifier (e.g., "TNK")
                        # 2. If fails, try cleaned_identifier + "-USD" (e.g., "TNK-USD")
                        # 3. Return modified_identifier if different format worked
                        price_data = get_isin_data(cleaned_identifier)
                        if price_data.get('success'):
                            # Extract nested data dictionary (matches pattern from batch_processing.py)
                            data = price_data.get('data', {})
                            price = data.get('currentPrice')
                            currency = data.get('currency', 'EUR')
                            price_eur = data.get('priceEUR')
                            country = data.get('country')
                            modified_identifier = price_data.get('modified_identifier')

                            if price is not None and currency is not None and price_eur is not None:
                                # update_price_in_db will update identifier if modified_identifier differs
                                # e.g., if cascade found BTC-USD works better than BTC
                                update_price_in_db(
                                    identifier=cleaned_identifier,
                                    price=float(price),
                                    currency=str(currency),
                                    price_eur=float(price_eur),
                                    country=country,
                                    modified_identifier=modified_identifier
                                )
                                logger.info(f"Successfully updated price for {cleaned_identifier}")
                            else:
                                logger.warning(f"Missing required price data for {cleaned_identifier}")
                        else:
                            logger.warning(f"Failed to fetch price for {cleaned_identifier}: {price_data.get('error', 'Unknown error')}")
                    except Exception as e:
                        # Log but don't fail transaction for price fetch errors
                        logger.error(f"Error fetching price for {cleaned_identifier}: {str(e)}")

                # Update shares
                if 'shares' in item or 'override_share' in item:
                    shares = item.get('shares')
                    override_share = item.get('override_share')
                    is_user_edit = item.get('is_user_edit', False)

                    if company_id in shares_set:
                        if is_user_edit:
                            cursor.execute('''
                                UPDATE company_shares
                                SET override_share = ?,
                                    manual_edit_date = CURRENT_TIMESTAMP,
                                    is_manually_edited = 1,
                                    csv_modified_after_edit = 0
                                WHERE company_id = ?
                            ''', [override_share, company_id])
                        else:
                            cursor.execute('''
                                UPDATE company_shares
                                SET shares = ?, override_share = ?
                                WHERE company_id = ?
                            ''', [shares, override_share, company_id])
                    else:
                        if is_user_edit:
                            cursor.execute('''
                                INSERT INTO company_shares
                                (company_id, shares, override_share, manual_edit_date, is_manually_edited, csv_modified_after_edit)
                                VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, 0)
                            ''', [company_id, shares or 0, override_share])
                        else:
                            cursor.execute('''
                                INSERT INTO company_shares (company_id, shares, override_share)
                                VALUES (?, ?, ?)
                            ''', [company_id, shares, override_share])
                        shares_set.add(company_id)

                updated_count += 1

            # Commit transaction if all updates successful
            db.commit()

            # Invalidate cache after portfolio data modifications
            invalidate_portfolio_cache(account_id)

            logger.info(f"Successfully committed {updated_count} updates")
            return success_response(message=f'Successfully updated {updated_count} items')

        except Exception as e:
            # Rollback on any error during transaction
            db.rollback()
            logger.error(f"Transaction failed, rolled back: {str(e)}")
            raise DataIntegrityError(f'Transaction failed: {str(e)}')

    except ValidationError as e:
        logger.error(f"Validation error in batch update: {e}")
        return error_response(str(e), status=400)

    except DataIntegrityError as e:
        logger.error(f"Data integrity error in batch update: {e}")
        return error_response(str(e), status=409)

    except Exception as e:
        logger.exception("Unexpected error in batch update")
        return error_response('Internal server error', status=500)


@require_auth
def manage_portfolios():
    """Add, rename, or delete portfolios. Returns JSON."""
    account_id = g.account_id
    action = request.form.get('action')

    def _get_portfolio_names():
        """Get current portfolio names for the account."""
        rows = query_db(
            'SELECT name FROM portfolios WHERE account_id = ? ORDER BY name',
            [account_id]
        )
        return [r['name'] if isinstance(r, dict) else r[0] for r in rows] if rows else []

    try:
        # Create backup
        backup_database()

        if action == 'add':
            portfolio_name = normalize_portfolio(request.form.get('add_portfolio_name', ''))
            if not portfolio_name:
                return jsonify({'success': False, 'message': 'Portfolio name cannot be empty'}), 400

            existing = query_db(
                'SELECT 1 FROM portfolios WHERE name = ? AND account_id = ?',
                [portfolio_name, account_id],
                one=True
            )
            if existing:
                return jsonify({'success': False, 'message': f'Portfolio "{portfolio_name}" already exists'}), 400

            execute_db(
                'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                [portfolio_name, account_id]
            )
            invalidate_portfolio_cache(account_id)
            return jsonify({'success': True, 'message': f'Portfolio "{portfolio_name}" added successfully', 'portfolios': _get_portfolio_names()})

        elif action == 'rename':
            old_name = normalize_portfolio(request.form.get('old_name', ''))
            new_name = normalize_portfolio(request.form.get('new_name', ''))

            if not old_name or not new_name:
                return jsonify({'success': False, 'message': 'Both old and new portfolio names are required'}), 400

            existing = query_db(
                'SELECT 1 FROM portfolios WHERE name = ? AND account_id = ?',
                [new_name, account_id],
                one=True
            )
            if existing:
                return jsonify({'success': False, 'message': f'Portfolio "{new_name}" already exists'}), 400

            execute_db(
                'UPDATE portfolios SET name = ? WHERE name = ? AND account_id = ?',
                [new_name, old_name, account_id]
            )
            invalidate_portfolio_cache(account_id)
            return jsonify({'success': True, 'message': f'Portfolio renamed from "{old_name}" to "{new_name}"', 'portfolios': _get_portfolio_names()})

        elif action == 'delete':
            portfolio_name = request.form.get('delete_portfolio_name', '').strip()

            if not portfolio_name:
                return jsonify({'success': False, 'message': 'Portfolio name is required'}), 400

            companies = query_db('''
                SELECT COUNT(*) as count FROM companies c
                JOIN portfolios p ON c.portfolio_id = p.id
                WHERE p.name = ? AND p.account_id = ?
            ''', [portfolio_name, account_id], one=True)

            if companies and isinstance(companies, dict) and companies.get('count', 0) > 0:
                return jsonify({'success': False, 'message': f'Cannot delete portfolio "{portfolio_name}" because it contains companies'}), 400

            execute_db(
                'DELETE FROM portfolios WHERE name = ? AND account_id = ?',
                [portfolio_name, account_id]
            )
            invalidate_portfolio_cache(account_id)
            return jsonify({'success': True, 'message': f'Portfolio "{portfolio_name}" deleted successfully', 'portfolios': _get_portfolio_names()})

    except (DataIntegrityError, ValidationError) as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        logger.exception("Unexpected error managing portfolios")
        return jsonify({'success': False, 'message': 'An unexpected error occurred'}), 500

    invalidate_portfolio_cache(account_id)
    return jsonify({'success': False, 'message': 'Invalid action'}), 400


