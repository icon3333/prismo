from flask import Flask, render_template, request, jsonify
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)

def create_app(config_name=None):
    logging.basicConfig(level=logging.INFO)
    app = Flask(__name__,
                template_folder='../templates',
                static_folder='../static')
    logger.info("Logger initialized at INFO level")
    
    # Load configuration from config.py
    from config import config
    
    # Determine config name from environment or parameter
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')
    
    # Load the appropriate configuration
    app.config.from_object(config.get(config_name, config['development']))
    
    # Override with additional settings for development
    if config_name == 'development':
        app.config.update(
            TEMPLATES_AUTO_RELOAD=True,
            JSON_SORT_KEYS=False
        )
    
    # Security headers disabled for demo
    
    # Add context processor for datetime
    @app.context_processor
    def inject_now():
        return {'now': datetime.now()}
    
    # Register blueprints
    from app.routes.main_routes import main_bp
    app.register_blueprint(main_bp)
    
    from app.routes.account_routes import account_bp
    app.register_blueprint(account_bp, url_prefix='/account')
    
    from app.routes.portfolio_routes import portfolio_bp
    app.register_blueprint(portfolio_bp)
    
    from app.routes.admin_routes import admin_bp
    app.register_blueprint(admin_bp)
    
    # Initialize the database
    from app.database.db_manager import init_db, migrate_database
    init_db(app)
    
    # Run database migrations
    try:
        with app.app_context():
            migrate_database()
    except Exception as e:
        logger.error(f"Database migration failed: {e}")

    # Trigger automatic price update on startup if needed
    try:
        with app.app_context():
            from app.utils.startup_tasks import auto_update_prices_if_needed
            auto_update_prices_if_needed()
    except Exception as e:
        logger.error(f"Automatic price update failed: {e}")
    
    @app.route('/health')
    def health_check():
        """Health check endpoint for Docker and load balancers."""
        try:
            # Check database connectivity
            from app.database.db_manager import query_db
            query_db("SELECT 1", one=True)
            
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.utcnow().isoformat(),
                'database': 'connected'
            }), 200
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return jsonify({
                'status': 'unhealthy',
                'timestamp': datetime.utcnow().isoformat(),
                'error': str(e)
            }), 503

    @app.route('/profile', methods=['POST'])
    def get_profile():
        data = request.get_json() if request.is_json else request.form
        symbol = data.get('identifier', '').strip().upper()
        
        if not symbol:
            return jsonify({'error': 'No symbol provided'})
        
        try:
            from app.utils.yfinance_utils import get_yfinance_info
            result = get_yfinance_info(symbol)
            return jsonify(result)
                
        except Exception as e:
            logger.error(f"Error processing request: {str(e)}")
            return jsonify({'error': str(e)})
    
    return app
