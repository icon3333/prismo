from flask import (
    Blueprint, redirect,
    session, g
)
import logging
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
    simulator_search_investments, simulator_clone_portfolio,
    builder_investment_targets,
    get_account_cash, set_account_cash,
    add_company, validate_identifier, delete_manual_companies, get_portfolios_for_dropdown,
    get_historical_prices_api,
    get_account_info, update_account_username, api_reset_account_settings,
    api_delete_stocks_crypto, api_delete_account, api_import_account_data
)
from app.routes.portfolio_updates import update_price_api, update_single_portfolio_api, bulk_update, get_portfolio_companies, update_all_prices, update_selected_prices, price_fetch_progress, price_update_status
from app.utils.data_processing import clear_data_caches

# Set up logger
logger = logging.getLogger(__name__)

portfolio_bp = Blueprint('portfolio', __name__,
                         url_prefix='/portfolio')


# Ensure session persistence


@portfolio_bp.before_request
def make_session_permanent():
    session.permanent = True  # This makes the session last longer
    session.modified = True   # This ensures changes are saved


# Backward-compatibility redirects for old URLs
@portfolio_bp.route('/analyse')
@require_auth
def analyse_redirect():
    return redirect('/portfolio/performance', code=301)

@portfolio_bp.route('/build')
@require_auth
def build_redirect():
    return redirect('/portfolio/builder', code=301)

@portfolio_bp.route('/allocate')
@require_auth
def allocate_redirect():
    return redirect('/portfolio/rebalancer', code=301)

@portfolio_bp.route('/risk_overview')
@require_auth
def risk_overview_redirect():
    return redirect('/portfolio/concentrations', code=301)

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
portfolio_bp.add_url_rule('/api/simulator/search-investments',
                          view_func=simulator_search_investments, methods=['GET'])
portfolio_bp.add_url_rule('/api/simulator/clone-portfolio',
                          view_func=simulator_clone_portfolio, methods=['POST'])
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
# Historical Prices API
portfolio_bp.add_url_rule('/api/historical_prices',
                          view_func=get_historical_prices_api, methods=['GET'])
# Account Management API
portfolio_bp.add_url_rule('/api/account',
                          view_func=get_account_info, methods=['GET'])
portfolio_bp.add_url_rule('/api/account/username',
                          view_func=update_account_username, methods=['PUT'])
portfolio_bp.add_url_rule('/api/account/reset-settings',
                          view_func=api_reset_account_settings, methods=['POST'])
portfolio_bp.add_url_rule('/api/account/delete-stocks-crypto',
                          view_func=api_delete_stocks_crypto, methods=['POST'])
portfolio_bp.add_url_rule('/api/account/delete',
                          view_func=api_delete_account, methods=['POST'])
portfolio_bp.add_url_rule('/api/account/import',
                          view_func=api_import_account_data, methods=['POST'])
