from flask import (
    Blueprint, request, session, jsonify
)
from app.db_manager import execute_db, backup_database
from app.exceptions import ValidationError, DataIntegrityError

import sqlite3
import logging
from datetime import datetime

logger = logging.getLogger('app.routes.account')

account_bp = Blueprint('account', __name__)


@account_bp.route('/create', methods=['POST'])
def create_account():
    """Create a new account (JSON API)"""
    data = request.get_json() if request.is_json else None
    username = (data.get('username', '') if data else request.form.get('username', '')).strip()

    if not username:
        return jsonify({'ok': False, 'error': 'Username cannot be empty'}), 400

    try:
        backup_database()

        created_at = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        execute_db(
            'INSERT INTO accounts (username, created_at) VALUES (?, ?)',
            [username, created_at]
        )

        from app.db_manager import query_db
        new_account = query_db(
            'SELECT id FROM accounts WHERE username = ?',
            [username],
            one=True
        )

        if new_account and isinstance(new_account, dict):
            account_id = new_account.get('id')
            session['account_id'] = account_id
            session['username'] = username
            return jsonify({'ok': True, 'account_id': account_id, 'username': username})

        return jsonify({'ok': False, 'error': 'Failed to create account'}), 500

    except sqlite3.IntegrityError:
        return jsonify({'ok': False, 'error': f'Account "{username}" already exists'}), 409
    except (DataIntegrityError, ValidationError) as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        logger.exception("Unexpected error creating account")
        return jsonify({'ok': False, 'error': 'An unexpected error occurred'}), 500
