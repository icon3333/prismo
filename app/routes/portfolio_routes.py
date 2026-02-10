from flask import (
    Blueprint, render_template, redirect, url_for,
    request, flash, session, jsonify, current_app, g
)
import logging
import requests
from app.db_manager import query_db
from app.decorators import require_auth
from app.cache import cache
from app.routes.portfolio_api import (
    get_portfolios_api, get_portfolio_data_api, get_single_portfolio_data_api, manage_state,
    get_simulator_portfolio_data, get_country_capacity_data, get_sector_capacity_data,
    get_effective_capacity_data, update_portfolio_api, upload_csv, manage_portfolios,
    csv_upload_progress, cancel_csv_upload, get_portfolio_metrics, get_investment_type_distribution,
    simulator_ticker_lookup, simulator_portfolio_allocations,
    simulator_simulations_list, simulator_simulation_create, simulator_simulation_get,
    simulator_simulation_update, simulator_simulation_delete,
    builder_investment_targets,
    get_account_cash, set_account_cash,
    add_company, validate_identifier, delete_manual_companies, get_portfolios_for_dropdown
)
from app.routes.portfolio_updates import update_price_api, update_single_portfolio_api, bulk_update, get_portfolio_companies, update_all_prices, update_selected_prices, price_fetch_progress, price_update_status
from app.utils.data_processing import clear_data_caches
from app.utils.portfolio_utils import get_portfolio_data, has_companies_in_default

# Set up logger
logger = logging.getLogger(__name__)

# Cache timeout constants (in seconds)
CACHE_TIMEOUT_COUNTRIES_API = 86400  # 24 hours - country list rarely changes

portfolio_bp = Blueprint('portfolio', __name__,
                         url_prefix='/portfolio',
                         template_folder='../../templates')


# Helper function to fetch countries from external API with caching and fallback
@cache.memoize(timeout=CACHE_TIMEOUT_COUNTRIES_API)
def _fetch_countries_from_api():
    """
    Fetch country list from REST Countries API with proper error handling.

    Returns:
        list: List of country names, starting with '(crypto)'
    """
    # Minimal fallback list in case API is down
    FALLBACK_COUNTRIES = [
        '(crypto)', 'United States', 'United Kingdom', 'Germany', 'France',
        'Japan', 'China', 'Canada', 'Australia', 'Switzerland', 'Netherlands',
        'Sweden', 'Denmark', 'Norway', 'Singapore', 'Hong Kong'
    ]

    try:
        # Reduced timeout from 10s to 3s - API typically responds in <1s
        response = requests.get(
            'https://restcountries.com/v3.1/all?fields=name',
            timeout=3
        )
        response.raise_for_status()  # Raise exception for 4xx/5xx status codes

        api_countries = response.json()
        countries = ['(crypto)']  # Always include crypto first

        # Extract country names and sort them
        country_names = []
        for country in api_countries:
            if 'name' in country and 'common' in country['name']:
                name = country['name']['common']
                # Skip duplicates and clean up names
                if name not in country_names and name != '(crypto)':
                    country_names.append(name)

        # Sort alphabetically and add to list
        country_names.sort()
        countries.extend(country_names)

        logger.info(f"Successfully loaded {len(countries)} countries from REST Countries API")
        return countries

    except requests.Timeout:
        logger.warning("REST Countries API timeout after 3s, using fallback list")
        return FALLBACK_COUNTRIES
    except requests.RequestException as e:
        logger.warning(f"REST Countries API request failed: {e}, using fallback list")
        return FALLBACK_COUNTRIES
    except (ValueError, KeyError) as e:
        logger.error(f"Failed to parse REST Countries API response: {e}, using fallback list")
        return FALLBACK_COUNTRIES


# Ensure session persistence


@portfolio_bp.before_request
def make_session_permanent():
    session.permanent = True  # This makes the session last longer
    session.modified = True   # This ensures changes are saved


@portfolio_bp.route('/enrich')
@require_auth
def enrich():
    """Portfolio data enrichment page"""
    logger.info("Accessing enrich page")

    account_id = g.account_id
    logger.info(f"Loading enrich page for account_id: {account_id}")

    account = g.account
    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    # Get portfolio data
    portfolio_data = get_portfolio_data(account_id)
    logger.info(f"Retrieved {len(portfolio_data)} portfolio items")

    # Get portfolios from the portfolios table
    portfolios_from_table = query_db('''
        SELECT name FROM portfolios 
        WHERE account_id = ? AND name IS NOT NULL
        ORDER BY name
    ''', [account_id])

    # Extract portfolio names without filtering out any valid names
    portfolios = [{'name': p['name']} for p in portfolios_from_table] if portfolios_from_table else []

    # Ensure '-' is in the list
    has_default = any(p['name'] == '-' for p in portfolios)
    if not has_default:
        default_exists = query_db('''
            SELECT 1 FROM portfolios
            WHERE account_id = ? AND name = '-'
        ''', [account_id], one=True)

        if default_exists:
            portfolios.append({'name': '-'})
            logger.info("Added '-' portfolio to the enrich page data")

    logger.info(
        f"Retrieved {len(portfolios)} portfolios from the portfolios table: {[p['name'] for p in portfolios]}")

    # Get comprehensive country list from REST Countries API (cached with fallback)
    countries = _fetch_countries_from_api()

    # Log template variables for debugging
    logger.info(f"Template variables for enrich page:")
    logger.info(f"- portfolio_data: {len(portfolio_data)} items")
    logger.info(f"- portfolios: {[p['name'] for p in portfolios]}")
    logger.info(f"- countries: {len(countries)} countries loaded - first 5: {countries[:5]}")

    # Calculate metrics safely handling None values
    last_updates = [item['last_updated']
                    for item in portfolio_data if item['last_updated'] is not None]
    total_value = sum(
        (item['price_eur'] or 0) * (item['effective_shares'] or 0)
        for item in portfolio_data
    )
    missing_prices = sum(1 for item in portfolio_data if not item['price_eur'])
    total_items = len(portfolio_data)
    # Health metric: percentage of items with prices (0 if no items exist)
    health = int((total_items - missing_prices) / total_items * 100) if total_items > 0 else 0

    # Check if we should use the default portfolio
    use_default_portfolio = session.pop('use_default_portfolio', False)

    return render_template('pages/enrich.html',
                           portfolio_data=portfolio_data,
                           portfolios=[p['name'] for p in portfolios],
                           countries=countries,
                           use_default_portfolio=use_default_portfolio,
                           metrics={
                               'total': total_items,
                               'health': health,
                               'missing': missing_prices,
                               'totalValue': total_value,
                               'lastUpdate': max(last_updates) if last_updates else None
                           })


@portfolio_bp.route('/risk_overview')
@require_auth
def risk_overview():
    """Risk overview page with global portfolio allocation visualizations"""
    logger.info("Accessing risk overview page")

    account_id = g.account_id
    logger.info(f"Loading risk overview page for account_id: {account_id}")

    account = g.account
    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    return render_template('pages/risk_overview.html')


@portfolio_bp.route('/performance')
@require_auth
def performance():
    """Portfolio performance page"""
    logger.info("Accessing performance page")

    account_id = g.account_id
    logger.info(f"Loading performance page for account_id: {account_id}")

    account = g.account
    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    return render_template('pages/performance.html')

@portfolio_bp.route('/builder')
@require_auth
def builder():
    """Builder page - configure portfolio allocation targets"""
    logger.info("Accessing Builder page")

    account_id = g.account_id
    logger.info(f"Loading Builder page for account_id: {account_id}")

    account = g.account
    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    # Pass empty data that Vue.js will replace
    position = {'companyName': ''}  # Placeholder to avoid Jinja2 errors

    return render_template('pages/builder.html', position=position)

@portfolio_bp.route('/simulator')
@require_auth
def simulator():
    """Simulator page - test allocation strategies"""
    logger.info("Accessing Simulator page")

    account_id = g.account_id
    logger.info(f"Loading Simulator page for account_id: {account_id}")

    account = g.account
    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    return render_template('pages/simulator.html')


# Backward-compatibility redirects for old URLs
@portfolio_bp.route('/analyse')
@require_auth
def analyse_redirect():
    return redirect(url_for('portfolio.performance'), code=301)

@portfolio_bp.route('/build')
@require_auth
def build_redirect():
    return redirect(url_for('portfolio.builder'), code=301)

@portfolio_bp.route('/allocate')
@require_auth
def allocate_redirect():
    return redirect(url_for('portfolio.simulator'), code=301)

@portfolio_bp.route('/api/allocate/<path:subpath>')
@require_auth
def allocate_api_redirect(subpath):
    return redirect(f'/portfolio/api/simulator/{subpath}', code=301)


# Register API routes with the blueprint
portfolio_bp.add_url_rule(
    '/api/state', view_func=manage_state, methods=['GET', 'POST'])
portfolio_bp.add_url_rule(
    '/api/portfolio_companies/<int:portfolio_id>', view_func=get_portfolio_companies)
portfolio_bp.add_url_rule('/api/portfolio_data',
                          view_func=get_portfolio_data_api, methods=['GET'])
portfolio_bp.add_url_rule('/api/simulator/portfolio-data',
                          view_func=get_simulator_portfolio_data)
portfolio_bp.add_url_rule('/api/simulator/country-capacity',
                          view_func=get_country_capacity_data)
portfolio_bp.add_url_rule('/api/simulator/sector-capacity',
                          view_func=get_sector_capacity_data)
portfolio_bp.add_url_rule('/api/simulator/effective-capacity',
                          view_func=get_effective_capacity_data)
portfolio_bp.add_url_rule('/api/portfolios', view_func=get_portfolios_api)
# Simple upload - no background complexity
from app.routes.simple_upload import upload_csv_simple, get_simple_upload_progress
portfolio_bp.add_url_rule('/upload', 'upload_csv', upload_csv_simple, methods=['POST'])
portfolio_bp.add_url_rule('/api/simple_upload_progress', 'simple_upload_progress', get_simple_upload_progress, methods=['GET', 'DELETE'])
portfolio_bp.add_url_rule('/api/update_portfolio',
                          view_func=update_portfolio_api, methods=['POST'])
portfolio_bp.add_url_rule('/manage_portfolios',
                          view_func=manage_portfolios, methods=['POST'])
portfolio_bp.add_url_rule('/api/update_price/<int:company_id>',
                          view_func=update_price_api, methods=['POST'])
portfolio_bp.add_url_rule('/api/update_portfolio/<int:company_id>',
                          view_func=update_single_portfolio_api, methods=['POST'])
portfolio_bp.add_url_rule(
    '/api/bulk_update', view_func=bulk_update, methods=['POST'])
portfolio_bp.add_url_rule('/api/update_all_prices',
                          view_func=update_all_prices, methods=['POST'])
portfolio_bp.add_url_rule('/api/update_selected_prices',
                          view_func=update_selected_prices, methods=['POST'])
portfolio_bp.add_url_rule('/api/price_fetch_progress',
                          view_func=price_fetch_progress, methods=['GET'])
portfolio_bp.add_url_rule('/api/csv_upload_progress',
                          view_func=csv_upload_progress, methods=['GET', 'DELETE'])
portfolio_bp.add_url_rule('/api/cancel_csv_upload',
                          view_func=cancel_csv_upload, methods=['POST'])
portfolio_bp.add_url_rule('/api/price_update_status/<string:job_id>',
                          view_func=price_update_status, methods=['GET'])
portfolio_bp.add_url_rule('/api/portfolio_metrics',
                          view_func=get_portfolio_metrics, methods=['GET'])
portfolio_bp.add_url_rule('/api/investment_type_distribution',
                          view_func=get_investment_type_distribution, methods=['GET'])
portfolio_bp.add_url_rule('/api/portfolio_data/<portfolio_id>',
                          view_func=get_single_portfolio_data_api, methods=['GET'])
# Allocation Simulator API
portfolio_bp.add_url_rule('/api/simulator/ticker-lookup',
                          view_func=simulator_ticker_lookup, methods=['POST'])
portfolio_bp.add_url_rule('/api/simulator/portfolio-allocations',
                          view_func=simulator_portfolio_allocations, methods=['GET'])
# Saved Simulations CRUD
portfolio_bp.add_url_rule('/api/simulator/simulations',
                          view_func=simulator_simulations_list, methods=['GET'])
portfolio_bp.add_url_rule('/api/simulator/simulations',
                          view_func=simulator_simulation_create, methods=['POST'])
portfolio_bp.add_url_rule('/api/simulator/simulations/<int:simulation_id>',
                          view_func=simulator_simulation_get, methods=['GET'])
portfolio_bp.add_url_rule('/api/simulator/simulations/<int:simulation_id>',
                          view_func=simulator_simulation_update, methods=['PUT'])
portfolio_bp.add_url_rule('/api/simulator/simulations/<int:simulation_id>',
                          view_func=simulator_simulation_delete, methods=['DELETE'])
# Builder API (for cross-page integration)
portfolio_bp.add_url_rule('/api/builder/investment-targets',
                          view_func=builder_investment_targets, methods=['GET'])
# Account Cash API
portfolio_bp.add_url_rule('/api/account/cash',
                          view_func=get_account_cash, methods=['GET'])
portfolio_bp.add_url_rule('/api/account/cash',
                          view_func=set_account_cash, methods=['POST'])
# Manual Stock Management API
portfolio_bp.add_url_rule('/api/add_company',
                          view_func=add_company, methods=['POST'])
portfolio_bp.add_url_rule('/api/validate_identifier',
                          view_func=validate_identifier, methods=['GET'])
portfolio_bp.add_url_rule('/api/delete_companies',
                          view_func=delete_manual_companies, methods=['POST'])
portfolio_bp.add_url_rule('/api/portfolios_dropdown',
                          view_func=get_portfolios_for_dropdown, methods=['GET'])
