"""Global JSON error handlers.

Single place where exceptions become HTTP responses. Routes raise the
typed exceptions from app/exceptions.py (or let unexpected ones
propagate) instead of wrapping every handler in try/except boilerplate.

4xx (client errors) log at WARNING; 5xx log the full traceback.
"""

import logging

from flask import jsonify
from werkzeug.exceptions import HTTPException

from app.exceptions import (
    PortfolioError,
    ValidationError,
    CSVProcessingError,
    BusinessRuleError,
    IdentifierError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    DataIntegrityError,
    PriceFetchError,
    ExternalAPIError,
)

logger = logging.getLogger(__name__)

# Most-specific classes first — the first isinstance match wins.
_EXCEPTION_STATUS = [
    (ValidationError, 400),
    (CSVProcessingError, 400),
    (BusinessRuleError, 400),
    (IdentifierError, 400),
    (AuthenticationError, 401),
    (AuthorizationError, 403),
    (NotFoundError, 404),
    (DataIntegrityError, 409),
    (PriceFetchError, 502),
    (ExternalAPIError, 502),
]


def _json_error(message: str, status: int):
    return jsonify({'success': False, 'error': message}), status


def register_error_handlers(app):
    @app.errorhandler(PortfolioError)
    def handle_portfolio_error(e):
        status = next(
            (code for cls, code in _EXCEPTION_STATUS if isinstance(e, cls)), 500
        )
        if status < 500:
            logger.warning(f"{type(e).__name__}: {e}")
        else:
            logger.exception(f"{type(e).__name__}: {e}")
        return _json_error(str(e), status)

    @app.errorhandler(HTTPException)
    def handle_http_exception(e):
        # Keep the API JSON-only: 404/405/… must not return HTML pages.
        return _json_error(e.description or e.name, e.code or 500)

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        logger.exception("Unhandled exception")
        return _json_error('Internal server error', 500)
