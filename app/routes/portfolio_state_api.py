"""State persistence API — expanded_state get/save for UI pages."""

from flask import request, jsonify, g
from app.db_manager import query_db, get_db
from app.decorators import require_auth
from app.utils.response_helpers import success_response, error_response
from app.exceptions import ValidationError, DataIntegrityError

import logging

logger = logging.getLogger(__name__)

# API endpoint to get and save state data

@require_auth
def manage_state():
    """Get or save state data"""
    account_id = g.account_id

    # GET request to retrieve state
    if request.method == 'GET':
        page_name = request.args.get('page', '')

        if not page_name:
            return error_response('Page name is required', 400)

        try:
            # Get all state variables for this account and page
            state_vars = query_db('''
                SELECT variable_name, variable_type, variable_value
                FROM expanded_state
                WHERE account_id = ? AND page_name = ?
            ''', [account_id, page_name])

            if not state_vars:
                return jsonify({})

            # Convert to proper data structure
            state_data = {}
            for var in state_vars:
                if isinstance(var, dict):
                    var_name = var['variable_name']
                    var_value = var['variable_value']

                    # Add to state data without conversion (handled by front-end)
                    state_data[var_name] = var_value

            return jsonify(state_data)

        except (DataIntegrityError, ValidationError) as e:
            logger.error(f"Error retrieving state for page '{page_name}': {str(e)}")
            return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
        except Exception as e:
            logger.exception(f"Unexpected error retrieving state for page '{page_name}'")
            return error_response('Failed to retrieve state', 500)

    # POST request to save state
    elif request.method == 'POST':
        data = request.json

        if not data or 'page' not in data:
            return error_response('Invalid data format', 400)

        page_name = data['page']

        try:
            # No backup here: UI expand/collapse state is non-critical and
            # reconstructable, and a full-DB copy on every state save adds I/O
            # and lengthens this hot, frequently-called write. Real data
            # mutations still back up at their own callsites.
            with get_db() as db:
                cursor = db.cursor()

                # Start transaction
                cursor.execute('BEGIN TRANSACTION')

                # Delete existing state for this page (to avoid orphaned variables)
                cursor.execute('''
                DELETE FROM expanded_state
                WHERE account_id = ? AND page_name = ?
            ''', [account_id, page_name])

                # Insert new state variables
                for key, value in data.items():
                    if key == 'page':
                        continue  # Skip the page key

                    # Determine variable type
                    if isinstance(value, str):
                        if value.startswith('{') or value.startswith('['):
                            var_type = 'object'
                        else:
                            var_type = 'string'
                    else:
                        var_type = 'string'

                    # Insert into database
                    cursor.execute('''
                        INSERT INTO expanded_state
                        (account_id, page_name, variable_name, variable_type, variable_value)
                        VALUES (?, ?, ?, ?, ?)
                    ''', [account_id, page_name, key, var_type, value])

                # Commit transaction
                # (cache invalidation happens in the blueprint-wide after_request hook)
                db.commit()

            logger.info(
                f"State saved successfully for account {account_id}, page {page_name}")
            return success_response(message='State saved successfully')

        except (DataIntegrityError, ValidationError) as e:
            logger.error(f"Error saving state for page '{page_name}': {str(e)}")
            return error_response(str(e), 400 if isinstance(e, ValidationError) else 500)
        except Exception as e:
            logger.exception(f"Unexpected error saving state for page '{page_name}'")
            return error_response('Failed to save state', 500)

    return error_response('Method not allowed', 405)

# API endpoint to get companies for a specific portfolio

