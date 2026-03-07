from app.db_manager import query_db
from flask import Blueprint, session, jsonify
from app.decorators.auth import require_auth
import logging

logger = logging.getLogger(__name__)

main_bp = Blueprint('main', __name__)


@main_bp.route('/api/accounts')
def api_accounts():
    """JSON API: list available accounts"""
    accounts = query_db(
        'SELECT id, username FROM accounts WHERE username != "_global" ORDER BY username')
    current = session.get('account_id')
    return jsonify({
        'accounts': [dict(a) for a in accounts] if accounts else [],
        'current_account_id': current,
    })


@main_bp.route('/api/select_account/<int:account_id>', methods=['POST'])
def api_select_account(account_id):
    """JSON API: select an account"""
    account = query_db('SELECT * FROM accounts WHERE id = ?',
                       [account_id], one=True)
    if account and isinstance(account, dict):
        session.permanent = True
        session['account_id'] = account_id
        session['username'] = account['username']
        session.modified = True
        return jsonify({'ok': True, 'username': account['username']})
    return jsonify({'ok': False, 'error': 'Account not found'}), 404


@main_bp.route('/api/clear_account', methods=['POST'])
def api_clear_account():
    """JSON API: clear the selected account from session"""
    session.pop('account_id', None)
    session.pop('username', None)
    return jsonify({'ok': True})
