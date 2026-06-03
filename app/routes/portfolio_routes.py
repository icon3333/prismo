from flask import (
    Blueprint, redirect,
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


# Backward-compatibility redirects for old URLs
@portfolio_bp.route('/analyse')
@require_auth
def analyse_redirect():
    return redirect('/portfolio/performance', code=301)

@portfolio_bp.route('/build')
@require_auth
def build_redirect():
    return redirect('/portfolio/builder', code=301)

@portfolio_bp.route('/allocate')
@require_auth
def allocate_redirect():
    return redirect('/portfolio/rebalancer', code=301)

@portfolio_bp.route('/risk_overview')
@require_auth
def risk_overview_redirect():
    return redirect('/portfolio/concentrations', code=301)

@portfolio_bp.route('/api/allocate/<path:subpath>')
@require_auth
def allocate_api_redirect(subpath):
    return redirect(f'/portfolio/api/simulator/{subpath}', code=301)


register_portfolio_api_routes(portfolio_bp)
