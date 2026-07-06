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

        # Aggregate by country
        country_totals = {}
        for p in positions:
            country = p['country'] or 'Unknown'
            country_totals[country] = country_totals.get(country, 0) + float(p['value'] or 0)

        countries = []
        for country, value in sorted(country_totals.items(), key=lambda x: -x[1]):
            percentage = (value / portfolio_total * 100) if portfolio_total > 0 else 0
            countries.append({
                'name': country,
                'value': round(value, 2),
                'percentage': round(percentage, 2)
            })

        # Aggregate by sector
        sector_totals = {}
        for p in positions:
            sector = p['sector'] or 'Unknown'
            sector_totals[sector] = sector_totals.get(sector, 0) + float(p['value'] or 0)

        sectors = []
        for sector, value in sorted(sector_totals.items(), key=lambda x: -x[1]):
            percentage = (value / portfolio_total * 100) if portfolio_total > 0 else 0
            sectors.append({
                'name': sector,
                'value': round(value, 2),
                'percentage': round(percentage, 2)
            })

        # Aggregate by thesis
        thesis_totals = {}
        for p in positions:
            thesis = (p['thesis'] or '').strip() or 'Unassigned'
            thesis_totals[thesis] = thesis_totals.get(thesis, 0) + float(p['value'] or 0)

        theses = []
        for thesis, value in sorted(thesis_totals.items(), key=lambda x: -x[1]):
            percentage = (value / portfolio_total * 100) if portfolio_total > 0 else 0
            theses.append({
                'name': thesis,
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
                    remaining = max(0, target_amount - total_value)
                    percent_complete = (total_value / target_amount * 100) if target_amount > 0 else 0

                    investment_targets = {
                        'hasBuilderConfig': True,
                        'targetAmount': round(target_amount, 2),
                        'remainingToInvest': round(remaining, 2),
                        'percentComplete': round(percent_complete, 1),
                        'availableToInvest': round(targets['budget']['availableToInvest'], 2),
                        'isOverTarget': total_value > target_amount
                    }
                else:
                    # Portfolio-specific targets
                    portfolio_target = builder_service.get_portfolio_target(account_id, portfolio_id)
                    if portfolio_target:
                        target_amount = portfolio_target['targetAmount']
                        remaining = max(0, target_amount - total_value)
                        percent_complete = (total_value / target_amount * 100) if target_amount > 0 else 0

                        investment_targets = {
                            'hasBuilderConfig': True,
                            'portfolioName': portfolio_target['portfolioName'],
                            'allocationPercent': portfolio_target['allocationPercent'],
                            'targetAmount': round(target_amount, 2),
                            'remainingToInvest': round(remaining, 2),
                            'percentComplete': round(percent_complete, 1),
                            'isOverTarget': total_value > target_amount
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
def simulator_simulations_list():
    """
    List all saved simulations for the current user.

    GET /portfolio/api/simulator/simulations
    Query params:
        - type: Optional filter: 'overlay' or 'portfolio'

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

        sim_type = data.get('type', 'overlay')
        if sim_type not in ('overlay', 'portfolio'):
            return error_response("Type must be 'overlay' or 'portfolio'", 400)

        cloned_from_portfolio_id = data.get('cloned_from_portfolio_id')
        cloned_from_name = data.get('cloned_from_name')

        global_value_mode = data.get('global_value_mode', 'euro')
        if global_value_mode not in ('euro', 'percent'):
            return error_response("global_value_mode must be 'euro' or 'percent'", 400)

        total_amount = data.get('total_amount', 0)
        if not isinstance(total_amount, (int, float)) or total_amount < 0:
            total_amount = 0

        # Deploy parameters
        deploy_lump_sum = data.get('deploy_lump_sum', 0)
        if not isinstance(deploy_lump_sum, (int, float)) or deploy_lump_sum < 0:
            deploy_lump_sum = 0

        deploy_monthly = data.get('deploy_monthly', 0)
        if not isinstance(deploy_monthly, (int, float)) or deploy_monthly < 0:
            deploy_monthly = 0

        deploy_months = data.get('deploy_months', 1)
        if not isinstance(deploy_months, int) or deploy_months < 1 or deploy_months > 120:
            deploy_months = 1

        deploy_manual_mode = 1 if data.get('deploy_manual_mode') else 0

        deploy_manual_items = data.get('deploy_manual_items')
        if deploy_manual_items is not None and not isinstance(deploy_manual_items, list):
            deploy_manual_items = None

        # Check for duplicate name
        if SimulationRepository.exists(name, account_id):
            return error_response(f'A simulation named "{name}" already exists', 409)

        # Create simulation
        simulation_id = SimulationRepository.create(
            account_id=account_id,
            name=name,
            scope=scope,
            items=items,
            portfolio_id=portfolio_id if scope == 'portfolio' else None,
            sim_type=sim_type,
            cloned_from_portfolio_id=cloned_from_portfolio_id,
            cloned_from_name=cloned_from_name,
            global_value_mode=global_value_mode,
            total_amount=total_amount,
            deploy_lump_sum=deploy_lump_sum,
            deploy_monthly=deploy_monthly,
            deploy_months=deploy_months,
            deploy_manual_mode=deploy_manual_mode,
            deploy_manual_items=deploy_manual_items
        )

        # Fetch the created simulation
        simulation = SimulationRepository.get_by_id(simulation_id, account_id)

        logger.info(f"Created simulation '{name}' (id={simulation_id}, type={sim_type})")
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

        # Validate global_value_mode if provided
        global_value_mode = data.get('global_value_mode')
        if global_value_mode is not None and global_value_mode not in ('euro', 'percent'):
            return error_response("global_value_mode must be 'euro' or 'percent'", 400)

        total_amount = data.get('total_amount')
        if total_amount is not None:
            if not isinstance(total_amount, (int, float)) or total_amount < 0:
                total_amount = 0

        # Deploy parameters
        deploy_lump_sum = data.get('deploy_lump_sum')
        if deploy_lump_sum is not None:
            if not isinstance(deploy_lump_sum, (int, float)) or deploy_lump_sum < 0:
                deploy_lump_sum = 0

        deploy_monthly = data.get('deploy_monthly')
        if deploy_monthly is not None:
            if not isinstance(deploy_monthly, (int, float)) or deploy_monthly < 0:
                deploy_monthly = 0

        deploy_months = data.get('deploy_months')
        if deploy_months is not None:
            if not isinstance(deploy_months, int) or deploy_months < 1 or deploy_months > 120:
                deploy_months = 1

        deploy_manual_mode = data.get('deploy_manual_mode')
        if deploy_manual_mode is not None:
            deploy_manual_mode = 1 if deploy_manual_mode else 0

        deploy_manual_items = data.get('deploy_manual_items')
        if deploy_manual_items is not None and not isinstance(deploy_manual_items, list):
            deploy_manual_items = None

        # Update simulation
        success = SimulationRepository.update(
            simulation_id=simulation_id,
            account_id=account_id,
            name=name,
            scope=scope,
            items=items,
            portfolio_id=data.get('portfolio_id'),
            global_value_mode=global_value_mode,
            total_amount=total_amount,
            deploy_lump_sum=deploy_lump_sum,
            deploy_monthly=deploy_monthly,
            deploy_months=deploy_months,
            deploy_manual_mode=deploy_manual_mode,
            deploy_manual_items=deploy_manual_items
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
        matches = sorted(
            (results or []), key=lambda r: calculate_item_value(r), reverse=True
        )[:limit]

        investments = []
        for r in matches:
            investments.append({
                'identifier': r['identifier'],
                'name': r['name'],
                'sector': r['sector'] or 'Unknown',
                'thesis': (r['thesis'] or '').strip() or 'Unassigned',
                'country': r['country'] or 'Unknown',
                'value': round(calculate_item_value(r), 2),
                'portfolio_name': r['portfolio_name'] or 'Unassigned',
                'portfolio_id': r['portfolio_id']
            })

        return success_response({'results': investments})

    except Exception as e:
        logger.exception("Error searching investments")
        return error_response('Failed to search investments', 500)


@require_auth
def simulator_clone_portfolio():
    """
    Clone a real portfolio into a simulated portfolio.

    POST /portfolio/api/simulator/clone-portfolio
    Body: {
        "portfolio_id": 123,
        "name": "Clone of My Portfolio",
        "zero_values": false
    }

    Returns:
        Created simulation with all positions from the source portfolio
    """
    try:
        from app.repositories.simulation_repository import SimulationRepository

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return error_response('Request body is required', 400)

        portfolio_id = data.get('portfolio_id')
        if not portfolio_id:
            return error_response('portfolio_id is required', 400)

        name = data.get('name', '').strip()
        if not name:
            return error_response('Simulation name is required', 400)
        if len(name) > 100:
            return error_response('Simulation name too long (max 100 characters)', 400)

        zero_values = data.get('zero_values', False)

        # Check name uniqueness
        if SimulationRepository.exists(name, account_id):
            return error_response(f'A simulation named "{name}" already exists', 409)

        # Get source portfolio name
        portfolio = query_db(
            'SELECT name FROM portfolios WHERE id = ? AND account_id = ?',
            [portfolio_id, account_id], one=True
        )
        if not portfolio:
            return not_found_response('Portfolio', portfolio_id)

        portfolio_name = portfolio['name']

        # Fetch all positions from the source portfolio
        positions = query_db(f'''
            SELECT
                c.identifier,
                c.name,
                c.sector,
                c.thesis,
                COALESCE(c.override_country, mp.country) as country,
                c.portfolio_id,
                {VALUE_INPUT_COLUMNS_SQL}
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ? AND c.portfolio_id = ?
            AND (
                (COALESCE(cs.override_share, cs.shares, 0) > 0)
                OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL)
            )
        ''', [account_id, portfolio_id])
        for pos in (positions or []):
            pos['value'] = calculate_item_value(pos)
        if positions:
            positions.sort(key=lambda p: p['value'], reverse=True)

        # Transform positions into simulation items
        items = []
        for pos in (positions or []):
            items.append({
                'id': f'clone_{pos["identifier"] or pos["name"]}_{len(items)}',
                'ticker': pos['identifier'] or '—',
                'name': pos['name'] or '—',
                'sector': (pos['sector'] or 'unknown').lower(),
                'thesis': ((pos['thesis'] or '').strip() or 'unassigned').lower(),
                'country': (pos['country'] or 'unknown').lower(),
                'value': 0 if zero_values else round(float(pos['value'] or 0), 2),
                'valueMode': 'absolute',
                'source': 'ticker' if pos['identifier'] else 'sector',
                'existsInPortfolio': True,
                'portfolio_id': pos['portfolio_id']
            })

        # Create simulation
        simulation_id = SimulationRepository.create(
            account_id=account_id,
            name=name,
            scope='global',
            items=items,
            sim_type='portfolio',
            cloned_from_portfolio_id=portfolio_id,
            cloned_from_name=portfolio_name
        )

        simulation = SimulationRepository.get_by_id(simulation_id, account_id)

        logger.info(f"Cloned portfolio '{portfolio_name}' (id={portfolio_id}) into simulation '{name}' (id={simulation_id}, {len(items)} positions)")
        return success_response({'simulation': simulation}, status=201)

    except Exception as e:
        logger.exception("Error cloning portfolio")
        return error_response('Failed to clone portfolio', 500)
