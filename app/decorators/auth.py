"""
Authentication decorators for route protection.

Centralizes account validation logic. All routes are now API-only
(Next.js frontend handles the UI), so responses are always JSON.
"""

from functools import wraps
from flask import session, jsonify, g, request
from app.db_manager import query_db
import logging

logger = logging.getLogger(__name__)


def require_auth(f):
    """
    Decorator to require authentication for routes.

    Checks if account_id exists in the session. Returns 401 JSON error
    if not authenticated. Sets g.account_id for all routes.

    Usage:
        @blueprint.route('/api/data')
        @require_auth
        def get_data():
            account_id = g.account_id
            # ... route logic
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'account_id' not in session:
            logger.warning(
                f"Unauthenticated access attempt to {f.__name__} at {request.path}"
            )
            return jsonify({
                'error': 'Authentication required. Please select an account.'
            }), 401

        g.account_id = session['account_id']

        logger.debug(
            f"Authenticated request to {f.__name__} "
            f"for account_id: {g.account_id}"
        )

        return f(*args, **kwargs)

    return decorated_function
