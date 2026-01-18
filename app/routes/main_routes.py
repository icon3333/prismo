from app.utils.portfolio_utils import get_portfolio_data
from app.db_manager import query_db
from flask import Blueprint, render_template, redirect, url_for, session, request, flash, jsonify
from app.exceptions import ValidationError, DataIntegrityError
import logging
import json
import math
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

main_bp = Blueprint('main', __name__)


def calculate_missing_positions(account_id: int, portfolios) -> Dict[str, Any]:
    """
    Calculate missing positions for each portfolio using rebalancer data.

    Uses the internal allocation function directly to avoid session manipulation.

    Args:
        account_id: The account ID to fetch data for
        portfolios: List of portfolios to check

    Returns:
        Dictionary with missing position statistics
    """
    try:
        # Import the pure function (no Flask dependencies, safe to import)
        from app.routes.portfolio_api import _get_allocate_portfolio_data_internal

        try:
            # Call internal function directly with account_id - no session manipulation
            rebalancer_data = _get_allocate_portfolio_data_internal(account_id)
        except (ValidationError, DataIntegrityError) as e:
            logger.error(f"Error getting rebalancer data: {e}")
            return {
                'portfolios_with_missing': [],
                'total_missing': 0,
                'total_portfolios_checked': 0
            }
        except Exception as e:
            logger.exception(f"Unexpected error getting rebalancer data")
            return {
                'portfolios_with_missing': [],
                'total_missing': 0,
                'total_portfolios_checked': 0
            }
        
        missing_data = {
            'portfolios_with_missing': [],
            'total_missing': 0,
            'total_portfolios_checked': 0
        }
        
        if not rebalancer_data or not isinstance(rebalancer_data, dict) or 'portfolios' not in rebalancer_data:
            return missing_data
        
        # Check each portfolio in the rebalancer data
        portfolios_list = rebalancer_data.get('portfolios', [])
        for portfolio in portfolios_list:
            if not isinstance(portfolio, dict):
                continue
                
            portfolio_name = portfolio.get('name', 'Unknown')
            missing_data['total_portfolios_checked'] += 1
            
            # Look for "Missing Positions" sector
            sectors = portfolio.get('sectors', [])
            missing_positions_sector = None

            for sector in sectors:
                if sector.get('name') == 'Missing Positions':
                    missing_positions_sector = sector
                    break

            if missing_positions_sector:
                # Count missing positions from the sector
                missing_positions = missing_positions_sector.get('positions', [])
                missing_count = len(missing_positions)
                
                # Only include if there are actual missing positions with target allocation > 0
                has_missing_with_allocation = any(
                    pos.get('targetAllocation', 0) > 0 for pos in missing_positions
                )
                
                if missing_count > 0 and has_missing_with_allocation:
                    # Count current positions (all categories except Missing Positions)
                    current_positions = 0
                    for cat in categories:
                        if cat.get('name') != 'Missing Positions':
                            current_positions += len(cat.get('positions', []))
                    
                    # Calculate min positions (current + missing)
                    min_positions = current_positions + missing_count
                    
                    missing_data['portfolios_with_missing'].append({
                        'name': portfolio_name,
                        'missing_count': missing_count,
                        'current_positions': current_positions,
                        'min_positions': min_positions
                    })
                    missing_data['total_missing'] += missing_count
        
        return missing_data

    except (ValidationError, DataIntegrityError) as e:
        logger.error(f"Error calculating missing positions: {e}")
        return {
            'portfolios_with_missing': [],
            'total_missing': 0,
            'total_portfolios_checked': 0
        }
    except Exception as e:
        logger.exception(f"Unexpected error calculating missing positions")
        return {
            'portfolios_with_missing': [],
            'total_missing': 0,
            'total_portfolios_checked': 0
        }


@main_bp.route('/')
def index():
    """Homepage route"""
    logger.info("Accessing homepage")

    # Check if user has an account selected
    account_id = session.get('account_id')
    logger.info(f"Current account_id in session: {account_id}")
    logger.info(f"Full session content: {dict(session)}")
    logger.info(f"Session permanent: {session.permanent}")

    if account_id:
        # Get account information
        account = query_db('SELECT * FROM accounts WHERE id = ?',
                           [account_id], one=True)

        if account and isinstance(account, dict):
            logger.info(f"Found account: {account['username']}")

            # Get portfolio summary for the account - only count portfolios with value > 0
            portfolios = query_db('''
                SELECT p.id, p.name, 
                       COUNT(DISTINCT c.id) as company_count,
                       SUM(COALESCE(cs.override_share, cs.shares, 0) * mp.price_eur) as total_value
                FROM portfolios p
                LEFT JOIN companies c ON p.id = c.portfolio_id
                LEFT JOIN company_shares cs ON c.id = cs.company_id
                LEFT JOIN market_prices mp ON c.identifier = mp.identifier
                WHERE p.account_id = ?
                GROUP BY p.id, p.name
                HAVING SUM(COALESCE(cs.override_share, cs.shares, 0) * mp.price_eur) > 0
            ''', [account_id])

            # Get portfolio data to calculate total value consistently with enrich page
            portfolio_data = get_portfolio_data(account_id)

            # Calculate total value the same way as in enrich page
            total_value = sum(
                (item['price_eur'] or 0) * (item['effective_shares'] or 0)
                for item in portfolio_data
            )

            # Count total assets (positions) with actual shares and prices
            total_assets = sum(1 for item in portfolio_data if (
                item['effective_shares'] or 0) > 0 and (item['price_eur'] or 0) > 0)

            # Calculate missing positions for each portfolio
            missing_positions_data = calculate_missing_positions(account_id, portfolios)

            # Get all accounts for account switcher
            all_accounts = query_db(
                'SELECT * FROM accounts WHERE username != "_global" ORDER BY username')

            # Ensure portfolios is a list for len() function
            portfolio_count = len(portfolios) if portfolios else 0
            logger.info(f"Found {portfolio_count} portfolios with value > 0")
            return render_template('pages/index.html',
                                   account=account,
                                   portfolios=portfolios,
                                   total_value=total_value,
                                   total_assets=total_assets,
                                   missing_positions_data=missing_positions_data,
                                   all_accounts=all_accounts)
        else:
            logger.warning(f"Account {account_id} not found")
            session.pop('account_id', None)
            session.pop('username', None)

    # If no account is selected or account not found, show the welcome page
    accounts = query_db(
        'SELECT * FROM accounts WHERE username != "_global" ORDER BY username')
    account_count = len(accounts) if accounts else 0
    logger.info(f"Found {account_count} accounts")
    return render_template('pages/index.html', accounts=accounts)


@main_bp.route('/select_account/<int:account_id>')
def select_account(account_id):
    """Select an account and store it in the session"""
    logger.info(f"Selecting account: {account_id}")

    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)

    if account and isinstance(account, dict):
        session.permanent = True  # Make session permanent
        session['account_id'] = account_id
        session['username'] = account['username']
        session.modified = True  # Explicitly mark session as modified
        logger.info(
            f"Account selected: {account['username']} (ID: {account_id})")
        logger.info(f"Updated session: {dict(session)}")
        flash(f'Switched to account: {account["username"]}', 'success')
    else:
        logger.warning(f"Account not found: {account_id}")
        flash('Account not found', 'error')

    return redirect(url_for('main.index'))


@main_bp.route('/clear_account')
def clear_account():
    """Clear the selected account from session"""
    if 'account_id' in session:
        del session['account_id']
    if 'username' in session:
        del session['username']

    return redirect(url_for('main.index'))


@main_bp.route('/api/accounts')
def get_accounts():
    """API endpoint to get all accounts"""
    accounts = query_db(
        'SELECT id, username, created_at FROM accounts WHERE username != "_global"')
    return jsonify(accounts)
