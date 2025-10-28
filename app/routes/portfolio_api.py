from flask import (
    request, flash, session, jsonify, redirect, url_for, Response, g
)
from app.db_manager import query_db, execute_db, backup_database, get_db
from app.decorators import require_auth
from app.utils.db_utils import (
    load_portfolio_data, process_portfolio_dataframe, update_price_in_db, update_batch_prices_in_db
)
from app.utils.yfinance_utils import get_isin_data
from app.utils.batch_processing import start_batch_process, get_job_status, start_csv_processing_job
from app.utils.portfolio_utils import (
    get_portfolio_data, process_csv_data, has_companies_in_default, get_stock_info
)
from app.utils.yfinance_utils import get_isin_data
from app.utils.db_utils import update_price_in_db
from app.utils.response_helpers import success_response, error_response, not_found_response, validation_error_response, service_unavailable_response
from app.exceptions import (
    ValidationError, DataIntegrityError, ExternalAPIError, NotFoundError,
    CSVProcessingError, PriceFetchError
)
from app.utils.value_calculator import calculate_portfolio_total, calculate_item_value, has_price_or_custom_value


import pandas as pd
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
    """Internal helper to update company and share data."""
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

    # Build the SET clause dynamically based on what data is provided
    set_clause_parts = []
    params = []

    if 'identifier' in data:
        set_clause_parts.append('identifier = ?')
        params.append(data.get('identifier', ''))

    if 'category' in data:
        set_clause_parts.append('category = ?')
        params.append(data.get('category', ''))

    # Only update portfolio_id if portfolio is being changed
    if 'portfolio' in data:
        set_clause_parts.append('portfolio_id = ?')
        params.append(portfolio_id)

    # Handle custom total value when no price is available (MUST be before UPDATE execution)
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
            set_clause_parts.append('custom_value_date = CURRENT_TIMESTAMP')
            logger.info(f"User set custom total value {custom_total_value} (price: {custom_price}) for company {company_id}")

    # Add the company_id for the WHERE clause
    params.append(company_id)

    if set_clause_parts:
        set_clause = ', '.join(set_clause_parts)
        cursor.execute(f'UPDATE companies SET {set_clause} WHERE id = ?', params)

    # If identifier was changed, store mapping and fetch price
    if identifier_changed and new_identifier and current_company_data:
        current_identifier = current_company_data.get('identifier') if isinstance(current_company_data, dict) else None
        current_company_name = current_company_data.get('name') if isinstance(current_company_data, dict) else None
        
        logger.info(f"Identifier changed for company {company_id} to '{new_identifier}', storing mapping and fetching price...")
        
        # NEW: Try to detect and store identifier mapping
        if current_identifier and current_company_name:
            from ..utils.identifier_mapping import store_identifier_mapping
            from ..utils.identifier_normalization import normalize_identifier
            
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
            from ..utils.identifier_normalization import normalize_identifier
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

        except Exception as e:
            logger.error(f"Error retrieving state: {str(e)}")
            return error_response(str(e), 500)

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

            logger.info(
                f"State saved successfully for account {account_id}, page {page_name}")
            return success_response(message='State saved successfully')

        except Exception as e:
            logger.error(f"Error saving state: {str(e)}")
            return error_response(str(e), 500)

    return error_response('Method not allowed', 405)

# API endpoint to get companies for a specific portfolio

@require_auth
def get_allocate_portfolio_data():
    """API endpoint to get structured portfolio data for the rebalancing feature"""
    logger.info("API request for allocate portfolio data")

    try:
        account_id = g.account_id
        logger.info(f"Getting portfolio data for rebalancing, account_id: {account_id}")

        # Get all portfolios for this account
        try:
            portfolios_data = query_db('''
                SELECT id, name
                FROM portfolios
                WHERE account_id = ? AND name IS NOT NULL
                ORDER BY name
            ''', [account_id])
        except Exception as e:
            logger.error(f"Database error fetching portfolios: {e}")
            raise DataIntegrityError('Failed to fetch portfolio data from database')

        if not portfolios_data:
            logger.warning(f"No portfolios found for account {account_id}")
            return jsonify({'portfolios': []})

        # Get target allocations from expanded_state
        try:
            target_allocation_data = query_db('''
                SELECT variable_value
                FROM expanded_state
                WHERE account_id = ? AND page_name = ? AND variable_name = ?
            ''', [account_id, 'build', 'portfolios'], one=True)
        except Exception as e:
            logger.error(f"Database error fetching target allocations: {e}")
            raise DataIntegrityError('Failed to fetch target allocation data')

        # Parse target allocations if available
        target_allocations = []
        if target_allocation_data and isinstance(target_allocation_data, dict):
            variable_value = target_allocation_data.get('variable_value')
            if variable_value:
                try:
                    target_allocations = json.loads(variable_value)
                    logger.info(
                        f"Found target allocations in expanded_state: {len(target_allocations)} portfolios")
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse target allocations JSON: {e}")
                    raise ValidationError('Invalid target allocation data format')

        # Fetch all portfolio/company data in one query
        try:
            data = query_db('''
                SELECT p.id AS portfolio_id, p.name AS portfolio_name,
                       c.category, c.name AS company_name, c.identifier,
                       cs.shares, cs.override_share,
                       COALESCE(cs.override_share, cs.shares, 0) as effective_shares,
                       mp.price_eur,
                       c.custom_total_value,
                       c.custom_price_eur,
                       c.is_custom_value
                FROM portfolios p
                LEFT JOIN companies c ON c.portfolio_id = p.id AND c.account_id = p.account_id
                LEFT JOIN company_shares cs ON c.id = cs.company_id
                LEFT JOIN market_prices mp ON c.identifier = mp.identifier
                WHERE p.account_id = ? AND p.name IS NOT NULL
                ORDER BY p.name, c.category, c.name
            ''', [account_id])
        except Exception as e:
            logger.error(f"Database error fetching portfolio company data: {e}")
            raise DataIntegrityError('Failed to fetch portfolio company data')

        # Use AllocationService to process the data
        try:
            from app.services.allocation_service import AllocationService

            # Step 1: Get portfolio positions with current values
            portfolio_map, portfolio_builder_data = AllocationService.get_portfolio_positions(
                portfolio_data=data or [],
                target_allocations=target_allocations
            )

            # Calculate total current value across all portfolios
            total_current_value = sum(pdata['currentValue'] for pdata in portfolio_map.values())
            logger.info(f"Total current value across all portfolios: {total_current_value}")

            # Step 2: Calculate allocation targets for each position
            portfolios_with_targets = AllocationService.calculate_allocation_targets(
                portfolio_map=portfolio_map,
                portfolio_builder_data=portfolio_builder_data,
                target_allocations=target_allocations,
                total_current_value=total_current_value
            )

            # Step 3: Generate rebalancing plan
            result = AllocationService.generate_rebalancing_plan(
                portfolios_with_targets=portfolios_with_targets
            )

            logger.info(f"Returning {len(result['portfolios'])} portfolios")
            return jsonify(result)

        except ImportError as e:
            logger.error(f"Failed to import AllocationService: {e}")
            raise ValidationError('Allocation service unavailable')
        except Exception as e:
            logger.error(f"Error in allocation service: {e}")
            raise ValidationError(f'Failed to calculate allocations: {str(e)}')

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
    except KeyError as ke:
        logger.error(
            f"KeyError accessing portfolio data: {str(ke)}", exc_info=True)
        return error_response(f'Session key error: {str(ke)}', 401)
    except Exception as e:
        logger.error(f"Error getting portfolio data: {str(e)}", exc_info=True)
        return error_response(f'Portfolio data could not be loaded: {str(e)}', 500)


@require_auth
def get_country_capacity_data():
    """API endpoint to get country investment capacity data for the rebalancing feature"""
    logger.info("API request for country investment capacity data")

    account_id = g.account_id
    logger.info(f"Getting country capacity data for account_id: {account_id}")

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
        max_per_country = 10  # Default value

        if budget_data and isinstance(budget_data, dict):
            try:
                budget_json = json.loads(budget_data.get('variable_value', '{}'))
                total_investable_capital = float(budget_json.get('totalInvestableCapital', 0))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse budget data: {e}")

        if rules_data and isinstance(rules_data, dict):
            try:
                rules_json = json.loads(rules_data.get('variable_value', '{}'))
                max_per_country = float(rules_json.get('maxPerCountry', 10))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse rules data: {e}")

        logger.info(f"Budget settings - Total Investable Capital: {total_investable_capital}, Max Per Country: {max_per_country}%")

        # Get all user's positions with individual company details by country
        position_data = query_db('''
            SELECT
                COALESCE(c.override_country, mp.country, 'Unknown') as country,
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
            ORDER BY COALESCE(c.override_country, mp.country, 'Unknown'), position_value DESC
        ''', [account_id])

        # Group positions by country
        country_positions = {}
        if position_data:
            for row in position_data:
                country = row['country']
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
                remaining_capacity = max(0, max_per_country_amount - current_invested)
                
                country_capacity.append({
                    'country': country,
                    'current_invested': current_invested,
                    'max_allowed': max_per_country_amount,
                    'remaining_capacity': remaining_capacity,
                    'positions': data['positions']  # Include individual positions for hover
                })

        # Sort by remaining capacity (ascending - least to most capacity)
        country_capacity.sort(key=lambda x: x['remaining_capacity'])

        logger.info(f"Returning country capacity data for {len(country_capacity)} countries")
        return jsonify({
            'countries': country_capacity,
            'total_investable_capital': total_investable_capital,
            'max_per_country_percent': max_per_country
        })

    except Exception as e:
        logger.error(f"Error getting country capacity data: {str(e)}")
        return error_response(str(e), 500)


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
        logger.info(
            f"Getting portfolios for account_id: {account_id}, include_ids: {include_ids}, has_companies: {has_companies}")

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

    except Exception as e:
        logger.error(f"Error getting portfolios: {str(e)}", exc_info=True)
        return error_response(str(e), 500)


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
                    float(shares_val)
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
                    float(override_val)
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
                cursor.execute('''
                    UPDATE companies
                    SET identifier = ?, category = ?, portfolio_id = ?
                    WHERE id = ?
                ''', [
                    new_identifier,
                    item.get('category', ''),
                    portfolio_id,
                    company_id
                ])

                # Handle identifier changes (cleanup and fetch price with cascade)
                if new_identifier and new_identifier != original_identifier:
                    from ..utils.identifier_normalization import normalize_identifier

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

    except Exception as e:
        flash(f'Error managing portfolios: {str(e)}', 'error')

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
                from app.utils.batch_processing import get_job_status
                job_status = get_job_status(job_id)
                
                logger.info(f"DEBUG: Session has job_id={job_id}, job_status={job_status.get('status')}")
                
                # IMMEDIATELY clear failed/cancelled jobs from session to prevent infinite loops
                if job_status.get('status') in ['failed', 'cancelled', 'completed']:
                    logger.info(f"DEBUG: Job {job_id} has terminal status '{job_status.get('status')}', clearing from session IMMEDIATELY")
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
                    # Check if job was cancelled or failed - clean up session immediately
                    if job_status.get('status') in ['cancelled', 'failed']:
                        logger.info(f"DEBUG: Job {job_id} has terminal status '{job_status.get('status')}', clearing from session")
                        if 'csv_upload_job_id' in session:
                            del session['csv_upload_job_id']
                            session.modified = True
                        
                        # Return idle status to stop frontend polling
                        return jsonify({
                            'current': 0,
                            'total': 0,
                            'percentage': 0,
                            'status': 'idle',
                            'message': f'Upload {job_status.get("status")}'
                        })
                    
                    # Convert database format to frontend format
                    progress_data = {
                        'current': job_status.get('progress', 0),
                        'total': job_status.get('total', 100),
                        'percentage': job_status.get('progress', 0),
                        'status': 'processing' if job_status.get('status') == 'processing' else job_status.get('status', 'idle'),
                        'message': job_status.get('message', 'Processing...'),
                        'job_id': job_id
                    }
                    
                    logger.info(f"DEBUG: CSV progress API returning for account {session['account_id']}: {progress_data}")
                    logger.info(f"DEBUG: Original job_status from database: {job_status}")
                    
                    # This logic moved to earlier in the function for immediate cleanup
                    
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
                logger.info(f"Manually clearing CSV upload job {job_id} for account {session['account_id']}")
                del session['csv_upload_job_id']
                session.modified = True
            
            # Also clear legacy session progress if exists
            if 'csv_upload_progress' in session:
                del session['csv_upload_progress']
                session.modified = True
                
            return jsonify({'message': f'CSV upload progress cleared (was tracking job_id: {job_id})'})
    
    except Exception as e:
        logger.error(f"Error handling CSV upload progress: {str(e)}")
        return error_response(str(e), 500)

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
        from app.utils.batch_processing import cancel_background_job
        success = cancel_background_job(job_id)
        
        if success:
            # Clear the job_id from session
            session.pop('csv_upload_job_id', None)
            session.modified = True

            logger.info(f"CSV upload cancelled for account_id: {session['account_id']}, job_id: {job_id}")
            return success_response(message='Upload cancelled successfully')
        else:
            return error_response('Failed to cancel upload', 500)

    except Exception as e:
        logger.error(f"Error cancelling CSV upload: {str(e)}")
        return error_response(str(e), 500)


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

    except Exception as e:
        logger.error(f"Error getting portfolio metrics: {str(e)}")
        return error_response('Failed to get portfolio metrics', 500)
