from flask import (
    Blueprint, render_template, redirect, url_for,
    request, flash, session, jsonify, current_app
)
from app.database.db_manager import query_db, execute_db, backup_database, get_db
from app.utils.security import rate_limit
import sqlite3
import logging
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger('app.routes.account')

account_bp = Blueprint('account', __name__)


@account_bp.route('/')
def index():
    """Account management page"""
    # Check if user is authenticated with an account
    if 'account_id' not in session:
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)

    # Get all accounts for the account switcher
    all_accounts = query_db(
        'SELECT * FROM accounts WHERE username != "_global" ORDER BY username')

    return render_template('pages/account.html',
                           account=account,
                           all_accounts=all_accounts)


@account_bp.route('/create', methods=['POST'])
@rate_limit("10 per minute")
def create_account():
    """Create a new account"""
    username = request.form.get('username', '').strip()

    if not username:
        flash('Username cannot be empty', 'error')
        return redirect(url_for('account.index'))

    try:
        # Create backup before making changes
        backup_database()

        # Insert new account
        created_at = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        execute_db(
            'INSERT INTO accounts (username, created_at) VALUES (?, ?)',
            [username, created_at]
        )

        # Get the new account ID
        new_account = query_db(
            'SELECT id FROM accounts WHERE username = ?',
            [username],
            one=True
        )

        if new_account and isinstance(new_account, dict):
            account_id = new_account.get('id')
            # Create default portfolio for the account
            execute_db(
                'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                ['-', account_id]
            )

            # Update session to use the new account
            session['account_id'] = account_id
            session['username'] = username

            flash(f'Account "{username}" created successfully', 'success')
        else:
            flash('Failed to create account', 'error')

    except sqlite3.IntegrityError:
        flash(f'Account "{username}" already exists', 'error')
    except Exception as e:
        flash(f'Error creating account: {str(e)}', 'error')

    return redirect(url_for('main.index'))


@account_bp.route('/update', methods=['POST'])
def update_account():
    """Update account username"""
    if 'account_id' not in session:
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    new_username = request.form.get('new_username', '').strip()

    if not new_username:
        flash('Username cannot be empty', 'error')
        return redirect(url_for('account.index'))

    try:
        # Create backup before making changes
        backup_database()

        # Update username
        rows_affected = execute_db(
            'UPDATE accounts SET username = ? WHERE id = ?',
            [new_username, account_id]
        )

        if rows_affected > 0:
            # Update session with new username
            session['username'] = new_username
            flash(f'Username updated to "{new_username}"', 'success')
        else:
            flash('No changes made', 'warning')

    except sqlite3.IntegrityError:
        flash(f'Username "{new_username}" already exists', 'error')
    except Exception as e:
        flash(f'Error updating username: {str(e)}', 'error')

    return redirect(url_for('account.index'))


@account_bp.route('/reset-settings', methods=['POST'])
def reset_account_settings():
    """Reset all saved settings for the current account."""
    if 'account_id' not in session:
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']

    try:
        # Create backup before making changes
        backup_database()

        # Remove all expanded_state entries for this account
        execute_db('DELETE FROM expanded_state WHERE account_id = ?', [account_id])

        flash('Account settings have been reset', 'success')
    except Exception as e:
        logger.error(f"Error resetting account settings: {str(e)}")
        flash(f'Error resetting account settings: {str(e)}', 'error')

    return redirect(url_for('account.index'))


@account_bp.route('/delete', methods=['POST'])
@rate_limit("5 per minute")
def delete_account():
    """Delete an account and all associated data"""
    if 'account_id' not in session:
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']
    confirmation = request.form.get('confirmation', '')

    if confirmation != 'DELETE':
        flash('Please type DELETE to confirm account deletion', 'error')
        return redirect(url_for('account.index'))

    try:
        # Create backup before making changes
        backup_database()

        # Use context manager so commit/rollback happen automatically
        with get_db() as db:
            # Delete related data in the correct order to maintain foreign key constraints
            db.execute(
                'DELETE FROM expanded_state WHERE account_id = ?', [account_id])

            # Find identifiers used by this account
            identifiers = query_db('''
                SELECT DISTINCT identifier
                FROM companies
                WHERE account_id = ? AND identifier IS NOT NULL AND identifier != ''
            ''', [account_id])

            # Remove related company data
            db.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (
                    SELECT id FROM companies WHERE account_id = ?
                )
            ''', [account_id])
            db.execute(
                'DELETE FROM companies WHERE account_id = ?', [account_id])
            db.execute(
                'DELETE FROM portfolios WHERE account_id = ?', [account_id])

            # Delete market prices not used by other accounts
            deleted_count = 0
            try:
                remaining_accounts = query_db(
                    'SELECT COUNT(*) as count FROM accounts WHERE id != ?', [account_id])
                is_last_account = remaining_accounts and remaining_accounts[0]['count'] == 0

                if is_last_account:
                    logger.info(
                        "This is the last account - deleting all market prices")
                    market_prices_count = query_db(
                        'SELECT COUNT(*) as count FROM market_prices')
                    count_to_delete = market_prices_count[0]['count'] if market_prices_count else 0
                    if count_to_delete > 0:
                        db.execute('DELETE FROM market_prices')
                        logger.info(
                            f"Deleted all {count_to_delete} market prices as the last account was deleted")
                        deleted_count = count_to_delete
                else:
                    if identifiers:
                        logger.info(
                            f"Checking {len(identifiers)} market prices for potential cleanup after account deletion")
                        for item in identifiers:
                            identifier = item['identifier']
                            other_usages = query_db('''
                                SELECT 1 FROM companies
                                WHERE identifier = ?
                                LIMIT 1
                            ''', [identifier])
                            if not other_usages:
                                logger.info(
                                    f"Deleting orphaned market price for identifier: {identifier}")
                                db.execute(
                                    'DELETE FROM market_prices WHERE identifier = ?', [identifier])
                                deleted_count += 1

                if deleted_count > 0:
                    logger.info(
                        f"Deleted {deleted_count} orphaned market prices during account deletion")

                if not is_last_account:
                    all_company_identifiers = query_db('''
                        SELECT DISTINCT identifier FROM companies
                        WHERE identifier IS NOT NULL AND identifier != ''
                    ''')
                    used_identifiers = {
                        item['identifier'] for item in all_company_identifiers} if all_company_identifiers else set()
                    all_price_records = query_db(
                        'SELECT identifier FROM market_prices')
                    if all_price_records:
                        for item in all_price_records:
                            identifier = item['identifier']
                            if identifier not in used_identifiers:
                                logger.info(
                                    f"Found additional orphaned market price to delete: {identifier}")
                                db.execute(
                                    'DELETE FROM market_prices WHERE identifier = ?', [identifier])
                                deleted_count += 1
            except Exception as e:
                logger.error(
                    f"Error while cleaning up market prices: {str(e)}")

            db.execute('DELETE FROM accounts WHERE id = ?', [account_id])

        session.pop('account_id', None)
        session.pop('username', None)

        flash('Account deleted successfully', 'success')

    except Exception as e:
        flash(f'Error deleting account: {str(e)}', 'error')

    return redirect(url_for('main.index'))


@account_bp.route('/delete-stocks-crypto', methods=['POST'])
def delete_stocks_crypto():
    """Delete all stocks and crypto data for the current account"""
    if 'account_id' not in session:
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))

    account_id = session['account_id']

    try:
        # Create backup before making changes
        backup_database()

        # Use context manager so commit/rollback happen automatically
        with get_db() as db:
            # Find identifiers used by this account before deletion
            identifiers = query_db('''
                SELECT DISTINCT identifier
                FROM companies
                WHERE account_id = ? AND identifier IS NOT NULL AND identifier != ''
            ''', [account_id])

            # Delete company shares for this account
            db.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (
                    SELECT id FROM companies WHERE account_id = ?
                )
            ''', [account_id])

            # Delete companies for this account
            db.execute('DELETE FROM companies WHERE account_id = ?', [account_id])

            # Clean up orphaned market prices (only those not used by other accounts)
            deleted_count = 0
            if identifiers:
                logger.info(f"Checking {len(identifiers)} market prices for potential cleanup after stock/crypto deletion")
                
                for item in identifiers:
                    identifier = item['identifier']
                    # Check if this identifier is still used by other accounts
                    other_usages = query_db('''
                        SELECT 1 FROM companies
                        WHERE identifier = ?
                        LIMIT 1
                    ''', [identifier])
                    
                    if not other_usages:
                        logger.info(f"Deleting orphaned market price for identifier: {identifier}")
                        db.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])
                        deleted_count += 1

                if deleted_count > 0:
                    logger.info(f"Deleted {deleted_count} orphaned market prices during stock/crypto deletion")
            else:
                logger.info("No identifiers found for cleanup after stock/crypto deletion")

        flash('All stocks and crypto data deleted successfully', 'success')

    except Exception as e:
        logger.error(f"Error deleting stocks/crypto data: {str(e)}")
        flash(f'Error deleting stocks/crypto data: {str(e)}', 'error')

    return redirect(url_for('account.index'))
