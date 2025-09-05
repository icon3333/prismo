from flask import request, session, jsonify
from app.db_manager import query_db, backup_database, get_db
from app.utils.portfolio_utils import get_stock_info
from app.utils.db_utils import update_price_in_db
from app.utils.batch_processing import start_batch_process, get_job_status, get_latest_job_progress
import logging

logger = logging.getLogger(__name__)


def update_price_api(company_id: int):
    """API endpoint to update a company's price by its ID."""
    logger.info(f"Price update requested for company_id: {company_id}")
    
    if 'account_id' not in session:
        logger.warning(f"Authentication failed for price update request - no account_id in session")
        return jsonify({'error': 'Not authenticated'}), 401

    account_id = session['account_id']
    logger.info(f"Processing price update for company_id: {company_id}, account_id: {account_id}")

    try:
        # Fetch the identifier for the given company_id, ensuring it belongs to the current user
        company = query_db(
            'SELECT identifier FROM companies WHERE id = ? AND account_id = ?',
            [company_id, account_id],
            one=True
        )

        if not company:
            logger.warning(f"Company {company_id} not found or access denied for account {account_id}")
            return jsonify({'error': 'Company not found or access denied'}), 404

        identifier = company['identifier'] if isinstance(company, dict) else None
        if not identifier:
            logger.warning(f"Company {company_id} has no identifier set")
            return jsonify({'error': 'Company has no identifier set'}), 400

        logger.info(f"Forcing price update for company {company_id} with identifier '{identifier}' (bypassing 24h rule)")

        # backup_database()  # Consider if this is needed for single updates

        result = get_stock_info(identifier)
        if not result.get('success'):
            error_msg = result.get('error', 'Unknown error')
            logger.error(f"Failed to fetch price for {identifier}: {error_msg}")
            return jsonify({'error': f"Failed to fetch price for {identifier}: {error_msg}"}), 400

        data = result.get('data', {})
        price = data.get('currentPrice')
        currency = data.get('currency')
        price_eur = data.get('priceEUR')
        modified_identifier = result.get('modified_identifier')

        if price is None:
            logger.error(f"No price data returned for {identifier}")
            return jsonify({'error': f'Failed to fetch price for {identifier}'}), 400

        logger.info(f"Successfully fetched price for {identifier}: {price} {currency} ({price_eur} EUR)")

        # Update price and other metadata in the database (this always updates, ignoring any timing rules)
        if update_price_in_db(
            identifier, price, currency, price_eur,
            country=data.get('country'),
            modified_identifier=modified_identifier
        ):
            logger.info(f"Successfully updated price in database for {identifier}")
            return jsonify({
                'success': True,
                'data': {
                    'identifier': identifier,
                    'price': price,
                    'currency': currency,
                    'price_eur': price_eur
                },
                'message': f"Price for {identifier} updated successfully."
            })

        logger.error(f"Failed to update price in database for {identifier}")
        return jsonify({'error': f'Failed to update price in database for {identifier}'}), 500

    except Exception as e:
        logger.error(f"Error updating price for company {company_id}: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred.'}), 500


def update_all_prices():
    """API endpoint to update all prices for companies in user's account"""
    if 'account_id' not in session:
        return jsonify({'error': 'Not authenticated. Please select an account from the home page.'}), 401

    try:
        account_id = session['account_id']
        logger.info(f"Starting bulk price update for account_id: {account_id}")

        # Get all unique identifiers for this account
        companies = query_db('''
            SELECT DISTINCT c.identifier
            FROM companies c
            WHERE c.account_id = ? AND c.identifier IS NOT NULL AND c.identifier != ''
            ORDER BY c.identifier
        ''', [account_id])

        if not companies:
            return jsonify({'error': 'No companies with identifiers found'}), 400

        identifiers = [company['identifier'] for company in companies]
        logger.info(
            f"Found {len(identifiers)} unique identifiers to update: {identifiers}")

        # Start the batch processing job
        job_id = start_batch_process(identifiers)

        return jsonify({
            'success': True,
            'message': f'Started updating prices for {len(identifiers)} companies',
            'job_id': job_id,
            'total_companies': len(identifiers)
        })

    except Exception as e:
        logger.error(f"Error starting bulk price update: {str(e)}")
        return jsonify({'error': str(e)}), 500


def price_fetch_progress():
    """API endpoint to get progress of current price fetch operation"""
    if 'account_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        # Get the latest job progress
        progress_data = get_latest_job_progress()
        return jsonify(progress_data)

    except Exception as e:
        logger.error(f"Error getting price fetch progress: {str(e)}")
        return jsonify({'error': str(e)}), 500


def price_update_status(job_id):
    """API endpoint to get status of a specific price update job"""
    if 'account_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        status = get_job_status(job_id)

        if status.get('status') == 'not_found':
            return jsonify({'error': 'Job not found'}), 404

        # Calculate progress percentage
        progress = status.get('progress', 0)
        total = status.get('total', 1)
        percentage = int((progress / total) * 100) if total > 0 else 0

        response_data = {
            'job_id': job_id,
            'status': status.get('status'),
            'progress': {
                'current': progress,
                'total': total,
                'percentage': percentage
            },
            'is_complete': status.get('status') == 'completed'
        }

        # Add results if job is completed
        if status.get('results'):
            response_data['results'] = status['results']

        return jsonify(response_data)

    except Exception as e:
        logger.error(f"Error getting job status for {job_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500


def update_single_portfolio_api(company_id):
    """API endpoint to update a single portfolio item"""
    if 'account_id' not in session:
        return jsonify({'error': 'Not authenticated. Please select an account from the home page.'}), 401
    try:
        account_id = session['account_id']
        data = request.json or {}
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid data format'}), 400
        company = query_db('SELECT id FROM companies WHERE id = ? AND account_id = ?', [
                           company_id, account_id], one=True)
        if not company:
            return jsonify({'error': 'Company not found or access denied'}), 404
        
        # Apply the update
        with get_db() as db:
            cursor = db.cursor()
            from .portfolio_api import _apply_company_update
            _apply_company_update(cursor, company_id, data, account_id)
            
        # If this is a country reset, fetch and return the updated company data
        if data.get('reset_country', False):
            from app.utils.portfolio_utils import get_portfolio_data
            portfolio_data = get_portfolio_data(account_id)
            
            # Find the updated company in the portfolio data
            updated_company = next((item for item in portfolio_data if item['id'] == company_id), None)
            
            if updated_company:
                return jsonify({
                    'success': True, 
                    'message': 'Company updated successfully',
                    'data': {
                        'effective_country': updated_company['effective_country'],
                        'country_manually_edited': updated_company['country_manually_edited']
                    }
                })
        
        return jsonify({'success': True, 'message': 'Company updated successfully'})
    except Exception as e:
        logger.error(f"Error updating company {company_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500


def bulk_update():
    """API endpoint to handle bulk updates of companies"""
    if 'account_id' not in session:
        return jsonify({'error': 'Not authenticated. Please select an account from the home page.'}), 401
    try:
        account_id = session['account_id']
        data = request.json
        if not data or not isinstance(data, list):
            return jsonify({'error': 'Invalid data format'}), 400
        updated = 0
        errors = []
        with get_db() as db:
            cursor = db.cursor()
            from .portfolio_api import _apply_company_update
            for item in data:
                cid = item.get('id')
                if not cid:
                    errors.append({'id': None, 'error': 'Missing id'})
                    continue
                company = query_db('SELECT id FROM companies WHERE id = ? AND account_id = ?', [
                                   cid, account_id], one=True)
                if not company:
                    errors.append({'id': cid, 'error': 'Company not found'})
                    continue
                try:
                    _apply_company_update(cursor, cid, item, account_id)
                    updated += 1
                except Exception as exc:
                    errors.append({'id': cid, 'error': str(exc)})
        if errors:
            return jsonify({'success': False, 'updated': updated, 'errors': errors}), 400
        return jsonify({'success': True, 'updated': updated, 'errors': []})
    except Exception as e:
        logger.error(f"Error in bulk update: {str(e)}")
        return jsonify({'error': str(e)}), 500


def get_portfolio_companies(portfolio_id):
    """API endpoint to get all companies for a portfolio"""
    if 'account_id' not in session:
        return jsonify({'error': 'Not authenticated. Please select an account from the home page.'}), 401
    try:
        account_id = session['account_id']
        if not portfolio_id:
            return jsonify({'error': 'No portfolio ID provided'}), 400
        companies = query_db('''
            SELECT c.id, c.name, c.identifier, c.category, 
                   cs.shares, cs.override_share,
                   COALESCE(cs.override_share, cs.shares, 0) as effective_shares,
                   mp.price_eur
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ? AND c.portfolio_id = ?
            ORDER BY c.name
        ''', [account_id, portfolio_id])
        result = []
        if companies:
            for company in companies:
                result.append({
                    'id': company['id'],
                    'name': company['name'],
                    'identifier': company['identifier'],
                    'category': company['category'],
                    'shares': company['shares'],
                    'override_share': company['override_share'],
                    'effective_shares': company['effective_shares'],
                    'price_eur': company['price_eur'],
                    'value_eur': company['price_eur'] * company['effective_shares'] if company['price_eur'] and company['effective_shares'] else 0
                })
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting companies for portfolio: {str(e)}")
        return jsonify({'error': str(e)}), 500
