"""Portfolio data read API — cached portfolio/holdings queries and cache invalidation.

All expensive reads are @cache.memoize'd; writers call invalidate_portfolio_cache().
"""

from flask import request, jsonify, g
from app.db_manager import query_db, execute_db
from app.decorators import require_auth
from app.utils.response_helpers import error_response, not_found_response
from app.exceptions import ValidationError, DataIntegrityError
from app.utils.value_calculator import calculate_portfolio_total, calculate_item_value, has_price_or_custom_value
from app.utils.portfolio_totals import get_portfolio_totals
from app.utils.portfolio_utils import get_portfolio_data, has_companies_in_default
from app.services import allocation_service
from app.repositories.portfolio_repository import PortfolioRepository
from app.cache import cache

import logging
import json
from typing import Dict, Any

logger = logging.getLogger(__name__)

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
        cache.delete_memoized(_get_simulator_portfolio_data_internal, account_id)
        cache.delete_memoized(_get_all_portfolios_data, account_id)
        cache.delete_memoized(PortfolioRepository.get_portfolio_data_with_enrichment, account_id)
        logger.debug(f"Cache invalidated for account_id: {account_id}")
    except Exception as e:
        # Cache invalidation failure is not critical - log full traceback and continue
        logger.exception(f"Failed to invalidate cache for account_id {account_id}")


@cache.memoize(timeout=60)
def _get_simulator_portfolio_data_internal(account_id: int) -> Dict[str, Any]:
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
                c.sector,
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
                es_portfolios.page_name = 'builder' AND
                es_portfolios.variable_name = 'portfolios'
            LEFT JOIN expanded_state es_rules ON
                es_rules.account_id = p.account_id AND
                es_rules.page_name = 'builder' AND
                es_rules.variable_name = 'rules'
            WHERE p.account_id = ? AND p.name IS NOT NULL
            ORDER BY p.name, c.sector, c.name
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

    # Use the allocation service to process the data
    try:
        # Step 1: Get portfolio positions with current values
        portfolio_map, portfolio_builder_data = allocation_service.get_portfolio_positions(
            portfolio_data=data or [],
            target_allocations=target_allocations,
            rules=rules
        )

        # Calculate total current value across all portfolios
        total_current_value = sum(pdata['currentValue'] for pdata in portfolio_map.values())
        logger.info(f"Total current value across all portfolios: {total_current_value}")

        # Step 2: Calculate allocation targets with type constraints
        portfolios_with_targets = allocation_service.calculate_allocation_targets_with_type_constraints(
            portfolio_map=portfolio_map,
            portfolio_builder_data=portfolio_builder_data,
            target_allocations=target_allocations,
            total_current_value=total_current_value,
            rules=rules
        )

        # Step 3: Generate rebalancing plan
        result = allocation_service.generate_rebalancing_plan(
            portfolios_with_targets=portfolios_with_targets
        )

        logger.info(f"Returning {len(result['portfolios'])} portfolios")
        return result

    except ImportError as e:
        logger.error(f"Failed to import allocation service: {e}")
        raise ValidationError('Allocation service unavailable')
    except (ValidationError, DataIntegrityError):
        # Re-raise these so caller can handle them
        raise
    except Exception as e:
        logger.error(f"Error in allocation service: {e}")
        raise ValidationError(f'Failed to calculate allocations: {str(e)}')


@require_auth
def get_simulator_portfolio_data():
    """API endpoint to get structured portfolio data for the rebalancing feature"""
    logger.info("API request for allocate portfolio data")

    try:
        account_id = g.account_id
        result = _get_simulator_portfolio_data_internal(account_id)
        return jsonify(result)

    except ValidationError as e:
        logger.error(f"Validation error in get_simulator_portfolio_data: {e}")
        return error_response(str(e), status=400)

    except DataIntegrityError as e:
        logger.error(f"Data integrity error in get_simulator_portfolio_data: {e}")
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


@cache.memoize(timeout=30)
def _get_all_portfolios_data(account_id: int, fields: str = None) -> dict:
    """
    Get aggregated portfolio data across all portfolios for an account.

    Deduplicates companies by identifier, summing shares and invested amounts.

    Args:
        account_id: User's account ID
        fields: Optional comma-separated fields to return. 'companies' skips
                sector/thesis/portfolio groupings for faster response.

    Returns:
        Dictionary with aggregated portfolio data in the same format as single portfolio
    """
    logger.info(f"Fetching aggregated data for all portfolios, account {account_id}")

    # Fetch all companies across all portfolios
    companies_raw = query_db('''
        SELECT
            c.id, c.name, c.identifier, c.sector, c.thesis, c.investment_type,
            c.total_invested, c.first_bought_date, mp.country, c.override_country,
            COALESCE(c.override_country, mp.country, 'Unknown') as effective_country,
            cs.shares, cs.override_share,
            COALESCE(cs.override_share, cs.shares, 0) as effective_shares,
            mp.price, mp.price_eur, mp.currency, mp.last_updated,
            c.custom_total_value, c.is_custom_value,
            p.name as portfolio_name
        FROM companies c
        LEFT JOIN company_shares cs ON c.id = cs.company_id
        LEFT JOIN market_prices mp ON c.identifier = mp.identifier
        LEFT JOIN portfolios p ON c.portfolio_id = p.id
        WHERE c.account_id = ?
        AND COALESCE(cs.override_share, cs.shares, 0) > 0
    ''', [account_id])

    if not companies_raw:
        return {
            'portfolio_id': 'all',
            'portfolio_name': 'All Portfolios',
            'total_value': 0,
            'total_invested': 0,
            'portfolio_pnl_absolute': None,
            'portfolio_pnl_percentage': None,
            'num_holdings': 0,
            'last_updated': None,
            'companies': [],
            'sectors': [],
            'theses': [],
            'portfolios': []
        }

    companies_only = fields == 'companies'

    # Group by portfolio BEFORE deduplication (for Portfolios tab)
    portfolios_raw = {}
    if not companies_only:
        for company in companies_raw:
            portfolio_name = company.get('portfolio_name') or 'Unknown'
            current_value = float(calculate_item_value(company))
            total_invested = float(company.get('total_invested', 0) or 0)

            if portfolio_name not in portfolios_raw:
                portfolios_raw[portfolio_name] = {
                    'name': portfolio_name,
                    'companies': [],
                    'total_value': 0,
                    'total_invested': 0
                }

            # Create company entry for this portfolio (non-deduplicated)
            company_entry = {
                'name': company['name'],
                'identifier': company['identifier'],
                'sector': company.get('sector'),
                'current_value': current_value,
                'total_invested': total_invested
            }

            portfolios_raw[portfolio_name]['companies'].append(company_entry)
            portfolios_raw[portfolio_name]['total_value'] += current_value
            portfolios_raw[portfolio_name]['total_invested'] += total_invested

    # Deduplicate by identifier - group by identifier and aggregate
    deduped = {}
    for company in companies_raw:
        identifier = company['identifier']
        current_value = float(calculate_item_value(company))
        total_invested = float(company.get('total_invested', 0) or 0)
        effective_shares = float(company.get('effective_shares', 0) or 0)

        if identifier in deduped:
            # Merge: sum shares, invested, and values
            deduped[identifier]['current_value'] += current_value
            deduped[identifier]['total_invested'] += total_invested
            deduped[identifier]['effective_shares'] += effective_shares
            # Track which portfolios contain this company
            if company.get('portfolio_name'):
                deduped[identifier]['portfolios'].add(company['portfolio_name'])
            # Use the most recent last_updated
            if company['last_updated']:
                if deduped[identifier]['last_updated'] is None or company['last_updated'] > deduped[identifier]['last_updated']:
                    deduped[identifier]['last_updated'] = company['last_updated']
            # Keep earliest first_bought_date across portfolios
            if company.get('first_bought_date'):
                existing_date = deduped[identifier].get('first_bought_date')
                if existing_date is None or company['first_bought_date'] < existing_date:
                    deduped[identifier]['first_bought_date'] = company['first_bought_date']
        else:
            # First occurrence - copy company data
            deduped[identifier] = dict(company)
            deduped[identifier]['current_value'] = current_value
            deduped[identifier]['total_invested'] = total_invested
            deduped[identifier]['effective_shares'] = effective_shares
            deduped[identifier]['portfolios'] = {company.get('portfolio_name')} if company.get('portfolio_name') else set()

    # Convert deduped dict to list
    companies = list(deduped.values())

    # Convert portfolio sets to sorted lists for JSON serialization
    for company in companies:
        company['portfolios'] = sorted(company['portfolios'])

    # Sort by current_value descending
    companies.sort(key=lambda c: c['current_value'], reverse=True)

    # Calculate totals and percentages (including cash in denominator)
    holdings_value = sum(c['current_value'] for c in companies)
    totals = get_portfolio_totals(account_id, holdings_value)
    total_value = holdings_value  # Keep for backwards compatibility in return value
    portfolio_total = totals['total']  # Use this for percentages (includes cash)

    for company in companies:
        company['percentage'] = (
            (float(company['current_value']) / portfolio_total * 100)
            if portfolio_total > 0 else 0
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

    if companies_only:
        # Fast path: skip groupings, just return companies
        last_updated = max((c['last_updated'] for c in companies if c['last_updated']), default=None)
        logger.info(f"Returning {len(companies)} unique companies (companies-only mode)")
        return {
            'portfolio_id': 'all',
            'portfolio_name': 'All Portfolios',
            'total_value': total_value,
            'cash': totals['cash'],
            'portfolio_total': portfolio_total,
            'total_invested': sum(float(c.get('total_invested', 0)) for c in companies),
            'num_holdings': len(companies),
            'last_updated': last_updated,
            'companies': companies,
            'sectors': [],
            'theses': [],
            'portfolios': []
        }

    # Group by sector
    sectors = {}
    for company in companies:
        sector_name = company['sector'] or 'Uncategorized'
        if sector_name not in sectors:
            sectors[sector_name] = {
                'name': sector_name,
                'companies': [],
                'total_value': 0,
                'total_invested': 0
            }
        sectors[sector_name]['companies'].append(company)
        sectors[sector_name]['total_value'] += float(company['current_value'])
        sectors[sector_name]['total_invested'] += float(company.get('total_invested', 0))

    # Convert sectors to list and calculate percentages (using portfolio_total which includes cash)
    sectors_list = []
    for sector_data in sectors.values():
        sector_data['percentage'] = (
            (sector_data['total_value'] / portfolio_total * 100)
            if portfolio_total > 0 else 0
        )

        # Calculate sector P&L
        if sector_data['total_invested'] > 0:
            pnl_absolute = sector_data['total_value'] - sector_data['total_invested']
            pnl_percentage = (pnl_absolute / sector_data['total_invested']) * 100
            sector_data['pnl_absolute'] = pnl_absolute
            sector_data['pnl_percentage'] = pnl_percentage
        else:
            sector_data['pnl_absolute'] = None
            sector_data['pnl_percentage'] = None

        sector_data['companies'].sort(key=lambda x: x['current_value'], reverse=True)
        sectors_list.append(sector_data)

    sectors_list.sort(key=lambda x: x['total_value'], reverse=True)

    # Group by thesis
    theses = {}
    for company in companies:
        thesis_name = (company.get('thesis') or '').strip() or 'Unassigned'
        if thesis_name not in theses:
            theses[thesis_name] = {
                'name': thesis_name,
                'companies': [],
                'total_value': 0,
                'total_invested': 0
            }
        theses[thesis_name]['companies'].append(company)
        theses[thesis_name]['total_value'] += float(company['current_value'])
        theses[thesis_name]['total_invested'] += float(company.get('total_invested', 0) or 0)

    # Convert theses to list and calculate percentages (using portfolio_total which includes cash)
    theses_list = []
    for thesis_data in theses.values():
        thesis_data['percentage'] = (
            (thesis_data['total_value'] / portfolio_total * 100)
            if portfolio_total > 0 else 0
        )

        # Calculate thesis P&L
        if thesis_data['total_invested'] > 0:
            pnl_absolute = thesis_data['total_value'] - thesis_data['total_invested']
            pnl_percentage = (pnl_absolute / thesis_data['total_invested']) * 100
            thesis_data['pnl_absolute'] = pnl_absolute
            thesis_data['pnl_percentage'] = pnl_percentage
        else:
            thesis_data['pnl_absolute'] = None
            thesis_data['pnl_percentage'] = None

        thesis_data['companies'].sort(key=lambda x: x['current_value'], reverse=True)
        theses_list.append(thesis_data)

    theses_list.sort(key=lambda x: x['total_value'], reverse=True)

    # Convert portfolios_raw to list and calculate percentages (using portfolio_total which includes cash)
    portfolios_list = []
    for portfolio_data in portfolios_raw.values():
        portfolio_data['percentage'] = (
            (portfolio_data['total_value'] / portfolio_total * 100)
            if portfolio_total > 0 else 0
        )

        # Calculate portfolio P&L
        if portfolio_data['total_invested'] > 0:
            pnl_absolute = portfolio_data['total_value'] - portfolio_data['total_invested']
            pnl_percentage = (pnl_absolute / portfolio_data['total_invested']) * 100
            portfolio_data['pnl_absolute'] = pnl_absolute
            portfolio_data['pnl_percentage'] = pnl_percentage
        else:
            portfolio_data['pnl_absolute'] = None
            portfolio_data['pnl_percentage'] = None

        # Calculate per-company percentages within portfolio
        for company in portfolio_data['companies']:
            company['percentage'] = (
                (company['current_value'] / portfolio_data['total_value'] * 100)
                if portfolio_data['total_value'] > 0 else 0
            )
            # P&L for each company
            ti = float(company.get('total_invested', 0) or 0)
            if ti > 0:
                company['pnl_absolute'] = company['current_value'] - ti
                company['pnl_percentage'] = (company['pnl_absolute'] / ti) * 100
            else:
                company['pnl_absolute'] = None
                company['pnl_percentage'] = None

        portfolio_data['companies'].sort(key=lambda x: x['current_value'], reverse=True)
        portfolios_list.append(portfolio_data)

    portfolios_list.sort(key=lambda x: x['total_value'], reverse=True)

    # Calculate total portfolio P&L
    total_invested = sum(float(c.get('total_invested', 0)) for c in companies)
    if total_invested > 0:
        portfolio_pnl_absolute = total_value - total_invested
        portfolio_pnl_percentage = (portfolio_pnl_absolute / total_invested) * 100
    else:
        portfolio_pnl_absolute = None
        portfolio_pnl_percentage = None

    # Get the most recent last_updated across all companies
    last_updated = max((c['last_updated'] for c in companies if c['last_updated']), default=None)

    logger.info(f"Returning {len(companies)} unique companies from all portfolios ({len(sectors_list)} sectors, {len(theses_list)} theses, {len(portfolios_list)} portfolios)")

    return {
        'portfolio_id': 'all',
        'portfolio_name': 'All Portfolios',
        'total_value': total_value,
        'cash': totals['cash'],
        'portfolio_total': portfolio_total,  # Holdings + cash (for percentage calculations)
        'total_invested': total_invested,
        'portfolio_pnl_absolute': portfolio_pnl_absolute,
        'portfolio_pnl_percentage': portfolio_pnl_percentage,
        'num_holdings': len(companies),
        'last_updated': last_updated,
        'companies': companies,
        'sectors': sectors_list,
        'theses': theses_list,
        'portfolios': portfolios_list
    }


@require_auth
def get_single_portfolio_data_api(portfolio_id):
    """
    Get portfolio data for a single portfolio or all portfolios combined.
    Returns companies, categories, and summary statistics.

    This endpoint is used by the Portfolio Analysis page dropdown selector
    to load data on-demand for the selected portfolio.

    Args:
        portfolio_id: Portfolio ID from URL path, or 'all' for aggregated view

    Returns:
        JSON response with:
        - portfolio_id: Portfolio ID (or 'all')
        - portfolio_name: Portfolio name (or 'All Portfolios')
        - total_value: Sum of all position values
        - num_holdings: Number of companies (unique if 'all')
        - last_updated: Most recent price update timestamp
        - companies: List of company objects with percentages
        - sectors: List of sector aggregations
        - theses: List of thesis aggregations

    Errors:
        404: Portfolio not found or doesn't belong to user
        500: Internal server error
    """
    try:
        account_id = g.account_id

        # Handle "all portfolios" aggregation
        if portfolio_id == 'all':
            fields = request.args.get('fields')
            response_data = _get_all_portfolios_data(account_id, fields=fields)
            return jsonify(response_data)

        # Validate portfolio_id is a valid integer
        try:
            portfolio_id_int = int(portfolio_id)
        except (ValueError, TypeError):
            logger.warning(f"Invalid portfolio_id format: {portfolio_id}")
            return not_found_response(f'Portfolio {portfolio_id} not found')

        logger.info(f"Fetching data for portfolio {portfolio_id_int}, account {account_id}")

        # Verify portfolio belongs to account
        portfolio = query_db('''
            SELECT id, name
            FROM portfolios
            WHERE id = ? AND account_id = ?
        ''', [portfolio_id_int, account_id], one=True)

        if not portfolio:
            logger.warning(f"Portfolio {portfolio_id} not found for account {account_id}")
            return not_found_response(f'Portfolio {portfolio_id} not found')

        # Fetch companies for this portfolio
        # Note: We fetch mp.price (native currency) and mp.currency to allow Python
        # to calculate values using consistent daily exchange rates via calculate_item_value()
        companies = query_db('''
            SELECT
                c.id, c.name, c.identifier, c.sector, c.thesis, c.investment_type,
                c.total_invested, c.first_bought_date, mp.country, c.override_country,
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

        # Calculate totals and percentages (including cash in denominator)
        holdings_value = sum(c['current_value'] for c in companies)
        totals = get_portfolio_totals(account_id, holdings_value)
        total_value = holdings_value  # Keep for backwards compatibility in return value
        portfolio_total = totals['total']  # Use this for percentages (includes cash)

        for company in companies:
            company['percentage'] = (
                (float(company['current_value']) / portfolio_total * 100)
                if portfolio_total > 0 else 0
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

        # Group by sector
        sectors = {}
        for company in companies:
            sector_name = company['sector'] or 'Uncategorized'
            if sector_name not in sectors:
                sectors[sector_name] = {
                    'name': sector_name,
                    'companies': [],
                    'total_value': 0,
                    'total_invested': 0
                }
            sectors[sector_name]['companies'].append(company)
            sectors[sector_name]['total_value'] += float(company['current_value'])
            sectors[sector_name]['total_invested'] += float(company.get('total_invested', 0))

        # Convert to list and calculate percentages (using portfolio_total which includes cash)
        sectors_list = []
        for sector_data in sectors.values():
            sector_data['percentage'] = (
                (sector_data['total_value'] / portfolio_total * 100)
                if portfolio_total > 0 else 0
            )

            # Calculate sector P&L
            if sector_data['total_invested'] > 0:
                pnl_absolute = sector_data['total_value'] - sector_data['total_invested']
                pnl_percentage = (pnl_absolute / sector_data['total_invested']) * 100
                sector_data['pnl_absolute'] = pnl_absolute
                sector_data['pnl_percentage'] = pnl_percentage
            else:
                sector_data['pnl_absolute'] = None
                sector_data['pnl_percentage'] = None

            sector_data['companies'].sort(key=lambda x: x['current_value'], reverse=True)
            sectors_list.append(sector_data)

        sectors_list.sort(key=lambda x: x['total_value'], reverse=True)

        # Group by thesis (similar to sector grouping)
        theses = {}
        for company in companies:
            thesis_name = (company.get('thesis') or '').strip() or 'Unassigned'
            if thesis_name not in theses:
                theses[thesis_name] = {
                    'name': thesis_name,
                    'companies': [],
                    'total_value': 0,
                    'total_invested': 0
                }
            theses[thesis_name]['companies'].append(company)
            theses[thesis_name]['total_value'] += float(company['current_value'])
            theses[thesis_name]['total_invested'] += float(company.get('total_invested', 0) or 0)

        # Convert to list and calculate percentages for theses (using portfolio_total which includes cash)
        theses_list = []
        for thesis_data in theses.values():
            thesis_data['percentage'] = (
                (thesis_data['total_value'] / portfolio_total * 100)
                if portfolio_total > 0 else 0
            )

            # Calculate thesis P&L
            if thesis_data['total_invested'] > 0:
                pnl_absolute = thesis_data['total_value'] - thesis_data['total_invested']
                pnl_percentage = (pnl_absolute / thesis_data['total_invested']) * 100
                thesis_data['pnl_absolute'] = pnl_absolute
                thesis_data['pnl_percentage'] = pnl_percentage
            else:
                thesis_data['pnl_absolute'] = None
                thesis_data['pnl_percentage'] = None

            thesis_data['companies'].sort(key=lambda x: x['current_value'], reverse=True)
            theses_list.append(thesis_data)

        theses_list.sort(key=lambda x: x['total_value'], reverse=True)

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
            'cash': totals['cash'],
            'portfolio_total': portfolio_total,  # Holdings + cash (for percentage calculations)
            'total_invested': total_invested,
            'portfolio_pnl_absolute': portfolio_pnl_absolute,
            'portfolio_pnl_percentage': portfolio_pnl_percentage,
            'num_holdings': len(companies),
            'last_updated': max((c['last_updated'] for c in companies if c['last_updated']), default=None),
            'companies': companies,
            'sectors': sectors_list,
            'theses': theses_list
        }

        logger.info(f"Returning {len(companies)} companies in {len(sectors_list)} sectors and {len(theses_list)} theses for portfolio {portfolio_id}")
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
                    WHERE account_id = ? AND page_name = 'builder' AND variable_name = 'portfolios'
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

                    if portfolio_id:
                        portfolios.append({'id': portfolio_id, 'name': '-'})
                        logger.info(
                            "Created and added '-' portfolio to the response")
                    else:
                        logger.error("Failed to create '-' portfolio - execute_db returned None")

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
