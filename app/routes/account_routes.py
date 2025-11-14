from flask import (
    Blueprint, render_template, redirect, url_for,
    request, flash, session, jsonify, current_app, send_file, g
)
from app.db_manager import query_db, execute_db, backup_database, get_db
from app.decorators import require_auth
from app.exceptions import ValidationError, DataIntegrityError

import sqlite3
import logging
import json
import io
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger('app.routes.account')

account_bp = Blueprint('account', __name__)


@account_bp.route('/')
@require_auth
def index():
    """Account management page"""
    account_id = g.account_id
    account = g.account

    # Get all accounts for the account switcher
    all_accounts = query_db(
        'SELECT * FROM accounts WHERE username != "_global" ORDER BY username')

    return render_template('pages/account.html',
                           account=account,
                           all_accounts=all_accounts)


@account_bp.route('/create', methods=['POST'])
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
            # Default portfolio creation disabled to avoid import conflicts
            # execute_db(
            #     'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
            #     ['-', account_id]
            # )

            # Update session to use the new account
            session['account_id'] = account_id
            session['username'] = username

            flash(f'Account "{username}" created successfully', 'success')
        else:
            flash('Failed to create account', 'error')

    except sqlite3.IntegrityError:
        flash(f'Account "{username}" already exists', 'error')
    except (DataIntegrityError, ValidationError) as e:
        flash(f'Error creating account: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error creating account")
        flash('An unexpected error occurred while creating account', 'error')

    return redirect(url_for('main.index'))


@account_bp.route('/update', methods=['POST'])
@require_auth
def update_account():
    """Update account username"""
    account_id = g.account_id
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
    except (DataIntegrityError, ValidationError) as e:
        flash(f'Error updating username: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error updating username")
        flash('An unexpected error occurred while updating username', 'error')

    return redirect(url_for('account.index'))


@account_bp.route('/reset-settings', methods=['POST'])
@require_auth
def reset_account_settings():
    """Reset all saved settings for the current account."""
    account_id = g.account_id

    try:
        # Create backup before making changes
        backup_database()

        # Remove all expanded_state entries for this account
        execute_db('DELETE FROM expanded_state WHERE account_id = ?', [account_id])

        flash('Account settings have been reset', 'success')
    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error resetting account settings: {str(e)}")
        flash(f'Error resetting account settings: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error resetting account settings")
        flash('An unexpected error occurred while resetting settings', 'error')

    return redirect(url_for('account.index'))


@account_bp.route('/delete', methods=['POST'])
@require_auth
def delete_account():
    """Delete an account and all associated data"""
    account_id = g.account_id
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

    except (DataIntegrityError, ValidationError) as e:
        flash(f'Error deleting account: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error deleting account")
        flash('An unexpected error occurred while deleting account', 'error')

    return redirect(url_for('main.index'))


@account_bp.route('/delete-stocks-crypto', methods=['POST'])
@require_auth
def delete_stocks_crypto():
    """Delete all stocks and crypto data for the current account"""
    account_id = g.account_id

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

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error deleting stocks/crypto data: {str(e)}")
        flash(f'Error deleting stocks/crypto data: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error deleting stocks/crypto data")
        flash('An unexpected error occurred while deleting stocks/crypto data', 'error')

    return redirect(url_for('account.index'))


@account_bp.route('/export')
@require_auth
def export_data():
    """Export all account data as JSON file"""
    account_id = g.account_id
    username = session.get('username', 'unknown')

    try:
        # Export data for the current account
        export_data = {
            'export_version': '1.0',
            'exported_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
            'data': {}
        }

        # Export portfolios
        portfolios = query_db('SELECT * FROM portfolios WHERE account_id = ?', [account_id])
        export_data['data']['portfolios'] = portfolios if portfolios else []

        # Export companies
        companies = query_db('SELECT * FROM companies WHERE account_id = ?', [account_id])
        export_data['data']['companies'] = companies if companies else []

        # Export company_shares (for companies belonging to this account)
        company_shares = query_db('''
            SELECT cs.* FROM company_shares cs
            JOIN companies c ON cs.company_id = c.id
            WHERE c.account_id = ?
        ''', [account_id])
        export_data['data']['company_shares'] = company_shares if company_shares else []

        # Export expanded_state (user settings)
        expanded_state = query_db('SELECT * FROM expanded_state WHERE account_id = ?', [account_id])
        export_data['data']['expanded_state'] = expanded_state if expanded_state else []

        # Export identifier_mappings
        identifier_mappings = query_db('SELECT * FROM identifier_mappings WHERE account_id = ?', [account_id])
        export_data['data']['identifier_mappings'] = identifier_mappings if identifier_mappings else []

        # Create JSON file in memory
        json_data = json.dumps(export_data, indent=2, default=str)
        json_file = io.BytesIO(json_data.encode('utf-8'))
        
        # Generate filename
        timestamp = datetime.utcnow().strftime('%Y%m%d')
        filename = f'account_export_{username}_{timestamp}.json'

        return send_file(
            json_file,
            as_attachment=True,
            download_name=filename,
            mimetype='application/json'
        )

    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error exporting account data: {str(e)}")
        flash(f'Error exporting account data: {str(e)}', 'error')
        return redirect(url_for('account.index'))
    except Exception as e:
        logger.exception(f"Unexpected error exporting account data")
        flash('An unexpected error occurred while exporting account data', 'error')
        return redirect(url_for('account.index'))


@account_bp.route('/import', methods=['POST'])
@require_auth
def import_data():
    """Import account data from JSON file, overwriting existing data"""
    account_id = g.account_id

    # Check if file was uploaded
    if 'import_file' not in request.files:
        flash('No file selected', 'error')
        return redirect(url_for('account.index'))

    file = request.files['import_file']
    if file.filename == '':
        flash('No file selected', 'error')
        return redirect(url_for('account.index'))

    try:
        # Read and validate JSON file
        file_content = file.read().decode('utf-8')
        import_data = json.loads(file_content)

        # Validate file structure
        if 'export_version' not in import_data or 'data' not in import_data:
            flash('Invalid export file format', 'error')
            return redirect(url_for('account.index'))

        # Create backup before making changes
        backup_database()

        # Use transaction for data import
        with get_db() as db:
            # Delete existing data for this account (similar to delete_stocks_crypto logic)
            logger.info(f"Deleting existing data for account {account_id}")

            # Find identifiers used by this account before deletion (for market price cleanup)
            identifiers = query_db('''
                SELECT DISTINCT identifier
                FROM companies
                WHERE account_id = ? AND identifier IS NOT NULL AND identifier != ''
            ''', [account_id])

            # Delete in correct order to maintain foreign key constraints
            db.execute('DELETE FROM expanded_state WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM identifier_mappings WHERE account_id = ?', [account_id])
            db.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (
                    SELECT id FROM companies WHERE account_id = ?
                )
            ''', [account_id])
            db.execute('DELETE FROM companies WHERE account_id = ?', [account_id])
            db.execute('DELETE FROM portfolios WHERE account_id = ?', [account_id])

            # Clean up orphaned market prices
            deleted_count = 0
            if identifiers:
                for item in identifiers:
                    identifier = item['identifier']
                    # Check if this identifier is still used by other accounts
                    other_usages = query_db('''
                        SELECT 1 FROM companies
                        WHERE identifier = ?
                        LIMIT 1
                    ''', [identifier])
                    
                    if not other_usages:
                        db.execute('DELETE FROM market_prices WHERE identifier = ?', [identifier])
                        deleted_count += 1

                logger.info(f"Deleted {deleted_count} orphaned market prices")

            # Import new data with name-based ID remapping
            logger.info(f"Importing data for account {account_id}")
            data = import_data['data']

            # Create ID mapping dictionaries
            old_to_new_portfolio_map = {}
            old_to_new_company_map = {}

            # Import portfolios first, without building the map immediately
            imported_portfolio_names = []  # Track names for verification
            if 'portfolios' in data and data['portfolios']:
                for portfolio in data['portfolios']:
                    name = portfolio['name']
                    db.execute('''
                        INSERT INTO portfolios (name, account_id)
                        VALUES (?, ?)
                    ''', [name, account_id])
                    imported_portfolio_names.append(name)
                logger.info(f"Inserted {len(imported_portfolio_names)} portfolios: {imported_portfolio_names}")

            # Query newly inserted portfolios to build name-based map
            cursor = db.execute('SELECT id, name FROM portfolios WHERE account_id = ?', [account_id])
            db_portfolios = cursor.fetchall()
            name_to_new_id_map = {row['name']: row['id'] for row in db_portfolios}

            # Build old_to_new_portfolio_map using name matching
            for old_portfolio in data.get('portfolios', []):
                old_id = old_portfolio['id']
                name = old_portfolio['name']
                new_id = name_to_new_id_map.get(name)
                if new_id is not None:
                    old_to_new_portfolio_map[old_id] = new_id
                    logger.info(f"Mapped old portfolio ID {old_id} (name: '{name}') to new ID {new_id}")
                else:
                    logger.warning(f"No matching portfolio found for name '{name}' (old ID: {old_id})")

            if len(old_to_new_portfolio_map) != len(imported_portfolio_names):
                flash('Warning: Some portfolios could not be mapped during import. Check logs.', 'warning')

            # Import companies using portfolio mapping and create company ID mapping
            if 'companies' in data and data['companies']:
                for company in data['companies']:
                    old_portfolio_id = company['portfolio_id']
                    new_portfolio_id = old_to_new_portfolio_map.get(old_portfolio_id)
                    
                    if new_portfolio_id:
                        old_company_id = company['id']
                        cursor = db.execute('''
                            INSERT INTO companies (name, identifier, category, portfolio_id, account_id, 
                                                 total_invested, override_country, country_manually_edited, 
                                                 country_manual_edit_date)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', [
                            company['name'], company['identifier'], company['category'],
                            new_portfolio_id, account_id, company.get('total_invested', 0),
                            company.get('override_country'), company.get('country_manually_edited', 0),
                            company.get('country_manual_edit_date')
                        ])
                        new_company_id = cursor.lastrowid
                        old_to_new_company_map[old_company_id] = new_company_id
                logger.info(f"Imported {len(old_to_new_company_map)} companies with ID remapping")

            # Import company_shares using company mapping
            if 'company_shares' in data and data['company_shares']:
                shares_imported = 0
                for share in data['company_shares']:
                    old_company_id = share['company_id']
                    new_company_id = old_to_new_company_map.get(old_company_id)
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
                        shares_imported += 1
                logger.info(f"Imported {shares_imported} company shares")

            # Import expanded_state with portfolio ID remapping
            expanded_count = 0
            if 'expanded_state' in data and data['expanded_state']:
                logger.info(f"Importing {len(data['expanded_state'])} expanded_state records with ID remapping")
                for state in data['expanded_state']:
                    try:
                        variable_value = state['variable_value']
                        
                        # Special handling for portfolio allocation data
                        if state['page_name'] == 'build' and state['variable_name'] == 'portfolios':
                            try:
                                portfolios_data = json.loads(variable_value)
                                # Create a mapping from old portfolio ID to new portfolio data (ID + name)
                                old_id_to_new_data = {}
                                for old_id, new_id in old_to_new_portfolio_map.items():
                                    # Get the correct name for the new portfolio ID from imported data
                                    portfolio_name = None
                                    for portfolio in data.get('portfolios', []):
                                        if portfolio['id'] == old_id:
                                            portfolio_name = portfolio['name']
                                            break
                                    if portfolio_name:
                                        old_id_to_new_data[old_id] = {'id': new_id, 'name': portfolio_name}
                                
                                # Remap both portfolio IDs and names within the JSON
                                for portfolio_item in portfolios_data:
                                    old_id = portfolio_item.get('id')
                                    if old_id in old_id_to_new_data:
                                        new_data = old_id_to_new_data[old_id]
                                        portfolio_item['id'] = new_data['id']
                                        portfolio_item['name'] = new_data['name']
                                        logger.info(f"Remapped portfolio ID {old_id} -> {new_data['id']} and name to '{new_data['name']}' in expanded_state")
                                
                                variable_value = json.dumps(portfolios_data)
                            except json.JSONDecodeError as e:
                                logger.warning(f"Could not parse portfolios JSON for remapping: {e}")

                        db.execute('''
                            INSERT INTO expanded_state (account_id, page_name, variable_name, 
                                                      variable_type, variable_value, last_updated)
                            VALUES (?, ?, ?, ?, ?, ?)
                        ''', [
                            account_id, state['page_name'], state['variable_name'],
                            state['variable_type'], variable_value, 
                            state.get('last_updated', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'))
                        ])
                        expanded_count += 1
                    except Exception as e:
                        logger.error(f"Error importing expanded_state record {state.get('variable_name', 'unknown')}: {str(e)}")
                        raise
                logger.info(f"Successfully imported {expanded_count} expanded_state records")

            # Import identifier_mappings
            mappings_count = 0
            if 'identifier_mappings' in data and data['identifier_mappings']:
                logger.info(f"Importing {len(data['identifier_mappings'])} identifier_mappings records")
                for mapping in data['identifier_mappings']:
                    try:
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
                        mappings_count += 1
                    except Exception as e:
                        logger.error(f"Error importing identifier_mapping record {mapping.get('csv_identifier', 'unknown')}: {str(e)}")
                        raise
                logger.info(f"Successfully imported {mappings_count} identifier_mappings records")

            # Update last_price_update timestamp
            db.execute(
                'UPDATE accounts SET last_price_update = ? WHERE id = ?',
                [datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), account_id]
            )

            # Verify import success
            verification_expanded = query_db('SELECT COUNT(*) as count FROM expanded_state WHERE account_id = ?', [account_id])
            verification_mappings = query_db('SELECT COUNT(*) as count FROM identifier_mappings WHERE account_id = ?', [account_id])
            
            expanded_imported = verification_expanded[0]['count'] if verification_expanded else 0
            mappings_imported = verification_mappings[0]['count'] if verification_mappings else 0
            
            logger.info(f"Import verification: {expanded_imported} expanded_state, {mappings_imported} identifier_mappings imported for account {account_id}")

        flash('Account data imported successfully! Portfolio allocations have been preserved.', 'success')

    except json.JSONDecodeError:
        flash('Invalid JSON file format', 'error')
    except (DataIntegrityError, ValidationError) as e:
        logger.error(f"Error importing account data: {str(e)}")
        flash(f'Error importing account data: {str(e)}', 'error')
    except Exception as e:
        logger.exception(f"Unexpected error importing account data")
        flash('An unexpected error occurred while importing account data', 'error')

    return redirect(url_for('account.index'))