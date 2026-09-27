import logging

from flask import g, request

from app.db_manager import get_db, query_db
from app.decorators import require_auth
from app.utils.portfolio_totals import get_portfolio_totals
from app.utils.response_helpers import (
    error_response,
    not_found_response,
    success_response,
    validation_error_response,
)
from app.utils.value_calculator import calculate_item_value, VALUE_INPUT_COLUMNS_SQL
from app.utils.yfinance_utils import get_yfinance_info


logger = logging.getLogger(__name__)


def _allocation_breakdown(positions, field, denominator):
    """Group position values for the three simulator allocation dimensions."""
    totals = {}
    for position in positions:
        name = position[field]
        if field == 'thesis':
            name = (name or '').strip() or 'Unassigned'
        else:
            name = name or 'Unknown'
        totals[name] = totals.get(name, 0) + float(position['value'] or 0)

    return [
        {
            'name': name,
            'value': round(value, 2),
            'percentage': round(value / denominator * 100, 2) if denominator > 0 else 0,
        }
        for name, value in sorted(totals.items(), key=lambda item: -item[1])
    ]


def _investment_progress(target_amount, current_value):
    return {
        'targetAmount': round(target_amount, 2),
        'remainingToInvest': round(max(0, target_amount - current_value), 2),
        'percentComplete': round(
            current_value / target_amount * 100 if target_amount > 0 else 0, 1
        ),
        'isOverTarget': current_value > target_amount,
    }


@require_auth
def simulator_ticker_lookup():
    """
    Lookup ticker information from yfinance for the allocation simulator.

    POST /portfolio/api/simulator/ticker-lookup
    Body: { "ticker": "AAPL" }

    Returns:
        - ticker: The ticker symbol
        - sector: Sector/industry (e.g., "Technology")
        - country: Country of origin (e.g., "United States")
        - name: Company name (e.g., "Apple Inc.")
        - existsInPortfolio: Boolean indicating if ticker exists in user's portfolio
        - portfolioData: Position data if ticker exists in portfolio (value, shares, etc.)
    """
    try:
        data = request.get_json()
        if not data:
            return validation_error_response('request', 'Request body is required')

        ticker = data.get('ticker', '').strip().upper()
        if not ticker:
            return validation_error_response('ticker', 'Ticker symbol is required')

        account_id = g.account_id
        logger.info(f"Simulator ticker lookup for: {ticker}")

        # Check if ticker exists in user's portfolio
        existing_position = query_db(f'''
            SELECT
                c.id,
                c.name,
                c.identifier,
                c.sector,
                c.thesis,
                COALESCE(c.override_country, mp.country) as country,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                {VALUE_INPUT_COLUMNS_SQL}
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            AND UPPER(c.identifier) = ?
            LIMIT 1
        ''', [account_id, ticker], one=True)
        if existing_position:
            existing_position['value'] = calculate_item_value(existing_position)

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
        # Sector: prefer sector, fall back to industry, then quoteType
        sector = info.get('sector') or info.get('industry') or info.get('quoteType', '—')

        # Country: direct field from yfinance
        country = info.get('country', '—')

        # Name: prefer shortName for cleaner display
        name = info.get('shortName') or info.get('longName', ticker)

        # If position exists in portfolio, prefer its data
        exists_in_portfolio = existing_position is not None
        portfolio_data = None
        thesis = '—'  # yfinance doesn't have thesis, it's user-defined

        if exists_in_portfolio:
            portfolio_data = {
                'id': existing_position['id'],
                'name': existing_position['name'],
                'sector': existing_position['sector'] or sector,
                'thesis': existing_position['thesis'] or '—',
                'country': existing_position['country'] or country,
                'shares': float(existing_position['shares']) if existing_position['shares'] else 0,
                'value': round(float(existing_position['value']), 2) if existing_position['value'] else 0
            }
            # Use portfolio data for sector/country/thesis if available
            if existing_position['sector']:
                sector = existing_position['sector']
            if existing_position['country']:
                country = existing_position['country']
            if existing_position['thesis']:
                thesis = existing_position['thesis']

        logger.info(f"Ticker lookup success: {ticker} -> {sector}, {thesis}, {country}, exists={exists_in_portfolio}")

        return success_response({
            'ticker': ticker,
            'sector': sector if sector else '—',
            'thesis': thesis if thesis else '—',
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
        - sectors: List of sector allocations with value and percentage
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
                c.sector,
                c.thesis,
                COALESCE(c.override_country, mp.country) as country,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                {VALUE_INPUT_COLUMNS_SQL}
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            {portfolio_filter}
            AND (
                (COALESCE(cs.override_share, cs.shares, 0) > 0)
                OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL)
            )
        '''

        positions = query_db(positions_query, params)
        for p in (positions or []):
            p['value'] = calculate_item_value(p)
        if positions:
            positions.sort(key=lambda p: p['value'], reverse=True)

        if not positions:
            return success_response({
                'scope': scope,
                'portfolio_name': portfolio_name,
                'total_value': 0,
                'countries': [],
                'sectors': [],
                'theses': [],
                'positions': []
            })

        # Calculate total value (including cash in denominator for percentages)
        holdings_value = sum(float(p['value'] or 0) for p in positions)
        totals = get_portfolio_totals(account_id, holdings_value)
        total_value = holdings_value  # Keep for backwards compatibility
        portfolio_total = totals['total']  # Use this for percentages (includes cash)

        countries = _allocation_breakdown(positions, 'country', portfolio_total)
        sectors = _allocation_breakdown(positions, 'sector', portfolio_total)
        theses = _allocation_breakdown(positions, 'thesis', portfolio_total)

        # Format positions for response
        positions_list = []
        for p in positions:
            positions_list.append({
                'id': p['id'],
                'ticker': p['identifier'],
                'name': p['name'],
                'country': p['country'] or 'Unknown',
                'sector': p['sector'] or 'Unknown',
                'thesis': (p['thesis'] or '').strip() or 'Unassigned',
                'value': round(float(p['value'] or 0), 2)
            })

        logger.info(f"Returning allocations: {len(countries)} countries, {len(sectors)} sectors, {len(theses)} theses, total={total_value:.2f}")

        # Include investment targets if Builder is configured
        investment_targets = None
        try:
            from app.services.builder_service import BuilderService
            builder_service = BuilderService(get_db())
            targets = builder_service.get_investment_targets(account_id)

            if targets:
                if scope == 'global':
                    target_amount = targets['totals']['totalTargetAmount']
                    investment_targets = {
                        'hasBuilderConfig': True,
                        **_investment_progress(target_amount, total_value),
                        'availableToInvest': round(targets['budget']['availableToInvest'], 2),
                    }
                else:
                    # Portfolio-specific targets
                    portfolio_target = builder_service.get_portfolio_target(account_id, portfolio_id)
                    if portfolio_target:
                        target_amount = portfolio_target['targetAmount']
                        investment_targets = {
                            'hasBuilderConfig': True,
                            'portfolioName': portfolio_target['portfolioName'],
                            'allocationPercent': portfolio_target['allocationPercent'],
                            **_investment_progress(target_amount, total_value),
                        }
        except Exception as e:
            logger.warning(f"Could not load investment targets: {e}")

        return success_response({
            'scope': scope,
            'portfolio_name': portfolio_name,
            'total_value': round(total_value, 2),
            'cash': totals['cash'],
            'portfolio_total': round(portfolio_total, 2),  # Holdings + cash
            'countries': countries,
            'sectors': sectors,
            'theses': theses,
            'positions': positions_list,
            'investmentTargets': investment_targets
        })

    except Exception as e:
        logger.exception("Error getting simulator portfolio allocations")
        return error_response('Failed to get portfolio allocations', 500)




@require_auth
def simulator_search_investments():
    """
    Search existing account investments for autocomplete suggestions.

    GET /portfolio/api/simulator/search-investments?q=<query>&limit=10

    Returns:
        List of matching investments with identifier, name, sector, thesis, country, value, portfolio info
    """
    try:
        account_id = g.account_id
        query_str = request.args.get('q', '').strip()
        limit = max(1, min(request.args.get('limit', 10, type=int), 20))

        if len(query_str) < 2:
            return success_response({'results': []})

        if len(query_str) > 200:
            return error_response('Search query too long', 400)

        search_pattern = f'%{query_str}%'

        results = query_db(f'''
            SELECT
                c.identifier,
                c.name,
                c.sector,
                c.thesis,
                COALESCE(c.override_country, mp.country) as country,
                c.portfolio_id,
                p.name as portfolio_name,
                {VALUE_INPUT_COLUMNS_SQL}
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            WHERE c.account_id = ?
            AND (
                c.name LIKE ? COLLATE NOCASE
                OR c.identifier LIKE ? COLLATE NOCASE
            )
            AND (
                (COALESCE(cs.override_share, cs.shares, 0) > 0)
                OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL)
            )
        ''', [account_id, search_pattern, search_pattern])

        # Rank by the Python-computed value, so limit in Python too.
        for r in (results or []):
            r['value'] = calculate_item_value(r)
        matches = sorted(
            (results or []), key=lambda r: r['value'], reverse=True
        )[:limit]

        investments = []
        for r in matches:
            investments.append({
                'identifier': r['identifier'],
                'name': r['name'],
                'sector': r['sector'] or 'Unknown',
                'thesis': (r['thesis'] or '').strip() or 'Unassigned',
                'country': r['country'] or 'Unknown',
                'value': round(r['value'], 2),
                'portfolio_name': r['portfolio_name'] or 'Unassigned',
                'portfolio_id': r['portfolio_id']
            })

        return success_response({'results': investments})

    except Exception as e:
        logger.exception("Error searching investments")
        return error_response('Failed to search investments', 500)
