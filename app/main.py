from flask import Flask, jsonify, request
import logging
import os
from datetime import datetime
from app.cache import cache

def create_app(config_name=None):
    import time
    _create_app_start = time.time()

    app = Flask(__name__)

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
    # Note: CACHE_DEFAULT_TIMEOUT comes from config.py (env var controllable)
    app.config.update(
        CACHE_TYPE='SimpleCache',  # In-memory cache, perfect for single user
        CACHE_KEY_PREFIX='portfolio_'
    )

    # Initialize cache with app
    cache.init_app(app)

    # Override with additional settings for development
    if config_name == 'development':
        app.config.update(
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

    from app.errors import register_error_handlers
    register_error_handlers(app)

    if _show_timing:
        _blueprint_time = time.time() - _blueprint_start
        print(f"  ⏱️  Blueprints registered: {_blueprint_time:.3f}s")

    # Initialize the database
    if _show_timing:
        _db_start = time.time()

    from app.db_manager import init_db, migrate_database
    init_db(app)

    # Run database migrations. A failed migration must abort startup:
    # serving on a half-migrated schema risks silent data corruption.
    try:
        with app.app_context():
            migrate_database()
    except Exception as e:
        app.logger.critical(f"Database migration failed: {e} - refusing to start on a half-migrated schema")
        raise

    if _show_timing:
        _db_time = time.time() - _db_start
        print(f"  ⏱️  Database init + migrations: {_db_time:.3f}s")

    # Determine if we're in the main process that should run startup tasks
    # - In development with reloader: WERKZEUG_RUN_MAIN is set in the child process
    # - In production (no reloader): WERKZEUG_RUN_MAIN is not set, but we should still run
    is_main_process = (
        os.environ.get('WERKZEUG_RUN_MAIN') or  # Development with reloader (child process)
        (not os.environ.get('WERKZEUG_RUN_MAIN') and not _is_debug)  # Production (no reloader)
    )

    if os.environ.get('PRISMO_DEFER_STARTUP_TASKS') == '1':
        # Under gunicorn (deployment/gunicorn.conf.py sets this flag) the app is
        # created in the master pre-fork; threads started here would run in the
        # master by accident and be duplicated if preload is ever disabled. The
        # when_ready hook starts the tasks exactly once instead.
        app.logger.info("Startup tasks deferred to the WSGI server hook")
    elif is_main_process:
        app.logger.info("Main process detected - scheduling startup tasks")
        from app.utils.startup_tasks import start_background_tasks
        start_background_tasks(app)
    else:
        app.logger.debug("Reloader parent process - skipping startup tasks")

    if _show_timing:
        _total_time = time.time() - _create_app_start
        print(f"  ⏱️  TOTAL create_app() time: {_total_time:.3f}s\n")

    @app.after_request
    def _add_etag_and_cache_control(response):
        """
        For GET JSON responses: attach ETag + `Cache-Control: private, max-age=30`
        and return 304 if the client's `If-None-Match` matches.

        Pairs naturally with the existing `@cache.memoize` decorators on hot reads
        (server-side) and the `apiFetch` 30s memory cache (client-side): after
        navigating away and back, the browser revalidates with the ETag and gets a
        small 304 instead of the full JSON.
        """
        if request.method != 'GET':
            return response
        if response.status_code >= 300:
            return response
        ct = response.content_type or ''
        if 'application/json' not in ct:
            return response

        response.add_etag()
        response.headers.setdefault('Cache-Control', 'private, max-age=30')
        return response.make_conditional(request)

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

    return app
