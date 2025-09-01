from flask import (
    Blueprint, render_template, redirect, url_for,
    request, flash, session, jsonify, current_app
)
import logging
from app.db_manager import query_db
from app.routes.portfolio_api import (
    get_portfolios_api, get_portfolio_data_api, manage_state,
    get_allocate_portfolio_data, update_portfolio_api, upload_csv, manage_portfolios, csv_upload_progress, cancel_csv_upload, get_portfolio_metrics
)
from app.routes.portfolio_updates import update_price_api, update_single_portfolio_api, bulk_update, get_portfolio_companies, update_all_prices, price_fetch_progress, price_update_status
from app.utils.data_processing import clear_data_caches
from app.utils.portfolio_utils import get_portfolio_data, has_companies_in_default

# Set up logger
logger = logging.getLogger(__name__)

portfolio_bp = Blueprint('portfolio', __name__,
                         url_prefix='/portfolio',
                         template_folder='../../templates')

# Ensure session persistence


@portfolio_bp.before_request
def make_session_permanent():
    session.permanent = True  # This makes the session last longer
    session.modified = True   # This ensures changes are saved


@portfolio_bp.route('/enrich')
def enrich():
    """Portfolio data enrichment page"""
    logger.info("Accessing enrich page")

    # Check if user is authenticated with an account
    if 'account_id' not in session:
        logger.warning("No account_id in session")
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    logger.info(f"Loading enrich page for account_id: {account_id}")

    # Verify account exists
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)
    if not account:
        logger.warning(f"Account {account_id} not found")
        flash('Account not found', 'error')
        return redirect(url_for('main.index'))

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

    # Log template variables for debugging
    logger.debug(f"Template variables:")
    logger.debug(f"- portfolio_data: {portfolio_data}")
    logger.debug(f"- portfolios: {[p['name'] for p in portfolios]}")

    # Calculate metrics safely handling None values
    last_updates = [item['last_updated']
                    for item in portfolio_data if item['last_updated'] is not None]
    total_value = sum(
        (item['price_eur'] or 0) * (item['effective_shares'] or 0)
        for item in portfolio_data
    )
    missing_prices = sum(1 for item in portfolio_data if not item['price_eur'])
    total_items = len(portfolio_data)
    health = int(((total_items - missing_prices) /
                 total_items * 100) if total_items > 0 else 100)

    # Check if we should use the default portfolio
    use_default_portfolio = session.pop('use_default_portfolio', False)

    return render_template('pages/enrich.html',
                           portfolio_data=portfolio_data,
                           portfolios=[p['name'] for p in portfolios],
                           use_default_portfolio=use_default_portfolio,
                           metrics={
                               'total': total_items,
                               'health': health,
                               'missing': missing_prices,
                               'totalValue': total_value,
                               'lastUpdate': max(last_updates) if last_updates else None
                           })


@portfolio_bp.route('/risk_overview')
def risk_overview():
    """Risk overview page with global portfolio allocation visualizations"""
    logger.info("Accessing risk overview page")

    # Check if user is authenticated with an account
    if 'account_id' not in session:
        logger.warning("No account_id in session")
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    logger.info(f"Loading risk overview page for account_id: {account_id}")

    # Verify account exists
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)
    if not account:
        logger.warning(f"Account {account_id} not found")
        flash('Account not found', 'error')
        return redirect(url_for('main.index'))

    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    return render_template('pages/risk_overview.html')


@portfolio_bp.route('/analyse')
def analyse():
    """Portfolio analysis page"""
    logger.info("Accessing analyse page")

    # Check if user is authenticated with an account
    if 'account_id' not in session:
        logger.warning("No account_id in session")
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    logger.info(f"Loading analyse page for account_id: {account_id}")

    # Verify account exists
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)
    if not account:
        logger.warning(f"Account {account_id} not found")
        flash('Account not found', 'error')
        return redirect(url_for('main.index'))

    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    return render_template('pages/analyse.html')

# Route to serve the build.html page


@portfolio_bp.route('/build')
def build():
    """Portfolio Allocation Builder page"""
    logger.info("Accessing allocation builder page")

    # Check if user is authenticated with an account
    if 'account_id' not in session:
        logger.warning("No account_id in session")
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    logger.info(
        f"Loading allocation builder page for account_id: {account_id}")

    # Verify account exists
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)
    if not account:
        logger.warning(f"Account {account_id} not found")
        flash('Account not found', 'error')
        return redirect(url_for('main.index'))

    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    # Pass empty data that Vue.js will replace
    position = {'companyName': ''}  # Placeholder to avoid Jinja2 errors

    return render_template('pages/build.html', position=position)

# Route to serve the allocate.html page


@portfolio_bp.route('/allocate')
def allocate():
    """Portfolio Rebalancer page"""
    logger.info("Accessing portfolio rebalancer page")

    # Check if user is authenticated with an account
    if 'account_id' not in session:
        logger.warning("No account_id in session")
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    logger.info(
        f"Loading portfolio rebalancer page for account_id: {account_id}")

    # Verify account exists
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)
    if not account:
        logger.warning(f"Account {account_id} not found")
        flash('Account not found', 'error')
        return redirect(url_for('main.index'))

    if isinstance(account, dict):
        logger.info(f"Account found: {account.get('username', '')}")

    return render_template('pages/allocate.html')


# Register API routes with the blueprint
portfolio_bp.add_url_rule(
    '/api/state', view_func=manage_state, methods=['GET', 'POST'])
portfolio_bp.add_url_rule(
    '/api/portfolio_companies/<int:portfolio_id>', view_func=get_portfolio_companies)
portfolio_bp.add_url_rule('/api/portfolio_data',
                          view_func=get_portfolio_data_api, methods=['GET'])
portfolio_bp.add_url_rule('/api/allocate/portfolio-data',
                          view_func=get_allocate_portfolio_data)
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
