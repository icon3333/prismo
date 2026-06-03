import logging
import re

from flask import g, jsonify, request

from app.decorators import require_auth
from app.utils.response_helpers import error_response, validation_error_response


logger = logging.getLogger(__name__)


@require_auth
def add_company():
    """
    Manually add a company/security to the portfolio.

    POST /portfolio/api/add_company
    Body: {
        "name": "Apple Inc.",
        "identifier": "AAPL",  // Optional - leave blank for private holdings
        "portfolio_id": 1,     // Optional - null for unassigned
        "sector": "Technology",
        "investment_type": "Stock",  // Optional: Stock, ETF, Crypto, or null
        "country": "US",       // Optional
        "shares": 10.5,
        "total_value": 1623.00  // Required if no identifier or price lookup fails
    }

    Returns:
        - success: boolean
        - company_id: ID of created company (if success)
        - message: Success message
        - error: Error type/message (if failed)
        - existing: Existing company info (if duplicate)
    """
    try:
        from app.services.company_service import CompanyService

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return validation_error_response('request', 'Request body is required')

        result = CompanyService.add_company_manual(account_id, data)

        if result.get('success'):
            return jsonify(result), 201
        elif result.get('error') == 'duplicate':
            return jsonify(result), 409  # Conflict
        else:
            return jsonify(result), 400

    except Exception as e:
        logger.exception("Error adding company manually")
        return error_response('Failed to add company', 500)


@require_auth
def validate_identifier():
    """
    Validate an identifier by checking if price data is available.

    GET /portfolio/api/validate_identifier?identifier=AAPL

    Returns:
        - success: boolean
        - price_data: { price, currency, price_eur, country } if found
        - error: Error message if not found
    """
    try:
        from app.services.company_service import CompanyService

        identifier = request.args.get('identifier', '').strip()

        if not identifier:
            return validation_error_response('identifier', 'Identifier is required')

        result = CompanyService.validate_identifier(identifier)

        return jsonify(result)

    except Exception as e:
        logger.exception("Error validating identifier")
        return error_response('Failed to validate identifier', 500)


@require_auth
def delete_manual_companies():
    """
    Delete manually-added companies.

    POST /portfolio/api/delete_companies
    Body: { "company_ids": [1, 2, 3] }

    Only companies with source='manual' can be deleted.
    CSV-imported companies will be skipped.

    Returns:
        - success: boolean
        - deleted_count: Number of companies deleted
        - skipped_count: Number of companies skipped (not manual)
    """
    try:
        from app.services.company_service import CompanyService

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return validation_error_response('request', 'Request body is required')

        company_ids = data.get('company_ids', [])

        if not company_ids or not isinstance(company_ids, list):
            return validation_error_response('company_ids', 'company_ids must be a non-empty list')

        result = CompanyService.delete_manual_companies(account_id, company_ids)

        return jsonify(result)

    except Exception as e:
        logger.exception("Error deleting companies")
        return error_response('Failed to delete companies', 500)


@require_auth
def get_portfolios_for_dropdown():
    """
    Get list of portfolios for dropdown selection.

    GET /portfolio/api/portfolios_dropdown

    Returns:
        - portfolios: List of { id, name } objects
    """
    try:
        from app.repositories.portfolio_repository import PortfolioRepository

        account_id = g.account_id
        portfolios = PortfolioRepository.get_portfolios_list(account_id)

        return jsonify({
            'success': True,
            'portfolios': portfolios
        })

    except Exception as e:
        logger.exception("Error getting portfolios for dropdown")
        return error_response('Failed to get portfolios', 500)


@require_auth
def get_historical_prices_api():
    """
    Fetch historical close prices for a set of identifiers.

    GET /portfolio/api/historical_prices?identifiers=AAPL,MSFT&period=1y

    Query params:
        identifiers: Comma-separated list of company identifiers (max 20)
        period: 1y, 3y, 5y, or 10y (default: 1y)

    Returns JSON with series keyed by original identifiers.
    """
    from app.utils.yfinance_utils import get_historical_prices, VALID_PERIODS
    from app.utils.identifier_mapping import get_preferred_identifier
    import re

    account_id = g.account_id

    raw_identifiers = request.args.get('identifiers', '')
    period = request.args.get('period', '1y')
    start_date = request.args.get('start_date', '')

    if not raw_identifiers:
        return validation_error_response('identifiers', 'identifiers parameter is required')

    identifiers = [i.strip() for i in raw_identifiers.split(',') if i.strip()]

    if not identifiers:
        return validation_error_response('identifiers', 'At least one identifier is required')

    if len(identifiers) > 50:
        return validation_error_response('identifiers', 'Maximum 50 identifiers allowed')

    # Validate start_date format if provided (mutually exclusive with period)
    if start_date:
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', start_date):
            return validation_error_response('start_date', 'start_date must be in YYYY-MM-DD format')
    elif period not in VALID_PERIODS:
        return validation_error_response('period', f'Invalid period. Must be one of: {", ".join(sorted(VALID_PERIODS))}')

    try:
        # Resolve identifiers: ISIN → yfinance ticker via identifier_mappings
        resolved_map = {}
        for ident in identifiers:
            preferred = get_preferred_identifier(account_id, ident)
            resolved_map[ident] = preferred or ident

        resolved_list = [v for v in set(resolved_map.values()) if v]

        if start_date:
            raw_data = get_historical_prices(resolved_list, start_date=start_date)
        else:
            raw_data = get_historical_prices(resolved_list, period)

        # Re-key response by original identifiers
        response_series = {}
        for orig, resolved in resolved_map.items():
            if resolved in raw_data.get('series', {}):
                response_series[orig] = raw_data['series'][resolved]

        return jsonify({
            'success': True,
            'series': response_series,
            'errors': raw_data.get('errors', []),
            'period': start_date if start_date else period
        })

    except Exception as e:
        logger.exception("Error fetching historical prices")
        return error_response('Failed to fetch historical prices', 500)


# ============================================================================
# Account Management API
# ============================================================================
