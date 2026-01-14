from flask import Flask, render_template, request, jsonify
import logging
import os
from datetime import datetime
from app.cache import cache

def create_app(config_name=None):
    import time
    _create_app_start = time.time()

    app = Flask(__name__,
                template_folder='../templates',
                static_folder='../static')

    # Load configuration from config.py
    from config import config

    # Only show timing in debug mode AND in the main process (not reloader parent)
    _is_debug = os.environ.get('FLASK_ENV') == 'development'
    _is_reloader_parent = not os.environ.get('WERKZEUG_RUN_MAIN') and _is_debug
    _show_timing = _is_debug and not _is_reloader_parent

    if _show_timing:
        _config_load_time = time.time() - _create_app_start
        print(f"  ⏱️  Config loaded: {_config_load_time:.3f}s")

    # Determine config name from environment or parameter
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')

    # Load the appropriate configuration
    app.config.from_object(config.get(config_name, config['development']))

    # Configure caching (SimpleCache for single-user homeserver)
    app.config.update(
        CACHE_TYPE='SimpleCache',  # In-memory cache, perfect for single user
        CACHE_DEFAULT_TIMEOUT=900,  # 15 minutes default
        CACHE_KEY_PREFIX='portfolio_'
    )

    # Initialize cache with app
    cache.init_app(app)

    # Override with additional settings for development
    if config_name == 'development':
        app.config.update(
            TEMPLATES_AUTO_RELOAD=True,
            JSON_SORT_KEYS=False
        )
    
    # Configure logging based on environment
    if app.config['DEBUG']:
        app.logger.setLevel(logging.DEBUG)
    else:
        app.logger.setLevel(logging.WARNING)
        
        # Add file logging for production
        if not app.debug:
            from logging.handlers import RotatingFileHandler
            
            # Ensure log directory exists
            log_dir = os.path.join(app.config.get('APP_DATA_DIR', 'instance'))
            os.makedirs(log_dir, exist_ok=True)
            
            file_handler = RotatingFileHandler(
                os.path.join(log_dir, 'app.log'), 
                maxBytes=10240, 
                backupCount=10
            )
            file_handler.setFormatter(logging.Formatter(
                '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
            ))
            file_handler.setLevel(logging.WARNING)
            app.logger.addHandler(file_handler)

    # Only log startup info in the main process (not reloader parent) to avoid duplicate output
    if not _is_reloader_parent:
        app.logger.info("Application startup completed")
        # Ensure session configuration is properly set
        app.logger.info(f"Session configuration: SECRET_KEY set: {bool(app.config.get('SECRET_KEY'))}")
        app.logger.info(f"Session cookie secure: {app.config.get('SESSION_COOKIE_SECURE')}")
        app.logger.info(f"Session permanent lifetime: {app.config.get('PERMANENT_SESSION_LIFETIME')}")
    
    # Security headers disabled for demo
    
    # Add context processor for datetime
    @app.context_processor
    def inject_now():
        return {'now': datetime.now()}
    
    # Register blueprints
    if _show_timing:
        _blueprint_start = time.time()

    from app.routes.main_routes import main_bp
    app.register_blueprint(main_bp)

    from app.routes.account_routes import account_bp
    app.register_blueprint(account_bp, url_prefix='/account')

    from app.routes.portfolio_routes import portfolio_bp
    app.register_blueprint(portfolio_bp)

    from app.routes.admin_routes import admin_bp
    app.register_blueprint(admin_bp)

    if _show_timing:
        _blueprint_time = time.time() - _blueprint_start
        print(f"  ⏱️  Blueprints registered: {_blueprint_time:.3f}s")

    # Initialize the database
    if _show_timing:
        _db_start = time.time()

    from app.db_manager import init_db, migrate_database
    init_db(app)

    # Run database migrations
    try:
        with app.app_context():
            migrate_database()
    except Exception as e:
        app.logger.error(f"Database migration failed: {e}")

    if _show_timing:
        _db_time = time.time() - _db_start
        print(f"  ⏱️  Database init + migrations: {_db_time:.3f}s")

    # Only run startup tasks in the main process (not during Werkzeug reloader restart)
    # Skip silently in parent process to avoid duplicate/confusing output
    if os.environ.get('WERKZEUG_RUN_MAIN'):
        # OPTIMIZATION: Run startup tasks in background thread to avoid blocking startup
        # This makes the app responsive immediately while background tasks complete
        def run_startup_tasks():
            """Run startup tasks in background thread to avoid blocking app startup."""
            import time
            time.sleep(0.1)  # Small delay to ensure app is fully initialized

            with app.app_context():
                # Trigger automatic price update on startup if needed
                try:
                    from app.utils.startup_tasks import auto_update_prices_if_needed
                    auto_update_prices_if_needed()
                except Exception as e:
                    app.logger.error(f"Automatic price update failed: {e}")

                # Trigger automatic database backup scheduler
                try:
                    from app.utils.startup_tasks import schedule_automatic_backups
                    schedule_automatic_backups()
                except Exception as e:
                    app.logger.error(f"Automatic backup setup failed: {e}")

        # Start background thread for startup tasks (daemon=True means it won't prevent app shutdown)
        import threading
        startup_thread = threading.Thread(target=run_startup_tasks, daemon=True)
        startup_thread.start()
        app.logger.info("Startup tasks scheduled in background thread")

    if _show_timing:
        _total_time = time.time() - _create_app_start
        print(f"  ⏱️  TOTAL create_app() time: {_total_time:.3f}s\n")

    @app.route('/health')
    def health_check():
        """Health check endpoint for Docker and load balancers."""
        try:
            # Check database connectivity
            from app.db_manager import query_db
            query_db("SELECT 1", one=True)
            
            # Only log health check failures, not successes (reduces log noise)
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.utcnow().isoformat(),
                'database': 'connected'
            }), 200
        except Exception as e:
            app.logger.error(f"Health check failed: {e}")
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
            app.logger.error(f"Error processing request: {str(e)}")
            return jsonify({'error': str(e)})
    
    return app
