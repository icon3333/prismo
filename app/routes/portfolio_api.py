from flask import (
    request, flash, session, jsonify, redirect, url_for, Response, g
)
from app.db_manager import query_db, execute_db, backup_database, get_db
from app.decorators import require_auth
from app.utils.db_utils import (
    load_portfolio_data, process_portfolio_dataframe, update_price_in_db, update_batch_prices_in_db
)
from app.utils.yfinance_utils import get_isin_data, get_yfinance_info
from app.utils.batch_processing import start_batch_process, get_job_status, start_csv_processing_job, cancel_background_job
from app.utils.portfolio_utils import (
    get_portfolio_data, process_csv_data, has_companies_in_default, get_stock_info
)
from app.utils.response_helpers import success_response, error_response, not_found_response, validation_error_response, service_unavailable_response
from app.exceptions import (
    ValidationError, DataIntegrityError, ExternalAPIError, NotFoundError,
    CSVProcessingError, PriceFetchError
)
from app.utils.value_calculator import calculate_portfolio_total, calculate_item_value, has_price_or_custom_value
from app.utils.identifier_mapping import store_identifier_mapping
from app.utils.identifier_normalization import normalize_identifier
from app.services.allocation_service import AllocationService
from app.cache import cache


import logging
from datetime import datetime
import time
import uuid
import json
import io
from typing import Dict, Any, Optional, List

# Set up logger
logger = logging.getLogger(__name__)


def _apply_company_update(cursor, company_id, data, account_id):
    """
    Internal helper to update company and share data.

    Security: Only whitelisted fields are processed to prevent SQL injection.
    """
    # Whitelist of allowed fields that can be updated via this function
    ALLOWED_FIELDS = {
        'identifier', 'category', 'portfolio', 'investment_type',
        'custom_total_value', 'custom_price_eur', 'is_custom_value_edit',
        'country', 'reset_country', 'is_country_user_edit', 'reset_identifier',
        'is_identifier_user_edit',
        'shares', 'override_share', 'is_user_edit'
    }

    # Validate that all keys in data are whitelisted
    for key in data.keys():
        if key not in ALLOWED_FIELDS:
            logger.warning(f"Ignoring non-whitelisted field '{key}' in company update")

    portfolio_name = data.get('portfolio')
    if portfolio_name and portfolio_name != 'None':
        portfolio = query_db(
            'SELECT id FROM portfolios WHERE name = ? AND account_id = ?',
            [portfolio_name, account_id],
            one=True
        )
        if not portfolio:
            cursor.execute(
                'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                [portfolio_name, account_id]
            )
            portfolio_id = cursor.lastrowid
        else:
            portfolio_id = portfolio['id'] if isinstance(portfolio, dict) else None
    else:
        # Assign to '-' portfolio if no portfolio is specified (consistent with CSV processing)
        default_portfolio = query_db(
            'SELECT id FROM portfolios WHERE name = ? AND account_id = ?',
            ['-', account_id], one=True)

        if not default_portfolio:
            # Create '-' portfolio if it doesn't exist
            cursor.execute(
                'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                ['-', account_id]
            )
            portfolio_id = cursor.lastrowid
            logger.info(
                f"Created '-' portfolio for account_id: {account_id}")
        else:
            portfolio_id = default_portfolio['id'] if isinstance(default_portfolio, dict) else None

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
        'category': 'category = ?',
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
        if investment_type in ('Stock', 'ETF'):
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
            country = data.get('country')
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

# API endpoint to get and save state data

@require_auth
def manage_state():
    """Get or save state data"""
    account_id = g.account_id

    # GET request to retrieve state
    if request.method == 'GET':
        page_name = request.args.get('page', '')

        if not page_name:
            return error_response('Page name is required', 400)

        try:
            # Get all state variables for this account and page
            state_vars = query_db('''
                SELECT variable_name, variable_type, variable_value
                FROM expanded_state
                WHERE account_id = ? AND page_name = ?
            ''', [account_id, page_name])

            if not state_vars:
                return jsonify({})

            # Convert to proper data structure
            state_data = {}
            for var in state_vars:
                if isinstance(var, dict):
                    var_name = var['variable_name']
                    var_value = var['variable_value']

                    # Add to state data without conversion (handled by front-end)
                    state_data[var_name] = var_value

            return jsonify(state_data)

        except (DataIntegrityError, ValidationError) as e:
            logger.error(f"Error retrieving state for page '{page_name}': {str(e)}")
            return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
        except Exception as e:
            logger.exception(f"Unexpected error retrieving state for page '{page_name}'")
            return error_response('Failed to retrieve state', 500)

    # POST request to save state
    elif request.method == 'POST':
        data = request.json

        if not data or 'page' not in data:
            return error_response('Invalid data format', 400)

        page_name = data['page']

        try:
            # Create backup before making changes
            backup_database()

            with get_db() as db:
                cursor = db.cursor()

                # Start transaction
                cursor.execute('BEGIN TRANSACTION')

                # Delete existing state for this page (to avoid orphaned variables)
                cursor.execute('''
                DELETE FROM expanded_state
                WHERE account_id = ? AND page_name = ?
            ''', [account_id, page_name])

                # Insert new state variables
                for key, value in data.items():
                    if key == 'page':
                        continue  # Skip the page key

                    # Determine variable type
                    if isinstance(value, str):
                        if value.startswith('{') or value.startswith('['):
                            var_type = 'object'
                        else:
                            var_type = 'string'
                    else:
                        var_type = 'string'

                    # Insert into database
                    cursor.execute('''
                        INSERT INTO expanded_state
                        (account_id, page_name, variable_name, variable_type, variable_value)
                        VALUES (?, ?, ?, ?, ?)
                    ''', [account_id, page_name, key, var_type, value])

                # Commit transaction
                db.commit()

                # Invalidate cache if build page state was modified (affects allocation calculations)
                if page_name == 'build':
                    invalidate_portfolio_cache(account_id)

            logger.info(
                f"State saved successfully for account {account_id}, page {page_name}")
            return success_response(message='State saved successfully')

        except (DataIntegrityError, ValidationError) as e:
            logger.error(f"Error saving state for page '{page_name}': {str(e)}")
            return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
        except Exception as e:
            logger.exception(f"Unexpected error saving state for page '{page_name}'")
            return error_response('Failed to save state', 500)

    return error_response('Method not allowed', 405)

# API endpoint to get companies for a specific portfolio

def invalidate_portfolio_cache(account_id: int) -> None:
    """
    Invalidate the portfolio allocation cache for a specific account.

    Call this function after any operation that modifies portfolio data:
    - CSV upload
    - Price updates
    - Company modifications
    - Portfolio add/rename/delete

    Args:
        account_id: The account ID whose cache should be invalidated
    """
    try:
        cache.delete_memoized(_get_allocate_portfolio_data_internal, account_id)
        logger.debug(f"Cache invalidated for account_id: {account_id}")
    except Exception as e:
        # Cache invalidation failure is not critical - log and continue
        logger.warning(f"Failed to invalidate cache for account_id {account_id}: {e}")


@cache.memoize(timeout=60)
def _get_allocate_portfolio_data_internal(account_id: int) -> Dict[str, Any]:
    """
    Internal function to get structured portfolio data for rebalancing.

    This is a pure function that doesn't depend on Flask request context,
    making it testable and reusable across different contexts.

    Cached for 60 seconds to reduce database load and CPU usage on repeated calls.
    Cache is invalidated via invalidate_portfolio_cache() when portfolio data is modified.

    Args:
        account_id: The account ID to fetch data for

    Returns:
        Dictionary with portfolio allocation data

    Raises:
        ValidationError: If data is invalid
        DataIntegrityError: If database operations fail
    """
    logger.info(f"Getting portfolio data for rebalancing, account_id: {account_id}")

    # OPTIMIZATION: Single query with LEFT JOINs to fetch ALL data at once (60-80% faster)
    # Combines: portfolios + companies + shares + prices + expanded_state
    try:
        combined_data = query_db('''
            SELECT
                p.id AS portfolio_id,
                p.name AS portfolio_name,
                c.category,
                c.name AS company_name,
                c.identifier,
                c.investment_type,
                cs.shares,
                cs.override_share,
                COALESCE(cs.override_share, cs.shares, 0) as effective_shares,
                mp.price_eur,
                c.custom_total_value,
                c.custom_price_eur,
                c.is_custom_value,
                es_portfolios.variable_value AS portfolios_state,
                es_rules.variable_value AS rules_state
            FROM portfolios p
            LEFT JOIN companies c ON c.portfolio_id = p.id AND c.account_id = p.account_id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            LEFT JOIN expanded_state es_portfolios ON
                es_portfolios.account_id = p.account_id AND
                es_portfolios.page_name = 'build' AND
                es_portfolios.variable_name = 'portfolios'
            LEFT JOIN expanded_state es_rules ON
                es_rules.account_id = p.account_id AND
                es_rules.page_name = 'build' AND
                es_rules.variable_name = 'rules'
            WHERE p.account_id = ? AND p.name IS NOT NULL
            ORDER BY p.name, c.category, c.name
        ''', [account_id])
    except Exception as e:
        logger.error(f"Database error fetching combined portfolio data: {e}")
        raise DataIntegrityError('Failed to fetch portfolio data from database')

    if not combined_data:
        logger.warning(f"No data found for account {account_id}")
        return {'portfolios': []}

    # Extract state data from first row (same for all rows due to LEFT JOIN)
    first_row = combined_data[0] if isinstance(combined_data, list) else combined_data
    portfolios_state_json = first_row.get('portfolios_state') if isinstance(first_row, dict) else None
    rules_state_json = first_row.get('rules_state') if isinstance(first_row, dict) else None

    # Parse target allocations
    target_allocations = []
    if portfolios_state_json:
        try:
            target_allocations = json.loads(portfolios_state_json)
            logger.info(f"Found target allocations: {len(target_allocations)} portfolios")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse target allocations: {e}")

    # Use combined_data for company data (compatible with existing code)
    data = combined_data

    # Parse allocation rules (already fetched from combined query)
    rules = {}
    if rules_state_json:
        try:
            rules = json.loads(rules_state_json)
            logger.info(f"Found allocation rules: maxPerStock={rules.get('maxPerStock')}%, maxPerETF={rules.get('maxPerETF')}%")
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse rules JSON: {e}")

    # Use AllocationService to process the data
    try:
        # Step 1: Get portfolio positions with current values
        portfolio_map, portfolio_builder_data = AllocationService.get_portfolio_positions(
            portfolio_data=data or [],
            target_allocations=target_allocations,
            rules=rules
        )

        # Calculate total current value across all portfolios
        total_current_value = sum(pdata['currentValue'] for pdata in portfolio_map.values())
        logger.info(f"Total current value across all portfolios: {total_current_value}")

        # Step 2: Calculate allocation targets with type constraints
        portfolios_with_targets = AllocationService.calculate_allocation_targets_with_type_constraints(
            portfolio_map=portfolio_map,
            portfolio_builder_data=portfolio_builder_data,
            target_allocations=target_allocations,
            total_current_value=total_current_value,
            rules=rules
        )

        # Step 3: Generate rebalancing plan
        result = AllocationService.generate_rebalancing_plan(
            portfolios_with_targets=portfolios_with_targets
        )

        logger.info(f"Returning {len(result['portfolios'])} portfolios")
        return result

    except ImportError as e:
        logger.error(f"Failed to import AllocationService: {e}")
        raise ValidationError('Allocation service unavailable')
    except (ValidationError, DataIntegrityError):
        # Re-raise these so caller can handle them
        raise
    except Exception as e:
        logger.error(f"Error in allocation service: {e}")
        raise ValidationError(f'Failed to calculate allocations: {str(e)}')


@require_auth
def get_allocate_portfolio_data():
    """API endpoint to get structured portfolio data for the rebalancing feature"""
    logger.info("API request for allocate portfolio data")

    try:
        account_id = g.account_id
        result = _get_allocate_portfolio_data_internal(account_id)
        return jsonify(result)

    except ValidationError as e:
        logger.error(f"Validation error in get_allocate_portfolio_data: {e}")
        return error_response(str(e), status=400)

    except DataIntegrityError as e:
        logger.error(f"Data integrity error in get_allocate_portfolio_data: {e}")
        return error_response(str(e), status=409)

    except Exception as e:
        logger.exception("Unexpected error getting portfolio allocation data")
        return error_response('Internal server error', status=500)

# Ensure this function exists to prevent import errors

@require_auth
def get_portfolio_data_api():
    """Get portfolio data from the database"""
    try:
        account_id = g.account_id

        # Log the attempt to fetch data
        logger.info(f"Fetching portfolio data for account_id: {account_id}")

        # Get data from database without triggering any yfinance updates
        portfolio_data = get_portfolio_data(account_id)

        # Detailed logging of result
        if not portfolio_data:
            logger.warning(
                f"No portfolio data found for account_id: {account_id}")
            # Return empty array instead of 404 for no data
            return jsonify([])
        else:
            logger.info(
                f"Successfully retrieved {len(portfolio_data)} portfolio items")

        return jsonify(portfolio_data)
    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting portfolio data for account {account_id}: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting portfolio data for account {account_id}")
        return error_response('Failed to load portfolio data', 500)


@require_auth
def get_single_portfolio_data_api(portfolio_id):
    """
    Get portfolio data for a single portfolio.
    Returns companies, categories, and summary statistics for a specific portfolio.

    This endpoint is used by the Portfolio Analysis page dropdown selector
    to load data on-demand for the selected portfolio.

    Args:
        portfolio_id: Portfolio ID from URL path

    Returns:
        JSON response with:
        - portfolio_id: Portfolio ID
        - portfolio_name: Portfolio name
        - total_value: Sum of all position values
        - num_holdings: Number of companies
        - last_updated: Most recent price update timestamp
        - companies: List of company objects with percentages
        - categories: List of category aggregations

    Errors:
        404: Portfolio not found or doesn't belong to user
        500: Internal server error
    """
    try:
        account_id = g.account_id
        logger.info(f"Fetching data for portfolio {portfolio_id}, account {account_id}")

        # Verify portfolio belongs to account
        portfolio = query_db('''
            SELECT id, name
            FROM portfolios
            WHERE id = ? AND account_id = ?
        ''', [portfolio_id, account_id], one=True)

        if not portfolio:
            logger.warning(f"Portfolio {portfolio_id} not found for account {account_id}")
            return not_found_response(f'Portfolio {portfolio_id} not found')

        # Fetch companies for this portfolio
        # Note: We fetch mp.price (native currency) and mp.currency to allow Python
        # to calculate values using consistent daily exchange rates via calculate_item_value()
        companies = query_db('''
            SELECT
                c.id, c.name, c.identifier, c.category, c.investment_type,
                c.total_invested, mp.country, c.override_country,
                COALESCE(c.override_country, mp.country, 'Unknown') as effective_country,
                cs.shares, cs.override_share,
                COALESCE(cs.override_share, cs.shares, 0) as effective_shares,
                mp.price, mp.price_eur, mp.currency, mp.last_updated,
                c.custom_total_value, c.is_custom_value
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.portfolio_id = ? AND c.account_id = ?
            AND COALESCE(cs.override_share, cs.shares, 0) > 0
        ''', [portfolio_id, account_id])

        if not companies:
            logger.info(f"No companies found for portfolio {portfolio_id}")
            companies = []

        # Calculate current_value for each company using calculate_item_value()
        # This ensures consistent currency conversion using daily exchange rates
        for company in companies:
            company['current_value'] = float(calculate_item_value(company))

        # Sort by current_value descending (was previously done in SQL)
        companies.sort(key=lambda c: c['current_value'], reverse=True)

        # Calculate totals and percentages
        total_value = sum(c['current_value'] for c in companies)

        for company in companies:
            company['percentage'] = (
                (float(company['current_value']) / total_value * 100)
                if total_value > 0 else 0
            )

            # Calculate P&L (Profit & Loss)
            total_invested = float(company.get('total_invested', 0) or 0)
            current_value = float(company.get('current_value', 0) or 0)

            if total_invested > 0:
                pnl_absolute = current_value - total_invested
                pnl_percentage = (pnl_absolute / total_invested) * 100
                company['pnl_absolute'] = pnl_absolute
                company['pnl_percentage'] = pnl_percentage
            else:
                company['pnl_absolute'] = None
                company['pnl_percentage'] = None

        # Group by category
        categories = {}
        for company in companies:
            cat_name = company['category'] or 'Uncategorized'
            if cat_name not in categories:
                categories[cat_name] = {
                    'name': cat_name,
                    'companies': [],
                    'total_value': 0,
                    'total_invested': 0
                }
            categories[cat_name]['companies'].append(company)
            categories[cat_name]['total_value'] += float(company['current_value'])
            categories[cat_name]['total_invested'] += float(company.get('total_invested', 0))

        # Convert to list and calculate percentages
        categories_list = []
        for cat_data in categories.values():
            cat_data['percentage'] = (
                (cat_data['total_value'] / total_value * 100)
                if total_value > 0 else 0
            )

            # Calculate category P&L
            if cat_data['total_invested'] > 0:
                pnl_absolute = cat_data['total_value'] - cat_data['total_invested']
                pnl_percentage = (pnl_absolute / cat_data['total_invested']) * 100
                cat_data['pnl_absolute'] = pnl_absolute
                cat_data['pnl_percentage'] = pnl_percentage
            else:
                cat_data['pnl_absolute'] = None
                cat_data['pnl_percentage'] = None

            cat_data['companies'].sort(key=lambda x: x['current_value'], reverse=True)
            categories_list.append(cat_data)

        categories_list.sort(key=lambda x: x['total_value'], reverse=True)

        # Calculate total portfolio P&L
        total_invested = sum(float(c.get('total_invested', 0)) for c in companies)
        if total_invested > 0:
            portfolio_pnl_absolute = total_value - total_invested
            portfolio_pnl_percentage = (portfolio_pnl_absolute / total_invested) * 100
        else:
            portfolio_pnl_absolute = None
            portfolio_pnl_percentage = None

        # Build response
        response_data = {
            'portfolio_id': portfolio['id'],
            'portfolio_name': portfolio['name'],
            'total_value': total_value,
            'total_invested': total_invested,
            'portfolio_pnl_absolute': portfolio_pnl_absolute,
            'portfolio_pnl_percentage': portfolio_pnl_percentage,
            'num_holdings': len(companies),
            'last_updated': max((c['last_updated'] for c in companies if c['last_updated']), default=None),
            'companies': companies,
            'categories': categories_list
        }

        logger.info(f"Returning {len(companies)} companies in {len(categories_list)} categories for portfolio {portfolio_id}")
        return jsonify(response_data)

    except ValidationError as e:
        logger.error(f"Validation error: {e}")
        return error_response(str(e), status=400)
    except DataIntegrityError as e:
        logger.error(f"Data integrity error: {e}")
        return error_response(str(e), status=409)
    except Exception as e:
        logger.exception(f"Unexpected error getting single portfolio data for portfolio {portfolio_id}")
        return error_response('Internal server error', status=500)


def _get_position_data_by_field(account_id: int, field_sql: str) -> List[Dict[str, Any]]:
    """
    Shared helper to query position data grouped by any field (country, category, etc.)

    Args:
        account_id: User's account ID
        field_sql: SQL expression for the grouping field (e.g., "COALESCE(c.category, 'Uncategorized')")

    Returns:
        List of position data dictionaries with field_value, company details, and values

    Raises:
        ValueError: If field_sql is not in the allowed whitelist
    """
    # SECURITY: Whitelist of allowed SQL expressions to prevent SQL injection
    # Only predefined expressions are allowed - no user input should reach here
    ALLOWED_FIELD_EXPRESSIONS = {
        "COALESCE(c.category, 'Uncategorized')",
        "COALESCE(c.override_country, mp.country, 'Unknown')",
        "c.category",
        "c.override_country",
        "mp.country",
    }

    if field_sql not in ALLOWED_FIELD_EXPRESSIONS:
        logger.error(f"SQL injection attempt blocked: {field_sql}")
        raise ValueError(f"Invalid field_sql expression: {field_sql}")

    return query_db(f'''
        SELECT
            {field_sql} as field_value,
            c.name as company_name,
            p.name as portfolio_name,
            COALESCE(cs.override_share, cs.shares, 0) as shares,
            COALESCE(mp.price_eur, 0) as price,
            CASE
                WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL THEN c.custom_total_value
                ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
            END as position_value
        FROM companies c
        LEFT JOIN company_shares cs ON c.id = cs.company_id
        LEFT JOIN market_prices mp ON c.identifier = mp.identifier
        LEFT JOIN portfolios p ON c.portfolio_id = p.id
        WHERE c.account_id = ?
        AND COALESCE(cs.override_share, cs.shares, 0) > 0
        AND (COALESCE(mp.price_eur, 0) > 0 OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL))
        ORDER BY field_value, position_value DESC
    ''', [account_id])


@require_auth
def get_country_capacity_data():
    """API endpoint to get country investment capacity data for the rebalancing feature"""
    logger.info("API request for country investment capacity data")

    account_id = g.account_id
    logger.info(f"Getting country capacity data for account_id: {account_id}")

    try:
        # Get budget and rules settings from expanded_state in single query
        state_data = query_db('''
            SELECT variable_name, variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name IN (?, ?)
        ''', [account_id, 'build', 'budgetData', 'rules'])

        # Parse budget and rules data
        total_investable_capital = 0
        max_per_country = 10  # Default value

        for row in state_data:
            var_name = row.get('variable_name')
            var_value = row.get('variable_value', '{}')
            try:
                parsed_json = json.loads(var_value)
                if var_name == 'budgetData':
                    total_investable_capital = float(parsed_json.get('totalInvestableCapital', 0))
                elif var_name == 'rules':
                    max_per_country = float(parsed_json.get('maxPerCountry', 10))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse {var_name} data: {e}")

        logger.info(f"Budget settings - Total Investable Capital: {total_investable_capital}, Max Per Country: {max_per_country}%")

        # Get all user's positions with individual company details by country (using shared helper)
        position_data = _get_position_data_by_field(
            account_id,
            "COALESCE(c.override_country, mp.country, 'Unknown')"
        )

        # Group positions by country
        country_positions = {}
        if position_data:
            for row in position_data:
                country = row['field_value']  # Using generic field_value from helper
                if country not in country_positions:
                    country_positions[country] = {
                        'positions': [],
                        'total_invested': 0
                    }

                position_info = {
                    'company_name': row['company_name'],
                    'portfolio_name': row['portfolio_name'],
                    'shares': float(row['shares']),
                    'price': float(row['price']),
                    'value': float(row['position_value'])
                }

                country_positions[country]['positions'].append(position_info)
                country_positions[country]['total_invested'] += position_info['value']

        # Calculate remaining capacity for each country
        country_capacity = []
        if country_positions and total_investable_capital > 0:
            max_per_country_amount = total_investable_capital * (max_per_country / 100)

            for country, data in country_positions.items():
                current_invested = data['total_invested']
                # Allow negative values for over-allocated countries
                remaining_capacity = max_per_country_amount - current_invested

                country_capacity.append({
                    'country': country,
                    'current_invested': current_invested,
                    'max_allowed': max_per_country_amount,
                    'remaining_capacity': remaining_capacity,
                    'is_over_allocated': remaining_capacity < 0,
                    'positions': data['positions']  # Include individual positions for hover
                })

        # Sort by remaining capacity (ascending - over-allocated countries first, then least to most capacity)
        country_capacity.sort(key=lambda x: x['remaining_capacity'])

        logger.info(f"Returning country capacity data for {len(country_capacity)} countries")
        return jsonify({
            'countries': country_capacity,
            'total_investable_capital': total_investable_capital,
            'max_per_country_percent': max_per_country
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting country capacity data: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting country capacity data")
        return error_response('Failed to calculate country capacity', 500)


@require_auth
def get_category_capacity_data():
    """API endpoint to get category investment capacity data for the rebalancing feature"""
    logger.info("API request for category investment capacity data")

    account_id = g.account_id
    logger.info(f"Getting category capacity data for account_id: {account_id}")

    try:
        # Get budget settings from expanded_state (from build page)
        budget_data = query_db('''
            SELECT variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name = ?
        ''', [account_id, 'build', 'budgetData'], one=True)

        rules_data = query_db('''
            SELECT variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name = ?
        ''', [account_id, 'build', 'rules'], one=True)

        # Parse budget and rules data
        total_investable_capital = 0
        max_per_category = 25  # Default value

        if budget_data and isinstance(budget_data, dict):
            try:
                budget_json = json.loads(budget_data.get('variable_value', '{}'))
                total_investable_capital = float(budget_json.get('totalInvestableCapital', 0))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse budget data: {e}")

        if rules_data and isinstance(rules_data, dict):
            try:
                rules_json = json.loads(rules_data.get('variable_value', '{}'))
                max_per_category = float(rules_json.get('maxPerCategory', 25))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse rules data: {e}")

        logger.info(f"Budget settings - Total Investable Capital: {total_investable_capital}, Max Per Category: {max_per_category}%")

        # Get all user's positions with individual company details by category (using shared helper)
        position_data = _get_position_data_by_field(
            account_id,
            "COALESCE(c.category, 'Uncategorized')"
        )

        # Group positions by category
        category_positions = {}
        if position_data:
            for row in position_data:
                category = row['field_value']  # Using generic field_value from helper
                if category not in category_positions:
                    category_positions[category] = {
                        'positions': [],
                        'total_invested': 0
                    }

                position_info = {
                    'company_name': row['company_name'],
                    'portfolio_name': row['portfolio_name'],
                    'shares': float(row['shares']),
                    'price': float(row['price']),
                    'value': float(row['position_value'])
                }

                category_positions[category]['positions'].append(position_info)
                category_positions[category]['total_invested'] += position_info['value']

        # Calculate remaining capacity for each category
        category_capacity = []
        if category_positions and total_investable_capital > 0:
            max_per_category_amount = total_investable_capital * (max_per_category / 100)

            for category, data in category_positions.items():
                current_invested = data['total_invested']
                # Allow negative values for over-allocated categories
                remaining_capacity = max_per_category_amount - current_invested

                category_capacity.append({
                    'category': category,
                    'current_invested': current_invested,
                    'max_allowed': max_per_category_amount,
                    'remaining_capacity': remaining_capacity,
                    'is_over_allocated': remaining_capacity < 0,
                    'positions': data['positions']  # Include individual positions for hover
                })

        # Sort by remaining capacity (ascending - over-allocated categories first, then least to most capacity)
        category_capacity.sort(key=lambda x: x['remaining_capacity'])

        logger.info(f"Returning category capacity data for {len(category_capacity)} categories")
        return jsonify({
            'categories': category_capacity,
            'total_investable_capital': total_investable_capital,
            'max_per_category_percent': max_per_category
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting category capacity data: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting category capacity data")
        return error_response('Failed to calculate category capacity', 500)


@require_auth
def get_effective_capacity_data():
    """
    API endpoint for the Allocation Simulator.

    Returns all data needed for the interactive two-panel slider simulator:
    - availableToInvest: Cash available to allocate (from Builder)
    - All countries with positions and current values
    - All categories with current values
    - Rules (maxPerCountry, maxPerCategory)
    - Position-level detail for proportional distribution

    This supports the Linked Dual-View Simulator where:
    - User adjusts country sliders (primary) → category totals are derived
    - Or user toggles to category-first mode
    - Warnings shown when constraints are exceeded (but not hard-stopped)
    """
    logger.info("API request for allocation simulator data")

    account_id = g.account_id
    logger.info(f"Getting allocation simulator data for account_id: {account_id}")

    try:
        # Get budget and rules settings from expanded_state in single query
        state_data = query_db('''
            SELECT variable_name, variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name IN (?, ?)
        ''', [account_id, 'build', 'budgetData', 'rules'])

        # Parse budget and rules data
        total_investable_capital = 0
        available_to_invest = 0  # NEW: Cash available from Builder
        max_per_country = 10  # Default value
        max_per_category = 25  # Default value

        for row in state_data:
            var_name = row.get('variable_name')
            var_value = row.get('variable_value', '{}')
            try:
                parsed_json = json.loads(var_value)
                if var_name == 'budgetData':
                    total_investable_capital = float(parsed_json.get('totalInvestableCapital', 0))
                    # availableToInvest is the cash the user wants to allocate
                    available_to_invest = float(parsed_json.get('availableToInvest', 0))
                elif var_name == 'rules':
                    max_per_country = float(parsed_json.get('maxPerCountry', 10))
                    max_per_category = float(parsed_json.get('maxPerCategory', 25))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse {var_name} data: {e}")

        logger.info(f"Budget settings - Total: {total_investable_capital}, Max Country: {max_per_country}%, Max Category: {max_per_category}%")

        # Get all positions with BOTH country AND category data
        position_data = query_db('''
            SELECT
                COALESCE(c.override_country, mp.country, 'Unknown') as country,
                COALESCE(c.category, 'Uncategorized') as category,
                c.name as company_name,
                p.name as portfolio_name,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                COALESCE(mp.price_eur, 0) as price,
                CASE
                    WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL THEN c.custom_total_value
                    ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
                END as position_value
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            WHERE c.account_id = ?
            AND COALESCE(cs.override_share, cs.shares, 0) > 0
            AND (COALESCE(mp.price_eur, 0) > 0 OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL))
            ORDER BY country, position_value DESC
        ''', [account_id])

        # Build position lookup structures
        positions_by_country = {}  # country -> list of positions
        positions_by_category = {}  # category -> list of positions
        category_totals = {}  # category -> total value

        if position_data:
            for row in position_data:
                country = row['country']
                category = row['category']
                position_value = float(row['position_value'])

                position_info = {
                    'name': row['company_name'],  # Used by JS renderPositionsList
                    'company_name': row['company_name'],
                    'portfolio_name': row['portfolio_name'],
                    'country': country,  # Needed for category-first mode position lists
                    'category': category,
                    'shares': float(row['shares']),
                    'price': float(row['price']),
                    'value': position_value
                }

                # Group by country
                if country not in positions_by_country:
                    positions_by_country[country] = []
                positions_by_country[country].append(position_info)

                # Group by category
                if category not in positions_by_category:
                    positions_by_category[category] = []
                positions_by_category[category].append(position_info)

                # Track category totals
                category_totals[category] = category_totals.get(category, 0) + position_value

        # Calculate effective capacity for each country
        country_capacity = []
        max_per_country_amount = total_investable_capital * (max_per_country / 100) if total_investable_capital > 0 else 0
        max_per_category_amount = total_investable_capital * (max_per_category / 100) if total_investable_capital > 0 else 0

        for country, positions in positions_by_country.items():
            country_current = sum(p['value'] for p in positions)
            country_remaining = max_per_country_amount - country_current

            # Find the tightest category constraint for positions in this country
            binding_constraint = None
            effective_remaining = country_remaining

            # Get unique categories in this country
            categories_in_country = set(p['category'] for p in positions)

            for category in categories_in_country:
                category_current = category_totals.get(category, 0)
                category_remaining = max_per_category_amount - category_current

                # If this category's remaining capacity is tighter than current effective
                if category_remaining < effective_remaining:
                    effective_remaining = category_remaining
                    category_pct = (category_current / max_per_category_amount * 100) if max_per_category_amount > 0 else 0
                    binding_constraint = f"{category} at {category_pct:.0f}%"

            # Calculate category impact preview (what happens if user invests max in this country)
            category_impact = {}
            country_total_value = sum(p['value'] for p in positions)

            if country_total_value > 0 and effective_remaining > 0:
                for category in categories_in_country:
                    # Calculate how much of new investment would go to this category
                    # (proportional to existing distribution)
                    category_value_in_country = sum(p['value'] for p in positions if p['category'] == category)
                    proportion = category_value_in_country / country_total_value

                    additional_to_category = effective_remaining * proportion
                    category_current = category_totals.get(category, 0)
                    new_category_total = category_current + additional_to_category

                    current_pct = (category_current / total_investable_capital * 100) if total_investable_capital > 0 else 0
                    new_pct = (new_category_total / total_investable_capital * 100) if total_investable_capital > 0 else 0

                    category_impact[category] = {
                        'current': round(current_pct, 1),
                        'if_max_invest': round(new_pct, 1),
                        'is_ok': new_pct <= max_per_category
                    }

            country_capacity.append({
                'country': country,
                'current_invested': round(country_current, 2),
                'country_max': round(max_per_country_amount, 2),
                'country_remaining': round(country_remaining, 2),
                'effective_remaining': round(max(0, effective_remaining), 2),
                'binding_constraint': binding_constraint,
                'positions': positions,
                'category_impact': category_impact
            })

        # Sort by effective remaining capacity (ascending - blocked first, then least capacity)
        country_capacity.sort(key=lambda x: x['effective_remaining'])

        # Build category data for the simulator
        categories_list = []
        max_per_category_amount = total_investable_capital * (max_per_category / 100) if total_investable_capital > 0 else 0
        for category, total in category_totals.items():
            category_remaining = max_per_category_amount - total
            category_pct = (total / total_investable_capital * 100) if total_investable_capital > 0 else 0
            categories_list.append({
                'category': category,
                'current_invested': round(total, 2),
                'category_max': round(max_per_category_amount, 2),
                'category_remaining': round(category_remaining, 2),
                'current_percent': round(category_pct, 1),
                'positions': positions_by_category.get(category, [])
            })

        # Sort categories by current invested (descending)
        categories_list.sort(key=lambda x: x['current_invested'], reverse=True)

        # Build summary
        blocked_countries = [c['country'] for c in country_capacity if c['effective_remaining'] <= 0]
        constrained_by_category = [c['country'] for c in country_capacity if c['binding_constraint'] is not None and c['effective_remaining'] > 0]
        total_effective_capacity = sum(max(0, c['effective_remaining']) for c in country_capacity)

        # Count constraint violations for warnings
        countries_over_limit = sum(1 for c in country_capacity
                                   if c['current_invested'] > c['country_max'])
        categories_over_limit = sum(1 for c in categories_list
                                    if c['current_invested'] > c['category_max'])

        logger.info(f"Returning allocation simulator data: {len(country_capacity)} countries, {len(categories_list)} categories")
        return jsonify({
            'countries': country_capacity,
            'categories': categories_list,  # NEW: For category panel
            'available_to_invest': available_to_invest,  # NEW: Cash to allocate
            'total_investable_capital': total_investable_capital,
            'rules': {
                'maxPerCountry': max_per_country,
                'maxPerCategory': max_per_category
            },
            'summary': {
                'total_effective_capacity': round(total_effective_capacity, 2),
                'blocked_countries': blocked_countries,
                'constrained_by_category': constrained_by_category,
                'countries_over_limit': countries_over_limit,
                'categories_over_limit': categories_over_limit
            }
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting effective capacity data: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting effective capacity data")
        return error_response('Failed to calculate effective capacity', 500)


@require_auth
def get_portfolios_api():
    """API endpoint to get portfolios for an account"""
    logger.info("Accessing portfolios API")

    try:
        account_id = g.account_id
        include_ids = request.args.get(
            'include_ids', 'false').lower() == 'true'
        has_companies = request.args.get(
            'has_companies', 'false').lower() == 'true'
        include_values = request.args.get(
            'include_values', 'false').lower() == 'true'
        logger.info(
            f"Getting portfolios for account_id: {account_id}, include_ids: {include_ids}, has_companies: {has_companies}, include_values: {include_values}")

        # Get portfolio data from portfolios table, including all portfolios with non-null names
        if include_ids:
            # First, try to get the user-saved order from expanded_state
            saved_order_ids = []
            try:
                saved_portfolios_data = query_db('''
                    SELECT variable_value FROM expanded_state 
                    WHERE account_id = ? AND page_name = 'build' AND variable_name = 'portfolios'
                ''', [account_id], one=True)
                
                if saved_portfolios_data and isinstance(saved_portfolios_data, dict):
                    saved_portfolios = json.loads(saved_portfolios_data['variable_value'])
                    saved_order_ids = [p['id'] for p in saved_portfolios if 'id' in p]
                    logger.info(f"Found saved portfolio order: {saved_order_ids}")
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                logger.warning(f"Could not parse saved portfolio order: {e}")
                saved_order_ids = []

            # Get portfolios from the portfolios table (without ORDER BY)
            if has_companies:
                # Only get portfolios that have at least one company (don't require company_shares entries)
                portfolios_from_table = query_db('''
                    SELECT DISTINCT p.id, p.name 
                    FROM portfolios p
                    JOIN companies c ON p.id = c.portfolio_id
                    WHERE p.account_id = ? AND p.name IS NOT NULL
                ''', [account_id])
                logger.info(
                    f"Filtering for portfolios with associated companies")
            else:
                # Get all portfolios
                portfolios_from_table = query_db('''
                    SELECT id, name FROM portfolios 
                    WHERE account_id = ? AND name IS NOT NULL
                ''', [account_id])

            # Convert to list of objects with id and name, applying saved order
            portfolios = []
            if portfolios_from_table:
                portfolios_dict = {p['id']: {'id': p['id'], 'name': p['name']} 
                                 for p in portfolios_from_table if isinstance(p, dict)}
                
                # If we have saved order, use it; otherwise fall back to name order
                if saved_order_ids:
                    # First add portfolios in saved order
                    for portfolio_id in saved_order_ids:
                        if portfolio_id in portfolios_dict:
                            portfolios.append(portfolios_dict[portfolio_id])
                    # Then add any remaining portfolios not in saved order
                    for portfolio_id, portfolio_data in portfolios_dict.items():
                        if portfolio_id not in saved_order_ids:
                            portfolios.append(portfolio_data)
                    logger.info(f"Applied saved portfolio order")
                else:
                    # Fall back to alphabetical order by name
                    portfolios = sorted(portfolios_dict.values(), key=lambda x: x['name'])
                    logger.info(f"No saved order found, using alphabetical order")
            logger.info(
                f"Retrieved {len(portfolios)} portfolios with IDs: {portfolios}")

            # Ensure we're not missing the '-' portfolio if it has companies or if we're not filtering
            has_default = any(p['name'] == '-' for p in portfolios)
            if not has_default and (not has_companies or has_companies_in_default(account_id)):
                default_portfolio = query_db('''
                    SELECT id FROM portfolios
                    WHERE account_id = ? AND name = '-'
                ''', [account_id], one=True)

                if default_portfolio and isinstance(default_portfolio, dict):
                    portfolios.append(
                        {'id': default_portfolio['id'], 'name': '-'})
                    logger.info("Added '-' portfolio to the response")
                else:
                    # Create '-' portfolio if it doesn't exist
                    portfolio_id = execute_db('''
                        INSERT INTO portfolios (account_id, name)
                        VALUES (?, '-')
                    ''', [account_id])

                    portfolios.append({'id': portfolio_id, 'name': '-'})
                    logger.info(
                        "Created and added '-' portfolio to the response")

            # Add portfolio values if requested
            if include_values and portfolios:
                portfolio_values = query_db('''
                    SELECT p.id, COALESCE(SUM(
                        CASE
                            WHEN c.is_custom_value = 1 THEN c.custom_total_value
                            ELSE COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0)
                        END
                    ), 0) as total_value
                    FROM portfolios p
                    LEFT JOIN companies c ON p.id = c.portfolio_id
                    LEFT JOIN company_shares cs ON c.id = cs.company_id
                    LEFT JOIN market_prices mp ON c.identifier = mp.identifier
                    WHERE p.account_id = ? AND p.name IS NOT NULL
                    GROUP BY p.id
                ''', [account_id])

                # Create a lookup dict for portfolio values
                value_lookup = {}
                if portfolio_values:
                    value_lookup = {pv['id']: pv['total_value'] for pv in portfolio_values if isinstance(pv, dict)}

                # Add total_value to each portfolio
                for portfolio in portfolios:
                    portfolio['total_value'] = value_lookup.get(portfolio['id'], 0)

                logger.info(f"Added portfolio values: {[(p['name'], p.get('total_value', 0)) for p in portfolios]}")

            json_response = jsonify(portfolios)
        else:
            # Get portfolio names only
            if has_companies:
                # Only get portfolios that have at least one company (don't require company_shares entries)
                portfolios_from_table = query_db('''
                    SELECT DISTINCT p.name 
                    FROM portfolios p
                    JOIN companies c ON p.id = c.portfolio_id
                    WHERE p.account_id = ? AND p.name IS NOT NULL
                    ORDER BY p.name
                ''', [account_id])
                logger.info(
                    f"Filtering for portfolios with associated companies")
            else:
                # Get all portfolios
                portfolios_from_table = query_db('''
                    SELECT name FROM portfolios 
                    WHERE account_id = ? AND name IS NOT NULL
                    ORDER BY name
                ''', [account_id])

            # Extract names from the query results - don't filter out any valid names
            names = []
            if portfolios_from_table:
                names = [p['name'] for p in portfolios_from_table if isinstance(p, dict)]
            logger.info(
                f"Retrieved {len(names)} portfolio names from portfolios table: {names}")

            # Ensure '-' is in the list if it has companies or if we're not filtering
            if '-' not in names and (not has_companies or has_companies_in_default(account_id)):
                default_exists = query_db('''
                    SELECT 1 FROM portfolios
                    WHERE account_id = ? AND name = '-'
                ''', [account_id], one=True)

                if default_exists:
                    names.append('-')
                    logger.info("Added '-' portfolio name to the response")
                else:
                    # Create '-' portfolio if it doesn't exist
                    execute_db('''
                        INSERT INTO portfolios (account_id, name)
                        VALUES (?, '-')
                    ''', [account_id])

                    names.append('-')
                    logger.info(
                        "Created and added '-' portfolio name to the response")

            json_response = jsonify(names)

        logger.debug(f"JSON response to be sent: {json_response.data}")
        return json_response

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting portfolios: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting portfolios")
        return error_response('Failed to retrieve portfolios', 500)


@require_auth
def upload_csv():
    """
    Upload and process CSV data using background job architecture.
    This endpoint validates the file and starts background processing,
    returning immediately to enable real-time progress tracking.
    """
    logger.info(f"CSV upload request - session content: {dict(session)}")

    # Determine if this is an AJAX request
    accept_header = request.headers.get('Accept', '')
    is_ajax = ('application/json' in accept_header or
               request.headers.get('X-Requested-With') == 'XMLHttpRequest')

    logger.info(f"Request headers: Accept='{accept_header}', X-Requested-With='{request.headers.get('X-Requested-With')}', is_ajax={is_ajax}")

    try:
        account_id = g.account_id
        logger.info(f"CSV upload for account_id: {account_id}")

        # File validation
        if 'csv_file' not in request.files:
            logger.warning("CSV upload failed - no csv_file in request.files")
            raise ValidationError('No file uploaded')

        file = request.files['csv_file']
        logger.info(f"CSV file received: {file.filename}, size: {file.content_length if hasattr(file, 'content_length') else 'unknown'}")

        if file.filename == '':
            logger.warning("CSV upload failed - empty filename")
            raise ValidationError('No file selected')

        # Read and validate file content
        try:
            file_content = file.read().decode('utf-8-sig')  # Handle BOM
        except UnicodeDecodeError as e:
            logger.error(f"CSV file encoding error: {e}")
            raise ValidationError('Invalid file encoding. Please ensure the file is UTF-8 encoded')

        if not file_content.strip():
            logger.warning("CSV upload failed - file is empty")
            raise ValidationError('The uploaded CSV file is empty')

        logger.info(f"CSV file content length: {len(file_content)} characters")

        # Ensure session is properly configured
        session.permanent = True
        session.modified = True

        # Create backup (automatic backups must always be enabled) [[memory:7528819]]
        try:
            backup_database()
            logger.info("Database backup created before CSV processing")
        except Exception as e:
            logger.error(f"Failed to create database backup: {e}")
            raise DataIntegrityError('Failed to create database backup before processing')

        # Dispatch processing to background thread
        try:
            job_id = start_csv_processing_job(account_id, file_content)
        except Exception as e:
            logger.error(f"Failed to start CSV processing job: {e}")
            raise CSVProcessingError(f'Failed to start CSV processing: {str(e)}')

        # Store job_id in session for progress tracking
        session['csv_upload_job_id'] = job_id
        session.modified = True

        logger.info(f"CSV processing successfully dispatched to background job: {job_id}")

        # Return immediate success response - allows session cookie to be updated
        if is_ajax:
            return success_response(message='CSV upload started successfully. Processing in background...')
        else:
            flash('CSV upload started successfully. Processing in background...', 'info')
            return redirect(url_for('portfolio.enrich'))

    except ValidationError as e:
        logger.error(f"CSV validation error: {e}")
        if is_ajax:
            return error_response(str(e), status=400)
        flash(str(e), 'error')
        return redirect(url_for('portfolio.enrich'))

    except CSVProcessingError as e:
        logger.error(f"CSV processing error: {e}")
        if is_ajax:
            return error_response(str(e), status=500)
        flash(str(e), 'error')
        return redirect(url_for('portfolio.enrich'))

    except DataIntegrityError as e:
        logger.error(f"Data integrity error: {e}")
        if is_ajax:
            return error_response(str(e), status=409)
        flash(str(e), 'error')
        return redirect(url_for('portfolio.enrich'))

    except Exception as e:
        logger.exception("Unexpected error during CSV upload")
        error_message = 'An unexpected error occurred during CSV upload'
        if is_ajax:
            return error_response(error_message, status=500)
        flash(error_message, 'error')
        return redirect(url_for('portfolio.enrich'))


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
            return validation_error_response(
                error_msg,
                details=validation_data
            )

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
                portfolio_name = item.get('portfolio')
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
                update_fields.append('category = ?')
                update_values.append(item.get('category', ''))
                update_fields.append('portfolio_id = ?')
                update_values.append(portfolio_id)

                # Conditionally update investment_type if provided
                if 'investment_type' in item:
                    investment_type = item.get('investment_type')
                    # Validate investment_type value
                    if investment_type and investment_type in ('Stock', 'ETF'):
                        update_fields.append('investment_type = ?')
                        update_values.append(investment_type)
                    elif investment_type is None or investment_type == '':
                        # Allow clearing investment_type
                        update_fields.append('investment_type = NULL')
                    else:
                        # Reject invalid investment_type values
                        logger.warning(f"Invalid investment_type value: {investment_type}")
                        return error_response(
                            f"Invalid investment_type: '{investment_type}'. Must be 'Stock', 'ETF', or empty.",
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
    """Add, rename, or delete portfolios"""
    account_id = g.account_id
    action = request.form.get('action')

    try:
        # Create backup
        backup_database()

        if action == 'add':
            portfolio_name = request.form.get('add_portfolio_name', '').strip()
            if not portfolio_name:
                flash('Portfolio name cannot be empty', 'error')
                return redirect(url_for('portfolio.enrich'))

            # Check if portfolio already exists
            existing = query_db(
                'SELECT 1 FROM portfolios WHERE name = ? AND account_id = ?',
                [portfolio_name, account_id],
                one=True
            )

            if existing:
                flash(f'Portfolio "{portfolio_name}" already exists', 'error')
                return redirect(url_for('portfolio.enrich'))

            # Add new portfolio
            execute_db(
                'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                [portfolio_name, account_id]
            )

            flash(
                f'Portfolio "{portfolio_name}" added successfully', 'success')

        elif action == 'rename':
            old_name = request.form.get('old_name', '').strip()
            new_name = request.form.get('new_name', '').strip()

            if not old_name or not new_name:
                flash('Both old and new portfolio names are required', 'error')
                return redirect(url_for('portfolio.enrich'))

            # Check if new name already exists
            existing = query_db(
                'SELECT 1 FROM portfolios WHERE name = ? AND account_id = ?',
                [new_name, account_id],
                one=True
            )

            if existing:
                flash(f'Portfolio "{new_name}" already exists', 'error')
                return redirect(url_for('portfolio.enrich'))

            # Rename portfolio
            execute_db(
                'UPDATE portfolios SET name = ? WHERE name = ? AND account_id = ?',
                [new_name, old_name, account_id]
            )

            flash(
                f'Portfolio renamed from "{old_name}" to "{new_name}"', 'success')

        elif action == 'delete':
            portfolio_name = request.form.get(
                'delete_portfolio_name', '').strip()

            if not portfolio_name:
                flash('Portfolio name is required', 'error')
                return redirect(url_for('portfolio.enrich'))

            # Check if portfolio is empty
            companies = query_db('''
                SELECT COUNT(*) as count FROM companies c
                JOIN portfolios p ON c.portfolio_id = p.id
                WHERE p.name = ? AND p.account_id = ?
            ''', [portfolio_name, account_id], one=True)

            if companies and isinstance(companies, dict) and companies.get('count', 0) > 0:
                flash(
                    f'Cannot delete portfolio "{portfolio_name}" because it contains companies', 'error')
                return redirect(url_for('portfolio.enrich'))

            # Delete portfolio
            execute_db(
                'DELETE FROM portfolios WHERE name = ? AND account_id = ?',
                [portfolio_name, account_id]
            )

            flash(
                f'Portfolio "{portfolio_name}" deleted successfully', 'success')

    except (DataIntegrityError, ValidationError) as e:
        flash(f'Error managing portfolios: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error managing portfolios")
        flash('An unexpected error occurred while managing portfolios', 'error')

    return redirect(url_for('portfolio.enrich'))


@require_auth
def csv_upload_progress():
    """API endpoint to get/clear progress of CSV upload operation using database tracking"""
    try:
        if request.method == 'GET':
            # Check for job_id in session
            job_id = session.get('csv_upload_job_id')
            
            if job_id:
                # Get progress from database using existing function
                job_status = get_job_status(job_id)
                
                logger.debug(f" Session has job_id={job_id}, job_status={job_status.get('status')}")
                
                # IMMEDIATELY clear failed/cancelled jobs from session to prevent infinite loops
                if job_status.get('status') in ['failed', 'cancelled', 'completed']:
                    logger.debug(f" Job {job_id} has terminal status '{job_status.get('status')}', clearing from session IMMEDIATELY")
                    if 'csv_upload_job_id' in session:
                        del session['csv_upload_job_id']
                        session.modified = True
                    
                    # Return idle status for terminal jobs to stop polling
                    return jsonify({
                        'current': 0,
                        'total': 0,
                        'percentage': 0,
                        'status': 'idle',
                        'message': f'Upload {job_status.get("status")}: {job_status.get("message", "")}'
                    })
                
                if job_status.get('status') != 'not_found':
                    # Convert database format to frontend format
                    progress_data = {
                        'current': job_status.get('progress', 0),
                        'total': job_status.get('total', 100),
                        'percentage': job_status.get('progress', 0),
                        'status': 'processing' if job_status.get('status') == 'processing' else job_status.get('status', 'idle'),
                        'message': job_status.get('message', 'Processing...'),
                        'job_id': job_id
                    }

                    logger.debug(f" CSV progress API returning for account {g.account_id}: {progress_data}")

                    return jsonify(progress_data)
            
            # No job_id or job not found - return idle status
            progress_data = {
                'current': 0,
                'total': 0,
                'percentage': 0,
                'status': 'idle',
                'message': 'No active upload'
            }
            
            return jsonify(progress_data)
        
        elif request.method == 'DELETE':
            # Clear CSV upload job from session
            job_id = session.get('csv_upload_job_id')
            if job_id:
                logger.info(f"Manually clearing CSV upload job {job_id} for account {g.account_id}")
                del session['csv_upload_job_id']
                session.modified = True
            
            # Also clear legacy session progress if exists
            if 'csv_upload_progress' in session:
                del session['csv_upload_progress']
                session.modified = True
                
            return jsonify({'message': f'CSV upload progress cleared (was tracking job_id: {job_id})'})

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error handling CSV upload progress: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error handling CSV upload progress")
        return error_response('Failed to retrieve upload progress', 500)

    return error_response('Method not allowed', 405)


@require_auth
def cancel_csv_upload():
    """API endpoint to cancel ongoing CSV upload"""
    try:
        # Get job_id from session
        job_id = session.get('csv_upload_job_id')
        
        if not job_id:
            return error_response('No active upload to cancel', 400)
        
        # Cancel the background job by marking it as cancelled in database
        success = cancel_background_job(job_id)
        
        if success:
            # Clear the job_id from session
            session.pop('csv_upload_job_id', None)
            session.modified = True

            logger.info(f"CSV upload cancelled for account_id: {g.account_id}, job_id: {job_id}")
            return success_response(message='Upload cancelled successfully')
        else:
            return error_response('Failed to cancel upload', 500)

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error cancelling CSV upload: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error cancelling CSV upload")
        return error_response('Failed to cancel upload', 500)


@require_auth
def get_portfolio_metrics():
    """Get portfolio metrics including total value"""
    try:
        account_id = g.account_id

        # Get portfolio data using the same method as enrich page
        portfolio_data = get_portfolio_data(account_id)

        # Calculate total value using centralized utility (handles custom values correctly)
        total_value = float(calculate_portfolio_total(portfolio_data))

        # Count items with missing prices (accounting for custom values)
        # An item is considered to have a price if it has either market price or custom value
        missing_prices = sum(
            1 for item in portfolio_data
            if not has_price_or_custom_value(item)
        )

        total_items = len(portfolio_data)
        health = int(((total_items - missing_prices) / total_items * 100) if total_items > 0 else 100)

        last_updates = [item['last_updated'] for item in portfolio_data if item['last_updated'] is not None]

        return jsonify({
            'total_value': total_value,
            'total_items': total_items,
            'health': health,
            'missing_prices': missing_prices,
            'last_update': max(last_updates) if last_updates else None
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting portfolio metrics: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting portfolio metrics")
        return error_response('Failed to get portfolio metrics', 500)


@require_auth
def get_investment_type_distribution():
    """
    Get investment type distribution (Stock vs ETF) for portfolio visualization.

    Returns aggregated data showing:
    - Total value per investment type
    - Percentage of portfolio per type
    - Count of positions per type
    """
    try:
        account_id = g.account_id

        # Query to get investment type distribution
        # Uses the same logic as portfolio value calculations (handles custom values)
        distribution_data = query_db('''
            SELECT
                COALESCE(c.investment_type, 'Uncategorized') as type,
                COUNT(*) as count,
                SUM(CASE
                    WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL
                        THEN c.custom_total_value
                    ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
                END) as value
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            AND (
                (COALESCE(cs.override_share, cs.shares, 0) > 0)
                OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL)
            )
            GROUP BY c.investment_type
        ''', [account_id])

        # Calculate total value
        total_value = sum(item['value'] for item in distribution_data if item['value'])

        # Format response
        distribution = []
        for item in distribution_data:
            value = float(item['value']) if item['value'] else 0.0
            percentage = (value / total_value * 100) if total_value > 0 else 0.0

            distribution.append({
                'type': item['type'],
                'value': round(value, 2),
                'percentage': round(percentage, 2),
                'count': item['count']
            })

        return jsonify({
            'distribution': distribution,
            'total_value': round(total_value, 2)
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting investment type distribution: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting investment type distribution")
        return error_response('Failed to get investment type distribution', 500)


# ============================================================================
# Allocation Simulator API
# ============================================================================

@require_auth
def simulator_ticker_lookup():
    """
    Lookup ticker information from yfinance for the allocation simulator.

    POST /portfolio/api/simulator/ticker-lookup
    Body: { "ticker": "AAPL" }

    Returns:
        - ticker: The ticker symbol
        - category: Sector/industry (e.g., "Technology")
        - country: Country of origin (e.g., "United States")
        - name: Company name (e.g., "Apple Inc.")
        - existsInPortfolio: Boolean indicating if ticker exists in user's portfolio
        - portfolioData: Position data if ticker exists in portfolio (value, shares, etc.)
    """
    try:
        data = request.get_json()
        if not data:
            return validation_error_response('Request body is required')

        ticker = data.get('ticker', '').strip().upper()
        if not ticker:
            return validation_error_response('Ticker symbol is required')

        account_id = g.account_id
        logger.info(f"Simulator ticker lookup for: {ticker}")

        # Check if ticker exists in user's portfolio
        existing_position = query_db('''
            SELECT
                c.id,
                c.name,
                c.identifier,
                c.category,
                COALESCE(c.override_country, mp.country) as country,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                CASE
                    WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL
                        THEN c.custom_total_value
                    ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
                END as value
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            AND UPPER(c.identifier) = ?
            LIMIT 1
        ''', [account_id, ticker], one=True)

        # Fetch info from yfinance (uses 15-minute cache)
        info = get_yfinance_info(ticker)

        if not info or 'error' in info:
            logger.warning(f"Ticker not found or error: {ticker}")
            return not_found_response(f"Ticker '{ticker}' not found or no data available")

        # Check if we got meaningful data (not just an empty dict)
        if not info.get('shortName') and not info.get('longName'):
            logger.warning(f"No name data for ticker: {ticker}")
            return not_found_response(f"Ticker '{ticker}' not found or no data available")

        # Extract relevant fields
        # Category: prefer sector, fall back to industry, then quoteType
        category = info.get('sector') or info.get('industry') or info.get('quoteType', '—')

        # Country: direct field from yfinance
        country = info.get('country', '—')

        # Name: prefer shortName for cleaner display
        name = info.get('shortName') or info.get('longName', ticker)

        # If position exists in portfolio, prefer its data
        exists_in_portfolio = existing_position is not None
        portfolio_data = None

        if exists_in_portfolio:
            portfolio_data = {
                'id': existing_position['id'],
                'name': existing_position['name'],
                'category': existing_position['category'] or category,
                'country': existing_position['country'] or country,
                'shares': float(existing_position['shares']) if existing_position['shares'] else 0,
                'value': round(float(existing_position['value']), 2) if existing_position['value'] else 0
            }
            # Use portfolio data for category/country if available
            if existing_position['category']:
                category = existing_position['category']
            if existing_position['country']:
                country = existing_position['country']

        logger.info(f"Ticker lookup success: {ticker} -> {category}, {country}, exists={exists_in_portfolio}")

        return success_response({
            'ticker': ticker,
            'category': category if category else '—',
            'country': country if country else '—',
            'name': name,
            'existsInPortfolio': exists_in_portfolio,
            'portfolioData': portfolio_data
        })

    except Exception as e:
        logger.exception(f"Error in simulator ticker lookup")
        return error_response('Failed to fetch ticker data', 500)


@require_auth
def simulator_portfolio_allocations():
    """
    Get portfolio allocation data for the simulator combined view.

    GET /portfolio/api/simulator/portfolio-allocations
    Query params:
        - scope: 'global' (all portfolios) or 'portfolio' (specific portfolio)
        - portfolio_id: Required if scope='portfolio'

    Returns:
        - scope: The scope used
        - portfolio_name: Name of portfolio (if scope='portfolio')
        - total_value: Total portfolio value in EUR
        - countries: List of country allocations with value and percentage
        - categories: List of category allocations with value and percentage
        - positions: List of positions for ticker matching
    """
    try:
        account_id = g.account_id
        scope = request.args.get('scope', 'global')
        portfolio_id = request.args.get('portfolio_id', type=int)

        logger.info(f"Simulator portfolio allocations: scope={scope}, portfolio_id={portfolio_id}")

        # Build query based on scope
        portfolio_filter = ''
        params = [account_id]
        portfolio_name = None

        if scope == 'portfolio' and portfolio_id:
            portfolio_filter = 'AND c.portfolio_id = ?'
            params.append(portfolio_id)

            # Get portfolio name
            portfolio = query_db(
                'SELECT name FROM portfolios WHERE id = ? AND account_id = ?',
                [portfolio_id, account_id], one=True
            )
            if portfolio:
                portfolio_name = portfolio['name']

        # Get all positions with values
        positions_query = f'''
            SELECT
                c.id,
                c.name,
                c.identifier,
                c.category,
                COALESCE(c.override_country, mp.country) as country,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                mp.price_eur,
                CASE
                    WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL
                        THEN c.custom_total_value
                    ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
                END as value
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            {portfolio_filter}
            AND (
                (COALESCE(cs.override_share, cs.shares, 0) > 0)
                OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL)
            )
            ORDER BY value DESC
        '''

        positions = query_db(positions_query, params)

        if not positions:
            return success_response({
                'scope': scope,
                'portfolio_name': portfolio_name,
                'total_value': 0,
                'countries': [],
                'categories': [],
                'positions': []
            })

        # Calculate total value
        total_value = sum(float(p['value'] or 0) for p in positions)

        # Aggregate by country
        country_totals = {}
        for p in positions:
            country = p['country'] or 'Unknown'
            country_totals[country] = country_totals.get(country, 0) + float(p['value'] or 0)

        countries = []
        for country, value in sorted(country_totals.items(), key=lambda x: -x[1]):
            percentage = (value / total_value * 100) if total_value > 0 else 0
            countries.append({
                'name': country,
                'value': round(value, 2),
                'percentage': round(percentage, 2)
            })

        # Aggregate by category
        category_totals = {}
        for p in positions:
            category = p['category'] or 'Unknown'
            category_totals[category] = category_totals.get(category, 0) + float(p['value'] or 0)

        categories = []
        for category, value in sorted(category_totals.items(), key=lambda x: -x[1]):
            percentage = (value / total_value * 100) if total_value > 0 else 0
            categories.append({
                'name': category,
                'value': round(value, 2),
                'percentage': round(percentage, 2)
            })

        # Format positions for response
        positions_list = []
        for p in positions:
            positions_list.append({
                'id': p['id'],
                'ticker': p['identifier'],
                'name': p['name'],
                'country': p['country'] or 'Unknown',
                'category': p['category'] or 'Unknown',
                'value': round(float(p['value'] or 0), 2)
            })

        logger.info(f"Returning allocations: {len(countries)} countries, {len(categories)} categories, total={total_value:.2f}")

        return success_response({
            'scope': scope,
            'portfolio_name': portfolio_name,
            'total_value': round(total_value, 2),
            'countries': countries,
            'categories': categories,
            'positions': positions_list
        })

    except Exception as e:
        logger.exception("Error getting simulator portfolio allocations")
        return error_response('Failed to get portfolio allocations', 500)


@require_auth
def simulator_simulations_list():
    """
    List all saved simulations for the current user.

    GET /portfolio/api/simulator/simulations

    Returns:
        List of simulations with id, name, scope, portfolio info, timestamps
    """
    try:
        from app.repositories.simulation_repository import SimulationRepository

        account_id = g.account_id
        simulations = SimulationRepository.get_all(account_id)

        logger.info(f"Returning {len(simulations)} simulations for account {account_id}")
        return success_response({'simulations': simulations})

    except Exception as e:
        logger.exception("Error listing simulations")
        return error_response('Failed to list simulations', 500)


@require_auth
def simulator_simulation_create():
    """
    Create a new saved simulation.

    POST /portfolio/api/simulator/simulations
    Body: {
        "name": "My Simulation",
        "scope": "global" | "portfolio",
        "portfolio_id": 123,  // required if scope="portfolio"
        "items": [...]
    }

    Returns:
        Created simulation with ID
    """
    try:
        from app.repositories.simulation_repository import SimulationRepository

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return error_response('Request body is required', 400)

        name = data.get('name', '').strip()
        if not name:
            return error_response('Simulation name is required', 400)

        if len(name) > 100:
            return error_response('Simulation name too long (max 100 characters)', 400)

        scope = data.get('scope', 'global')
        if scope not in ('global', 'portfolio'):
            return error_response("Scope must be 'global' or 'portfolio'", 400)

        portfolio_id = data.get('portfolio_id')
        if scope == 'portfolio' and not portfolio_id:
            return error_response('portfolio_id is required when scope is "portfolio"', 400)

        items = data.get('items', [])
        if not isinstance(items, list):
            return error_response('Items must be a list', 400)

        # Check for duplicate name
        if SimulationRepository.exists(name, account_id):
            return error_response(f'A simulation named "{name}" already exists', 409)

        # Create simulation
        simulation_id = SimulationRepository.create(
            account_id=account_id,
            name=name,
            scope=scope,
            items=items,
            portfolio_id=portfolio_id if scope == 'portfolio' else None
        )

        # Fetch the created simulation
        simulation = SimulationRepository.get_by_id(simulation_id, account_id)

        logger.info(f"Created simulation '{name}' (id={simulation_id})")
        return success_response({'simulation': simulation}, status=201)

    except Exception as e:
        logger.exception("Error creating simulation")
        return error_response('Failed to create simulation', 500)


@require_auth
def simulator_simulation_get(simulation_id: int):
    """
    Get a simulation by ID with full items data.

    GET /portfolio/api/simulator/simulations/<id>

    Returns:
        Full simulation data including items
    """
    try:
        from app.repositories.simulation_repository import SimulationRepository

        account_id = g.account_id
        simulation = SimulationRepository.get_by_id(simulation_id, account_id)

        if not simulation:
            return not_found_response('Simulation', simulation_id)

        return success_response({'simulation': simulation})

    except Exception as e:
        logger.exception(f"Error getting simulation {simulation_id}")
        return error_response('Failed to get simulation', 500)


@require_auth
def simulator_simulation_update(simulation_id: int):
    """
    Update an existing simulation.

    PUT /portfolio/api/simulator/simulations/<id>
    Body: {
        "name": "New Name",  // optional
        "scope": "global",   // optional
        "portfolio_id": 123, // optional
        "items": [...]       // optional
    }

    Returns:
        Updated simulation
    """
    try:
        from app.repositories.simulation_repository import SimulationRepository

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return error_response('Request body is required', 400)

        # Verify simulation exists
        existing = SimulationRepository.get_by_id(simulation_id, account_id)
        if not existing:
            return not_found_response('Simulation', simulation_id)

        # Validate name if provided
        name = data.get('name')
        if name is not None:
            name = name.strip()
            if not name:
                return error_response('Simulation name cannot be empty', 400)
            if len(name) > 100:
                return error_response('Simulation name too long (max 100 characters)', 400)
            # Check for duplicate name (excluding current)
            if SimulationRepository.exists(name, account_id, exclude_id=simulation_id):
                return error_response(f'A simulation named "{name}" already exists', 409)

        # Validate scope if provided
        scope = data.get('scope')
        if scope is not None and scope not in ('global', 'portfolio'):
            return error_response("Scope must be 'global' or 'portfolio'", 400)

        # Validate items if provided
        items = data.get('items')
        if items is not None and not isinstance(items, list):
            return error_response('Items must be a list', 400)

        # Update simulation
        success = SimulationRepository.update(
            simulation_id=simulation_id,
            account_id=account_id,
            name=name,
            scope=scope,
            items=items,
            portfolio_id=data.get('portfolio_id')
        )

        if not success:
            return error_response('Failed to update simulation', 500)

        # Fetch updated simulation
        simulation = SimulationRepository.get_by_id(simulation_id, account_id)

        logger.info(f"Updated simulation {simulation_id}")
        return success_response({'simulation': simulation})

    except Exception as e:
        logger.exception(f"Error updating simulation {simulation_id}")
        return error_response('Failed to update simulation', 500)


@require_auth
def simulator_simulation_delete(simulation_id: int):
    """
    Delete a simulation.

    DELETE /portfolio/api/simulator/simulations/<id>

    Returns:
        Success message
    """
    try:
        from app.repositories.simulation_repository import SimulationRepository

        account_id = g.account_id

        # Verify simulation exists
        existing = SimulationRepository.get_by_id(simulation_id, account_id)
        if not existing:
            return not_found_response('Simulation', simulation_id)

        success = SimulationRepository.delete(simulation_id, account_id)

        if not success:
            return error_response('Failed to delete simulation', 500)

        logger.info(f"Deleted simulation {simulation_id}")
        return success_response({'message': 'Simulation deleted successfully'})

    except Exception as e:
        logger.exception(f"Error deleting simulation {simulation_id}")
        return error_response('Failed to delete simulation', 500)
