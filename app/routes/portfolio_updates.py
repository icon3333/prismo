from flask import request, session, jsonify, g
from app.db_manager import query_db, backup_database, get_db
from app.utils.portfolio_utils import get_stock_info
from app.utils.db_utils import update_price_in_db
from app.utils.batch_processing import start_batch_process, get_job_status, get_latest_job_progress
from app.decorators import require_auth
from app.utils.response_helpers import success_response, error_response, not_found_response, validation_error_response, service_unavailable_response
from app.exceptions import (
    ValidationError, DataIntegrityError, ExternalAPIError, NotFoundError,
    PriceFetchError
)
import logging

logger = logging.getLogger(__name__)


@require_auth
def update_price_api(company_id: int):
    """API endpoint to update a company's price by its ID."""
    logger.info(f"Price update requested for company_id: {company_id}")

    account_id = g.account_id
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
            return not_found_response('Company', company_id)

        identifier = company['identifier'] if isinstance(company, dict) else None
        if not identifier:
            logger.warning(f"Company {company_id} has no identifier set")
            return error_response('Company has no identifier set', 400)

        logger.info(f"Forcing price update for company {company_id} with identifier '{identifier}' (bypassing 24h rule)")

        # backup_database()  # Consider if this is needed for single updates

        result = get_stock_info(identifier)
        if not result.get('success'):
            error_msg = result.get('error', 'Unknown error')
            logger.error(f"Failed to fetch price for {identifier}: {error_msg}")
            return error_response(f"Failed to fetch price for {identifier}: {error_msg}", 400)

        data = result.get('data', {})
        price = data.get('currentPrice')
        currency = data.get('currency')
        price_eur = data.get('priceEUR')
        modified_identifier = result.get('modified_identifier')

        if price is None:
            logger.error(f"No price data returned for {identifier}")
            return error_response(f'Failed to fetch price for {identifier}', 400)

        logger.info(f"Successfully fetched price for {identifier}: {price} {currency} ({price_eur} EUR)")

        # Update price and other metadata in the database (this always updates, ignoring any timing rules)
        if update_price_in_db(
            identifier, price, currency, price_eur,
            country=data.get('country'),
            modified_identifier=modified_identifier
        ):
            logger.info(f"Successfully updated price in database for {identifier}")
            return success_response(
                data={
                    'identifier': identifier,
                    'price': price,
                    'currency': currency,
                    'price_eur': price_eur
                },
                message=f"Price for {identifier} updated successfully."
            )

        logger.error(f"Failed to update price in database for {identifier}")
        return error_response(f'Failed to update price in database for {identifier}', 500)

    except Exception as e:
        logger.error(f"Error updating price for company {company_id}: {str(e)}")
        return error_response('An unexpected error occurred.', 500)


@require_auth
def update_all_prices():
    """API endpoint to update all prices for companies in user's account"""
    try:
        account_id = g.account_id
        logger.info(f"Starting bulk price update for account_id: {account_id}")

        # Get all unique identifiers for this account
        try:
            companies = query_db('''
                SELECT DISTINCT c.identifier
                FROM companies c
                WHERE c.account_id = ? AND c.identifier IS NOT NULL AND c.identifier != ''
                ORDER BY c.identifier
            ''', [account_id])
        except Exception as e:
            logger.error(f"Database error fetching companies for price update: {e}")
            raise DataIntegrityError('Failed to fetch companies from database')

        if not companies:
            logger.warning(f"No companies with identifiers found for account {account_id}")
            raise ValidationError('No companies with identifiers found')

        identifiers = [company['identifier'] for company in companies]
        logger.info(
            f"Found {len(identifiers)} unique identifiers to update: {identifiers}")

        # Start the batch processing job
        try:
            job_id = start_batch_process(identifiers)
        except Exception as e:
            logger.error(f"Failed to start batch price update job: {e}")
            raise ExternalAPIError(f'Failed to start price update job: {str(e)}')

        logger.info(f"Successfully started batch price update job: {job_id}")
        return success_response(
            data={
                'job_id': job_id,
                'total_companies': len(identifiers)
            },
            message=f'Started updating prices for {len(identifiers)} companies'
        )

    except ValidationError as e:
        logger.error(f"Validation error in update_all_prices: {e}")
        return error_response(str(e), status=400)

    except DataIntegrityError as e:
        logger.error(f"Data integrity error in update_all_prices: {e}")
        return error_response(str(e), status=409)

    except ExternalAPIError as e:
        logger.exception("External API error in update_all_prices")
        return service_unavailable_response('Price update service', str(e))

    except Exception as e:
        logger.exception("Unexpected error starting bulk price update")
        return error_response('Internal server error', status=500)


@require_auth
def update_selected_prices():
    """API endpoint to update selected companies' prices"""
    try:
        account_id = g.account_id
        data = request.json

        # Validate input data
        if not data:
            raise ValidationError('No request data provided')

        company_ids = data.get('company_ids', [])

        if not company_ids:
            raise ValidationError('No companies selected')

        if not isinstance(company_ids, list):
            raise ValidationError('company_ids must be a list')

        logger.info(f"Starting selected price update for account_id: {account_id}, company_ids: {company_ids}")

        # Get unique identifiers for selected companies
        try:
            placeholders = ','.join('?' * len(company_ids))
            companies = query_db(f'''
                SELECT DISTINCT c.identifier
                FROM companies c
                WHERE c.account_id = ? AND c.id IN ({placeholders}) AND c.identifier IS NOT NULL AND c.identifier != ''
            ''', [account_id] + company_ids)
        except Exception as e:
            logger.error(f"Database error fetching identifiers for selected companies: {e}")
            raise DataIntegrityError('Failed to fetch company identifiers from database')

        if not companies:
            logger.warning(f"No valid identifiers found for selected companies: {company_ids}")
            raise ValidationError('No valid identifiers found for selected companies')

        identifiers = [company['identifier'] for company in companies]
        logger.info(f"Found {len(identifiers)} unique identifiers to update: {identifiers}")

        # Start the batch processing job (reuse existing batch process)
        try:
            job_id = start_batch_process(identifiers)
        except Exception as e:
            logger.error(f"Failed to start batch price update job for selected companies: {e}")
            raise ExternalAPIError(f'Failed to start price update job: {str(e)}')

        logger.info(f"Successfully started batch price update job for selected companies: {job_id}")
        return success_response(
            data={
                'job_id': job_id,
                'total_companies': len(identifiers)
            },
            message=f'Started updating prices for {len(identifiers)} selected companies'
        )

    except ValidationError as e:
        logger.error(f"Validation error in update_selected_prices: {e}")
        return error_response(str(e), status=400)

    except DataIntegrityError as e:
        logger.error(f"Data integrity error in update_selected_prices: {e}")
        return error_response(str(e), status=409)

    except ExternalAPIError as e:
        logger.exception("External API error in update_selected_prices")
        return service_unavailable_response('Price update service', str(e))

    except Exception as e:
        logger.exception("Unexpected error starting selected price update")
        return error_response('Internal server error', status=500)


@require_auth
def price_fetch_progress():
    """API endpoint to get progress of current price fetch operation"""
    try:
        # Get the latest job progress
        progress_data = get_latest_job_progress()
        return jsonify(progress_data)

    except Exception as e:
        logger.error(f"Error getting price fetch progress: {str(e)}")
        return error_response(str(e), 500)


@require_auth
def price_update_status(job_id):
    """API endpoint to get status of a specific price update job"""
    try:
        status = get_job_status(job_id)

        if status.get('status') == 'not_found':
            return not_found_response('Job', job_id)

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
        return error_response(str(e), 500)


@require_auth
def update_single_portfolio_api(company_id):
    """API endpoint to update a single portfolio item"""
    try:
        account_id = g.account_id
        data = request.json or {}
        if not isinstance(data, dict):
            return error_response('Invalid data format', 400)
        company = query_db('SELECT id FROM companies WHERE id = ? AND account_id = ?', [
                           company_id, account_id], one=True)
        if not company:
            return not_found_response('Company', company_id)
        
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
                return success_response(
                    data={
                        'effective_country': updated_company['effective_country'],
                        'country_manually_edited': updated_company['country_manually_edited']
                    },
                    message='Company updated successfully'
                )

        return success_response(message='Company updated successfully')
    except Exception as e:
        logger.error(f"Error updating company {company_id}: {str(e)}")
        return error_response(str(e), 500)


@require_auth
def bulk_update():
    """API endpoint to handle bulk updates of companies"""
    try:
        account_id = g.account_id
        data = request.json
        if not data or not isinstance(data, list):
            return error_response('Invalid data format', 400)
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
            return error_response(
                f'{updated} items updated, {len(errors)} failed',
                400,
                details={'updated': updated, 'errors': errors}
            )
        return success_response(data={'updated': updated}, message=f'Successfully updated {updated} companies')
    except Exception as e:
        logger.error(f"Error in bulk update: {str(e)}")
        return error_response(str(e), 500)


@require_auth
def get_portfolio_companies(portfolio_id):
    """API endpoint to get all companies for a portfolio"""
    try:
        account_id = g.account_id
        if not portfolio_id:
            return error_response('No portfolio ID provided', 400)
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
        return error_response(str(e), 500)
