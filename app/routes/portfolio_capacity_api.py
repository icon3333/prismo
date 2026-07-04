"""Capacity API — country/sector/effective concentration headroom for the simulator."""

from flask import jsonify, g
from app.db_manager import query_db
from app.decorators import require_auth
from app.utils.response_helpers import error_response
from app.exceptions import ValidationError, DataIntegrityError

import logging
import json
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

def _get_position_data_by_field(account_id: int, field_sql: str) -> List[Dict[str, Any]]:
    """
    Shared helper to query position data grouped by any field (country, sector, etc.)

    Args:
        account_id: User's account ID
        field_sql: SQL expression for the grouping field (e.g., "COALESCE(c.sector, 'Uncategorized')")

    Returns:
        List of position data dictionaries with field_value, company details, and values

    Raises:
        ValueError: If field_sql is not in the allowed whitelist
    """
    # SECURITY: Whitelist of allowed SQL expressions to prevent SQL injection
    # Only predefined expressions are allowed - no user input should reach here
    ALLOWED_FIELD_EXPRESSIONS = {
        "COALESCE(c.sector, 'Uncategorized')",
        "COALESCE(c.override_country, mp.country, 'Unknown')",
        "c.sector",
        "c.override_country",
        "mp.country",
    }

    if field_sql not in ALLOWED_FIELD_EXPRESSIONS:
        logger.error(f"SQL injection attempt blocked: {field_sql}")
        raise ValueError(f"Invalid field_sql expression: {field_sql}")

    return query_db(f'''
        SELECT
            {field_sql} as field_value,
            c.name as company_name,
            p.name as portfolio_name,
            COALESCE(cs.override_share, cs.shares, 0) as shares,
            COALESCE(mp.price_eur, 0) as price,
            CASE
                WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL THEN c.custom_total_value
                ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
            END as position_value
        FROM companies c
        LEFT JOIN company_shares cs ON c.id = cs.company_id
        LEFT JOIN market_prices mp ON c.identifier = mp.identifier
        LEFT JOIN portfolios p ON c.portfolio_id = p.id
        WHERE c.account_id = ?
        AND COALESCE(cs.override_share, cs.shares, 0) > 0
        AND (COALESCE(mp.price_eur, 0) > 0 OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL))
        ORDER BY field_value, position_value DESC
    ''', [account_id])


@require_auth
def get_country_capacity_data():
    """API endpoint to get country investment capacity data for the rebalancing feature"""
    logger.info("API request for country investment capacity data")

    account_id = g.account_id
    logger.info(f"Getting country capacity data for account_id: {account_id}")

    try:
        # Get budget and rules settings from expanded_state in single query
        state_data = query_db('''
            SELECT variable_name, variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name IN (?, ?)
        ''', [account_id, 'build', 'budgetData', 'rules'])

        # Parse budget and rules data
        total_investable_capital = 0
        max_per_country = 10  # Default value

        for row in state_data:
            var_name = row.get('variable_name')
            var_value = row.get('variable_value', '{}')
            try:
                parsed_json = json.loads(var_value)
                if var_name == 'budgetData':
                    total_investable_capital = float(parsed_json.get('totalInvestableCapital', 0))
                elif var_name == 'rules':
                    max_per_country = float(parsed_json.get('maxPerCountry', 10))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse {var_name} data: {e}")

        logger.info(f"Budget settings - Total Investable Capital: {total_investable_capital}, Max Per Country: {max_per_country}%")

        # Get all user's positions with individual company details by country (using shared helper)
        position_data = _get_position_data_by_field(
            account_id,
            "COALESCE(c.override_country, mp.country, 'Unknown')"
        )

        # Group positions by country
        country_positions = {}
        if position_data:
            for row in position_data:
                country = row['field_value']  # Using generic field_value from helper
                if country not in country_positions:
                    country_positions[country] = {
                        'positions': [],
                        'total_invested': 0
                    }

                position_info = {
                    'company_name': row['company_name'],
                    'portfolio_name': row['portfolio_name'],
                    'shares': float(row['shares']),
                    'price': float(row['price']),
                    'value': float(row['position_value'])
                }

                country_positions[country]['positions'].append(position_info)
                country_positions[country]['total_invested'] += position_info['value']

        # Calculate remaining capacity for each country
        country_capacity = []
        if country_positions and total_investable_capital > 0:
            max_per_country_amount = total_investable_capital * (max_per_country / 100)

            for country, data in country_positions.items():
                current_invested = data['total_invested']
                # Allow negative values for over-allocated countries
                remaining_capacity = max_per_country_amount - current_invested

                country_capacity.append({
                    'country': country,
                    'current_invested': current_invested,
                    'max_allowed': max_per_country_amount,
                    'remaining_capacity': remaining_capacity,
                    'is_over_allocated': remaining_capacity < 0,
                    'positions': data['positions']  # Include individual positions for hover
                })

        # Sort by remaining capacity (ascending - over-allocated countries first, then least to most capacity)
        country_capacity.sort(key=lambda x: x['remaining_capacity'])

        logger.info(f"Returning country capacity data for {len(country_capacity)} countries")
        return jsonify({
            'countries': country_capacity,
            'total_investable_capital': total_investable_capital,
            'max_per_country_percent': max_per_country
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting country capacity data: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting country capacity data")
        return error_response('Failed to calculate country capacity', 500)


@require_auth
def get_sector_capacity_data():
    """API endpoint to get sector investment capacity data for the rebalancing feature"""
    logger.info("API request for sector investment capacity data")

    account_id = g.account_id
    logger.info(f"Getting sector capacity data for account_id: {account_id}")

    try:
        # Get budget and rules settings from expanded_state in single query
        state_data = query_db('''
            SELECT variable_name, variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name IN (?, ?)
        ''', [account_id, 'build', 'budgetData', 'rules'])

        # Parse budget and rules data
        total_investable_capital = 0
        max_per_sector = 25  # Default value

        for row in state_data:
            var_name = row.get('variable_name')
            var_value = row.get('variable_value', '{}')
            try:
                parsed_json = json.loads(var_value)
                if var_name == 'budgetData':
                    total_investable_capital = float(parsed_json.get('totalInvestableCapital', 0))
                elif var_name == 'rules':
                    max_per_sector = float(parsed_json.get('maxPerSector', 25))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse {var_name} data: {e}")

        logger.info(f"Budget settings - Total Investable Capital: {total_investable_capital}, Max Per Sector: {max_per_sector}%")

        # Get all user's positions with individual company details by sector (using shared helper)
        position_data = _get_position_data_by_field(
            account_id,
            "COALESCE(c.sector, 'Uncategorized')"
        )

        # Group positions by sector
        sector_positions = {}
        if position_data:
            for row in position_data:
                sector = row['field_value']  # Using generic field_value from helper
                if sector not in sector_positions:
                    sector_positions[sector] = {
                        'positions': [],
                        'total_invested': 0
                    }

                position_info = {
                    'company_name': row['company_name'],
                    'portfolio_name': row['portfolio_name'],
                    'shares': float(row['shares']),
                    'price': float(row['price']),
                    'value': float(row['position_value'])
                }

                sector_positions[sector]['positions'].append(position_info)
                sector_positions[sector]['total_invested'] += position_info['value']

        # Calculate remaining capacity for each sector
        sector_capacity = []
        if sector_positions and total_investable_capital > 0:
            max_per_sector_amount = total_investable_capital * (max_per_sector / 100)

            for sector, data in sector_positions.items():
                current_invested = data['total_invested']
                # Allow negative values for over-allocated sectors
                remaining_capacity = max_per_sector_amount - current_invested

                sector_capacity.append({
                    'sector': sector,
                    'current_invested': current_invested,
                    'max_allowed': max_per_sector_amount,
                    'remaining_capacity': remaining_capacity,
                    'is_over_allocated': remaining_capacity < 0,
                    'positions': data['positions']  # Include individual positions for hover
                })

        # Sort by remaining capacity (ascending - over-allocated sectors first, then least to most capacity)
        sector_capacity.sort(key=lambda x: x['remaining_capacity'])

        logger.info(f"Returning sector capacity data for {len(sector_capacity)} sectors")
        return jsonify({
            'sectors': sector_capacity,
            'total_investable_capital': total_investable_capital,
            'max_per_sector_percent': max_per_sector
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting sector capacity data: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting sector capacity data")
        return error_response('Failed to calculate sector capacity', 500)


@require_auth
def get_effective_capacity_data():
    """
    API endpoint for the Allocation Simulator.

    Returns all data needed for the interactive two-panel slider simulator:
    - availableToInvest: Cash available to allocate (from Builder)
    - All countries with positions and current values
    - All sectors with current values
    - Rules (maxPerCountry, maxPerSector)
    - Position-level detail for proportional distribution

    This supports the Linked Dual-View Simulator where:
    - User adjusts country sliders (primary) → sector totals are derived
    - Or user toggles to sector-first mode
    - Warnings shown when constraints are exceeded (but not hard-stopped)
    """
    logger.info("API request for allocation simulator data")

    account_id = g.account_id
    logger.info(f"Getting allocation simulator data for account_id: {account_id}")

    try:
        # Get budget and rules settings from expanded_state in single query
        state_data = query_db('''
            SELECT variable_name, variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = ? AND variable_name IN (?, ?)
        ''', [account_id, 'build', 'budgetData', 'rules'])

        # Parse budget and rules data
        total_investable_capital = 0
        available_to_invest = 0  # NEW: Cash available from Builder
        max_per_country = 10  # Default value
        max_per_sector = 25  # Default value

        for row in state_data:
            var_name = row.get('variable_name')
            var_value = row.get('variable_value', '{}')
            try:
                parsed_json = json.loads(var_value)
                if var_name == 'budgetData':
                    total_investable_capital = float(parsed_json.get('totalInvestableCapital', 0))
                    # availableToInvest is the cash the user wants to allocate
                    available_to_invest = float(parsed_json.get('availableToInvest', 0))
                elif var_name == 'rules':
                    max_per_country = float(parsed_json.get('maxPerCountry', 10))
                    max_per_sector = float(parsed_json.get('maxPerSector', 25))
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse {var_name} data: {e}")

        logger.info(f"Budget settings - Total: {total_investable_capital}, Max Country: {max_per_country}%, Max Sector: {max_per_sector}%")

        # Get all positions with BOTH country AND sector data
        position_data = query_db('''
            SELECT
                COALESCE(c.override_country, mp.country, 'Unknown') as country,
                COALESCE(c.sector, 'Uncategorized') as sector,
                c.name as company_name,
                p.name as portfolio_name,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                COALESCE(mp.price_eur, 0) as price,
                CASE
                    WHEN c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL THEN c.custom_total_value
                    ELSE (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0))
                END as position_value
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            WHERE c.account_id = ?
            AND COALESCE(cs.override_share, cs.shares, 0) > 0
            AND (COALESCE(mp.price_eur, 0) > 0 OR (c.is_custom_value = 1 AND c.custom_total_value IS NOT NULL))
            ORDER BY country, position_value DESC
        ''', [account_id])

        # Build position lookup structures
        positions_by_country = {}  # country -> list of positions
        positions_by_sector = {}  # sector -> list of positions
        sector_totals = {}  # sector -> total value

        if position_data:
            for row in position_data:
                country = row['country']
                sector = row['sector']
                position_value = float(row['position_value'])

                position_info = {
                    'name': row['company_name'],  # Used by JS renderPositionsList
                    'company_name': row['company_name'],
                    'portfolio_name': row['portfolio_name'],
                    'country': country,  # Needed for sector-first mode position lists
                    'sector': sector,
                    'shares': float(row['shares']),
                    'price': float(row['price']),
                    'value': position_value
                }

                # Group by country
                if country not in positions_by_country:
                    positions_by_country[country] = []
                positions_by_country[country].append(position_info)

                # Group by sector
                if sector not in positions_by_sector:
                    positions_by_sector[sector] = []
                positions_by_sector[sector].append(position_info)

                # Track sector totals
                sector_totals[sector] = sector_totals.get(sector, 0) + position_value

        # Calculate effective capacity for each country
        country_capacity = []
        max_per_country_amount = total_investable_capital * (max_per_country / 100) if total_investable_capital > 0 else 0
        max_per_sector_amount = total_investable_capital * (max_per_sector / 100) if total_investable_capital > 0 else 0

        for country, positions in positions_by_country.items():
            country_current = sum(p['value'] for p in positions)
            country_remaining = max_per_country_amount - country_current

            # Find the tightest sector constraint for positions in this country
            binding_constraint = None
            effective_remaining = country_remaining

            # Get unique sectors in this country
            sectors_in_country = set(p['sector'] for p in positions)

            for sector in sectors_in_country:
                sector_current = sector_totals.get(sector, 0)
                sector_remaining = max_per_sector_amount - sector_current

                # If this sector's remaining capacity is tighter than current effective
                if sector_remaining < effective_remaining:
                    effective_remaining = sector_remaining
                    sector_pct = (sector_current / max_per_sector_amount * 100) if max_per_sector_amount > 0 else 0
                    binding_constraint = f"{sector} at {sector_pct:.0f}%"

            # Calculate sector impact preview (what happens if user invests max in this country)
            sector_impact = {}
            country_total_value = sum(p['value'] for p in positions)

            if country_total_value > 0 and effective_remaining > 0:
                for sector in sectors_in_country:
                    # Calculate how much of new investment would go to this sector
                    # (proportional to existing distribution)
                    sector_value_in_country = sum(p['value'] for p in positions if p['sector'] == sector)
                    proportion = sector_value_in_country / country_total_value

                    additional_to_sector = effective_remaining * proportion
                    sector_current = sector_totals.get(sector, 0)
                    new_sector_total = sector_current + additional_to_sector

                    current_pct = (sector_current / total_investable_capital * 100) if total_investable_capital > 0 else 0
                    new_pct = (new_sector_total / total_investable_capital * 100) if total_investable_capital > 0 else 0

                    sector_impact[sector] = {
                        'current': round(current_pct, 1),
                        'if_max_invest': round(new_pct, 1),
                        'is_ok': new_pct <= max_per_sector
                    }

            country_capacity.append({
                'country': country,
                'current_invested': round(country_current, 2),
                'country_max': round(max_per_country_amount, 2),
                'country_remaining': round(country_remaining, 2),
                'effective_remaining': round(max(0, effective_remaining), 2),
                'binding_constraint': binding_constraint,
                'positions': positions,
                'sector_impact': sector_impact
            })

        # Sort by effective remaining capacity (ascending - blocked first, then least capacity)
        country_capacity.sort(key=lambda x: x['effective_remaining'])

        # Build sector data for the simulator
        sectors_list = []
        max_per_sector_amount = total_investable_capital * (max_per_sector / 100) if total_investable_capital > 0 else 0
        for sector, total in sector_totals.items():
            sector_remaining = max_per_sector_amount - total
            sector_pct = (total / total_investable_capital * 100) if total_investable_capital > 0 else 0
            sectors_list.append({
                'sector': sector,
                'current_invested': round(total, 2),
                'sector_max': round(max_per_sector_amount, 2),
                'sector_remaining': round(sector_remaining, 2),
                'current_percent': round(sector_pct, 1),
                'positions': positions_by_sector.get(sector, [])
            })

        # Sort sectors by current invested (descending)
        sectors_list.sort(key=lambda x: x['current_invested'], reverse=True)

        # Build summary
        blocked_countries = [c['country'] for c in country_capacity if c['effective_remaining'] <= 0]
        constrained_by_sector = [c['country'] for c in country_capacity if c['binding_constraint'] is not None and c['effective_remaining'] > 0]
        total_effective_capacity = sum(max(0, c['effective_remaining']) for c in country_capacity)

        # Count constraint violations for warnings
        countries_over_limit = sum(1 for c in country_capacity
                                   if c['current_invested'] > c['country_max'])
        sectors_over_limit = sum(1 for c in sectors_list
                                    if c['current_invested'] > c['sector_max'])

        logger.info(f"Returning allocation simulator data: {len(country_capacity)} countries, {len(sectors_list)} sectors")
        return jsonify({
            'countries': country_capacity,
            'sectors': sectors_list,  # For sector panel
            'available_to_invest': available_to_invest,  # Cash to allocate
            'total_investable_capital': total_investable_capital,
            'rules': {
                'maxPerCountry': max_per_country,
                'maxPerSector': max_per_sector
            },
            'summary': {
                'total_effective_capacity': round(total_effective_capacity, 2),
                'blocked_countries': blocked_countries,
                'constrained_by_sector': constrained_by_sector,
                'countries_over_limit': countries_over_limit,
                'sectors_over_limit': sectors_over_limit
            }
        })

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error getting effective capacity data: {str(e)}")
        return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
    except Exception as e:
        logger.exception(f"Unexpected error getting effective capacity data")
        return error_response('Failed to calculate effective capacity', 500)


