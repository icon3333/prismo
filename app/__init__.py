from flask import Flask, render_template
from app.database.db_manager import init_db
from app.routes.main_routes import main_bp
from app.routes.account_routes import account_bp
from app.routes.portfolio_routes import portfolio_bp
from app.main import create_app

__all__ = [
    'Flask',
    'init_db',
    'main_bp',
    'account_bp',
    'portfolio_bp',
    'create_app'
]
