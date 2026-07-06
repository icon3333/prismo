from flask import (
    Blueprint, g, redirect, request,
    session
)
from app.decorators import require_auth
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
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE') and response.status_code < 400:
        account_id = getattr(g, 'account_id', None)
        if account_id:
            from app.routes.portfolio_data_api import invalidate_portfolio_cache
            invalidate_portfolio_cache(account_id)
    return response


# Backward-compatibility redirects for old URLs
@portfolio_bp.route('/analyse')
@require_auth
def analyse_redirect():
    return redirect('/portfolio/performance', code=301)

@portfolio_bp.route('/build')
@require_auth
def build_redirect():
    return redirect('/portfolio/plan', code=301)

@portfolio_bp.route('/allocate')
@require_auth
def allocate_redirect():
    return redirect('/portfolio/plan', code=301)

@portfolio_bp.route('/risk_overview')
@require_auth
def risk_overview_redirect():
    return redirect('/portfolio/concentrations', code=301)

@portfolio_bp.route('/api/allocate/<path:subpath>')
@require_auth
def allocate_api_redirect(subpath):
    return redirect(f'/portfolio/api/simulator/{subpath}', code=301)


register_portfolio_api_routes(portfolio_bp)
