import json
import logging
from datetime import datetime

from flask import g, jsonify, request, session

from app.db_manager import backup_database, execute_db, get_db, query_db
from app.utils.db_utils import utc_now_iso
from app.decorators import require_auth
from app.utils.response_helpers import (
    error_response,
    not_found_response,
    validation_error_response,
)


logger = logging.getLogger(__name__)


@require_auth
def get_account_cash():
    """
    Get cash balance for the current account.

    GET /portfolio/api/account/cash

    Returns:
        - cash: Current cash balance
    """
    try:
        from app.repositories.account_repository import AccountRepository

        account_id = g.account_id
        cash = AccountRepository.get_cash(account_id)

        logger.debug(f"Returning cash balance for account {account_id}: {cash}")
        return jsonify({
            'success': True,
            'cash': cash
        })

    except Exception as e:
        logger.exception("Error getting account cash balance")
        return error_response('Failed to get cash balance', 500)


@require_auth
def set_account_cash():
    """
    Update cash balance for the current account.

    POST /portfolio/api/account/cash
    Body: { "cash": 5000.00 }

    Returns:
        - cash: Updated cash balance
    """
    try:
        from app.repositories.account_repository import AccountRepository

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return validation_error_response('request', 'Request body is required')

        cash_value = data.get('cash')
        if cash_value is None:
            return validation_error_response('cash', 'Cash value is required')

        try:
            cash = float(cash_value)
        except (TypeError, ValueError):
            return validation_error_response('cash', 'Cash must be a valid number')

        if cash < 0:
            return validation_error_response('cash', 'Cash cannot be negative')

        success = AccountRepository.set_cash(account_id, cash)

        if not success:
            return error_response('Failed to update cash balance', 500)

        logger.info(f"Updated cash balance for account {account_id}: {cash}")
        return jsonify({
            'success': True,
            'cash': cash
        })

    except Exception as e:
        logger.exception("Error setting account cash balance")
        return error_response('Failed to update cash balance', 500)


# =============================================================================
# Manual Stock Management API
# =============================================================================
@require_auth
def get_account_info():
    """
    Get account information.

    GET /portfolio/api/account

    Returns:
        - username, account_id, created_at, last_price_update
    """
    try:
        account_id = g.account_id
        account = query_db(
            'SELECT id, username, created_at, last_price_update FROM accounts WHERE id = ?',
            [account_id], one=True
        )

        if not account:
            return not_found_response('account', account_id)

        return jsonify({
            'success': True,
            'username': account['username'],
            'account_id': account['id'],
            'created_at': account['created_at'],
            'last_price_update': account.get('last_price_update')
        })

    except Exception as e:
        logger.exception("Error getting account info")
        return error_response('Failed to get account info', 500)


@require_auth
def update_account_username():
    """
    Update account username.

    PUT /portfolio/api/account/username
    Body: { "username": "new_name" }
    """
    try:
        import sqlite3 as _sqlite3

        account_id = g.account_id
        data = request.get_json()

        if not data:
            return validation_error_response('request', 'Request body is required')

        new_username = (data.get('username') or '').strip()
        if not new_username:
            return validation_error_response('username', 'Username cannot be empty')

        backup_database()

        rows_affected = execute_db(
            'UPDATE accounts SET username = ? WHERE id = ?',
            [new_username, account_id]
        )

        if rows_affected > 0:
            session['username'] = new_username
            return jsonify({'success': True})
        else:
            return error_response('No changes made', 400)

    except _sqlite3.IntegrityError:
        return validation_error_response('username', f'Username "{new_username}" already exists')
    except Exception as e:
        logger.exception("Error updating username")
        return error_response('Failed to update username', 500)


@require_auth
def api_reset_account_settings():
    """
    Reset all saved settings for the current account.

    POST /portfolio/api/account/reset-settings
    """
    try:
        account_id = g.account_id
        backup_database()
        execute_db('DELETE FROM expanded_state WHERE account_id = ?', [account_id])
        return jsonify({'success': True})

    except Exception as e:
        logger.exception("Error resetting account settings")
        return error_response('Failed to reset account settings', 500)


@require_auth
def api_delete_stocks_crypto():
    """
    Delete all stocks and crypto data for the current account.

    POST /portfolio/api/account/delete-stocks-crypto
    """
    try:
        account_id = g.account_id
        backup_database()

        with get_db() as db:
            identifiers = query_db('''
                SELECT DISTINCT identifier
                FROM companies
                WHERE account_id = ? AND identifier IS NOT NULL AND identifier != ''
            ''', [account_id])

            db.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (
                    SELECT id FROM companies WHERE account_id = ?
                )
            ''', [account_id])

            db.execute('DELETE FROM companies WHERE account_id = ?', [account_id])

            deleted_count = 0
            if identifiers:
                for item in identifiers:
                    identifier = item['identifier']
                    other_usages = query_db('''
                        SELECT 1 FROM companies WHERE identifier = ? LIMIT 1
                    ''', [identifier])
                    if not other_usages:
                        db.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])
                        deleted_count += 1

                if deleted_count > 0:
                    logger.info(f"Deleted {deleted_count} orphaned market prices during stock/crypto deletion")

        return jsonify({'success': True})

    except Exception as e:
        logger.exception("Error deleting stocks/crypto data")
        return error_response('Failed to delete stocks and crypto data', 500)


@require_auth
def api_delete_account():
    """
    Delete account and all associated data.

    POST /portfolio/api/account/delete
    Body: { "confirmation": "DELETE" }
    """
    try:
        account_id = g.account_id
        data = request.get_json()

        if not data or data.get('confirmation') != 'DELETE':
            return validation_error_response('confirmation', 'Please type DELETE to confirm account deletion')

        backup_database()

        with get_db() as db:
            db.execute('DELETE FROM expanded_state WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM simulations WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM identifier_mappings WHERE account_id = ?', [account_id])

            identifiers = query_db('''
                SELECT DISTINCT identifier
                FROM companies
                WHERE account_id = ? AND identifier IS NOT NULL AND identifier != ''
            ''', [account_id])

            db.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (
                    SELECT id FROM companies WHERE account_id = ?
                )
            ''', [account_id])
            db.execute('DELETE FROM companies WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM portfolios WHERE account_id = ?', [account_id])

            # Delete market prices not used by other accounts
            deleted_count = 0
            try:
                remaining_accounts = query_db(
                    'SELECT COUNT(*) as count FROM accounts WHERE id != ?', [account_id])
                is_last_account = remaining_accounts and remaining_accounts[0]['count'] == 0

                if is_last_account:
                    logger.info("This is the last account - deleting all market prices")
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

        return jsonify({'success': True})

    except Exception as e:
        logger.exception("Error deleting account")
        return error_response('Failed to delete account', 500)


@require_auth
def api_import_account_data():
    """
    Import account data from JSON file upload.

    POST /portfolio/api/account/import
    Content-Type: multipart/form-data with 'file' field
    """
    try:
        account_id = g.account_id

        if 'file' not in request.files:
            return validation_error_response('file', 'No file selected')

        file = request.files['file']
        if file.filename == '':
            return validation_error_response('file', 'No file selected')

        file_content = file.read().decode('utf-8')
        import_payload = json.loads(file_content)

        if 'export_version' not in import_payload or 'data' not in import_payload:
            return validation_error_response('file', 'Invalid export file format')

        backup_database()

        with get_db() as db:
            # Delete existing data
            identifiers = query_db('''
                SELECT DISTINCT identifier
                FROM companies
                WHERE account_id = ? AND identifier IS NOT NULL AND identifier != ''
            ''', [account_id])

            db.execute('DELETE FROM expanded_state WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM identifier_mappings WHERE account_id = ?', [account_id])
            db.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (SELECT id FROM companies WHERE account_id = ?)
            ''', [account_id])
            db.execute('DELETE FROM companies WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM simulations WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM portfolios WHERE account_id = ?', [account_id])

            # Clean up orphaned market prices
            if identifiers:
                for item in identifiers:
                    identifier = item['identifier']
                    other_usages = query_db('SELECT 1 FROM companies WHERE identifier = ? LIMIT 1', [identifier])
                    if not other_usages:
                        db.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])

            # Import new data with ID remapping
            data = import_payload['data']
            old_to_new_portfolio_map = {}
            old_to_new_company_map = {}

            # Import portfolios
            if 'portfolios' in data and data['portfolios']:
                for portfolio in data['portfolios']:
                    name = portfolio['name'].strip().lower() if portfolio['name'] else portfolio['name']
                    db.execute('INSERT INTO portfolios (name, account_id) VALUES (?, ?)', [name, account_id])

            cursor = db.execute('SELECT id, name FROM portfolios WHERE account_id = ?', [account_id])
            db_portfolios = cursor.fetchall()
            name_to_new_id = {row['name']: row['id'] for row in db_portfolios}

            for old_portfolio in data.get('portfolios', []):
                old_id = old_portfolio['id']
                name = old_portfolio['name']
                new_id = name_to_new_id.get(name)
                if new_id is not None:
                    old_to_new_portfolio_map[old_id] = new_id

            # Import companies
            if 'companies' in data and data['companies']:
                for company in data['companies']:
                    new_portfolio_id = old_to_new_portfolio_map.get(company['portfolio_id'])
                    if new_portfolio_id:
                        old_company_id = company['id']
                        cursor = db.execute('''
                            INSERT INTO companies (name, identifier, sector, portfolio_id, account_id,
                                                 total_invested, override_country, country_manually_edited,
                                                 country_manual_edit_date)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', [
                            company['name'], company['identifier'], company['sector'],
                            new_portfolio_id, account_id, company.get('total_invested', 0),
                            company.get('override_country'), company.get('country_manually_edited', 0),
                            company.get('country_manual_edit_date')
                        ])
                        old_to_new_company_map[old_company_id] = cursor.lastrowid

            # Import company_shares
            if 'company_shares' in data and data['company_shares']:
                for share in data['company_shares']:
                    new_company_id = old_to_new_company_map.get(share['company_id'])
                    if new_company_id:
                        db.execute('''
                            INSERT INTO company_shares (company_id, shares, override_share,
                                                      manual_edit_date, is_manually_edited,
                                                      csv_modified_after_edit)
                            VALUES (?, ?, ?, ?, ?, ?)
                        ''', [
                            new_company_id, share.get('shares'), share.get('override_share'),
                            share.get('manual_edit_date'), share.get('is_manually_edited', 0),
                            share.get('csv_modified_after_edit', 0)
                        ])

            # Import expanded_state with portfolio ID remapping
            if 'expanded_state' in data and data['expanded_state']:
                for state in data['expanded_state']:
                    variable_value = state['variable_value']
                    if state['page_name'] == 'builder' and state['variable_name'] == 'portfolios':
                        try:
                            portfolios_data = json.loads(variable_value)
                            for portfolio_item in portfolios_data:
                                old_id = portfolio_item.get('id')
                                if old_id in old_to_new_portfolio_map:
                                    portfolio_item['id'] = old_to_new_portfolio_map[old_id]
                            variable_value = json.dumps(portfolios_data)
                        except json.JSONDecodeError:
                            pass
                    db.execute('''
                        INSERT INTO expanded_state (account_id, page_name, variable_name,
                                                  variable_type, variable_value, last_updated)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', [
                        account_id, state['page_name'], state['variable_name'],
                        state['variable_type'], variable_value,
                        state.get('last_updated', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'))
                    ])

            # Import identifier_mappings
            if 'identifier_mappings' in data and data['identifier_mappings']:
                for mapping in data['identifier_mappings']:
                    db.execute('''
                        INSERT INTO identifier_mappings (account_id, csv_identifier, preferred_identifier,
                                                       company_name, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', [
                        account_id, mapping['csv_identifier'], mapping['preferred_identifier'],
                        mapping.get('company_name'),
                        mapping.get('created_at', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')),
                        mapping.get('updated_at', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'))
                    ])

            # Import simulations
            if 'simulations' in data and data['simulations']:
                for sim in data['simulations']:
                    old_portfolio_id = sim.get('portfolio_id')
                    new_portfolio_id = None
                    if old_portfolio_id is not None:
                        new_portfolio_id = old_to_new_portfolio_map.get(old_portfolio_id)
                        if new_portfolio_id is None:
                            continue
                    db.execute('''
                        INSERT INTO simulations (account_id, name, scope, portfolio_id, items, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', [
                        account_id, sim['name'], sim.get('scope', 'global'),
                        new_portfolio_id, sim['items'],
                        sim.get('created_at', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')),
                        sim.get('updated_at', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'))
                    ])

            db.execute(
                'UPDATE accounts SET last_price_update = ? WHERE id = ?',
                [utc_now_iso(), account_id]
            )

        return jsonify({'success': True})

    except json.JSONDecodeError:
        return validation_error_response('file', 'Invalid JSON file format')
    except Exception as e:
        logger.exception("Error importing account data")
        return error_response('Failed to import account data', 500)
