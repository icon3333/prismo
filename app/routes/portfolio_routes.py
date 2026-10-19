from flask import Blueprint, g, request, session

from app.routes.portfolio_api_routes import register_portfolio_api_routes

portfolio_bp = Blueprint('portfolio', __name__,
                         url_prefix='/portfolio')


# Ensure session persistence


@portfolio_bp.before_request
def make_session_permanent():
    session.permanent = True  # This makes the session last longer
    session.modified = True   # This ensures changes are saved


@portfolio_bp.after_request
def invalidate_cache_after_write(response):
    """Every successful write under /portfolio invalidates the account's
    memoized portfolio reads. Correctness no longer depends on each write
    endpoint remembering to call invalidate_portfolio_cache() — forgetting
    it (as the single price-update endpoint did) meant serving stale data
    for up to the memoize timeout.

    Endpoints that re-read portfolio data within the same request still
    invalidate explicitly before reading; background jobs (CSV import,
    batch price updates) invalidate on completion since they outlive the
    request.
    """
    review_only_write = request.path.startswith('/portfolio/api/monthly-reviews')
    if (
        request.method in ('POST', 'PUT', 'PATCH', 'DELETE')
        and response.status_code < 400
        and not review_only_write
    ):
        account_id = getattr(g, 'account_id', None)
        if account_id:
            from app.routes.portfolio_data_api import invalidate_portfolio_cache
            invalidate_portfolio_cache(account_id)
    return response


register_portfolio_api_routes(portfolio_bp)
