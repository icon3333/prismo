# Routes package initialization
from app.routes.main_routes import main_bp
from app.routes.account_routes import account_bp
from app.routes.portfolio_routes import portfolio_bp

__all__ = [
    'main_bp',
    'account_bp',
    'portfolio_bp'
]
