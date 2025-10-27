"""
Authentication decorators for route protection.

Centralizes account validation logic that was duplicated across 18 routes.
Philosophy: Single source of truth for authentication. Simplicity through auto-detection.
"""

from functools import wraps
from flask import session, jsonify, flash, redirect, url_for, g, request
from app.db_manager import query_db
import logging

logger = logging.getLogger(__name__)


def require_auth(f):
    """
    Decorator to require authentication for routes.

    Auto-detects JSON vs HTML routes and responds appropriately.
    Checks if account_id exists in the session. For HTML routes, redirects
    to index with flash message. For API/JSON routes, returns 401 error.

    Sets g.account_id for all routes. For HTML routes, also verifies account
    exists and sets g.account for template access.

    Usage:
        # For API endpoints (auto-detected via request.is_json or /api/ path)
        @blueprint.route('/api/data')
        @require_auth
        def get_data():
            account_id = g.account_id  # Available from decorator
            # ... route logic

        # For template routes (auto-detected)
        @blueprint.route('/page')
        @require_auth
        def show_page():
            account_id = g.account_id  # Available from decorator
            account = g.account        # Pre-loaded for template routes
            # ... route logic

    Args:
        f: The route function to decorate

    Returns:
        Decorated function that enforces authentication

    Raises:
        Returns 401 JSON error or redirects with flash message if not authenticated.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check if user is authenticated
        if 'account_id' not in session:
            logger.warning(
                f"Unauthenticated access attempt to {f.__name__} at {request.path}"
            )

            # Auto-detect: For API/JSON requests, return JSON error
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({
                    'error': 'Authentication required. Please select an account.'
                }), 401

            # For HTML requests, flash message and redirect
            flash('Please select an account first', 'warning')
            return redirect(url_for('main.index'))

        # Set account_id in g for easy access within the route
        g.account_id = session['account_id']

        logger.debug(
            f"Authenticated request to {f.__name__} "
            f"for account_id: {g.account_id}"
        )

        # For non-JSON routes (templates), verify account exists and load it
        if not (request.is_json or request.path.startswith('/api/')):
            account = query_db(
                'SELECT * FROM accounts WHERE id = ?',
                [g.account_id],
                one=True
            )

            if not account:
                logger.warning(
                    f"Account {g.account_id} not found in database"
                )
                flash('Account not found', 'error')
                return redirect(url_for('main.index'))

            # Store account in g for template access
            g.account = account

            logger.debug(
                f"Loaded account: {account.get('name') if isinstance(account, dict) else 'Unknown'}"
            )

        # Execute the original function
        return f(*args, **kwargs)

    return decorated_function
