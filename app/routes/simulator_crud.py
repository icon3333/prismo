import logging

from flask import g, request

from app.db_manager import query_db
from app.utils.value_calculator import VALUE_INPUT_COLUMNS_SQL, calculate_item_value

from app.decorators import require_auth
from app.repositories.simulation_repository import SimulationRepository
from app.utils.response_helpers import error_response, not_found_response, success_response

logger = logging.getLogger(__name__)


def _owns_portfolio(portfolio_id, account_id):
    return bool(query_db(
        'SELECT 1 FROM portfolios WHERE id = ? AND account_id = ?',
        [portfolio_id, account_id], one=True,
    ))


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
        account_id = g.account_id

        sim_type = request.args.get('type')
        if sim_type is not None and sim_type not in ('overlay', 'portfolio'):
            return error_response("Type must be 'overlay' or 'portfolio'", 400)
        simulations = SimulationRepository.get_all(account_id, sim_type=sim_type)

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
        if SimulationRepository.exists(name, account_id):
            return error_response(f'A simulation named "{name}" already exists', 409)
        if scope not in ('global', 'portfolio'):
            return error_response("Scope must be 'global' or 'portfolio'", 400)

        portfolio_id = data.get('portfolio_id')
        if scope == 'portfolio' and not portfolio_id:
            return error_response('portfolio_id is required when scope is "portfolio"', 400)
        if scope == 'portfolio' and not _owns_portfolio(portfolio_id, account_id):
            return not_found_response('Portfolio', portfolio_id)

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
            total_amount=total_amount
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
        effective_scope = scope or existing['scope']
        portfolio_id = data.get('portfolio_id', existing['portfolio_id'])
        if effective_scope == 'portfolio':
            if not portfolio_id:
                return error_response('portfolio_id is required when scope is "portfolio"', 400)
            if not _owns_portfolio(portfolio_id, account_id):
                return not_found_response('Portfolio', portfolio_id)

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

        success = SimulationRepository.update(
            simulation_id=simulation_id,
            account_id=account_id,
            name=name,
            scope=scope,
            items=items,
            portfolio_id=portfolio_id if effective_scope == 'portfolio' else None,
            global_value_mode=global_value_mode,
            total_amount=total_amount
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
