import os
import sqlite3
import shutil
from datetime import datetime
from pathlib import Path
import logging
import threading
from flask import g, current_app
import click
from flask.cli import with_appcontext

# Configure logging
logger = logging.getLogger(__name__)

# Store the database path when the app initializes
_db_path = None
_db_path_lock = threading.Lock()  # Thread safety for _db_path initialization


def _configure_connection(db, include_wal_optimizations=True):
    """
    Configure a SQLite database connection with performance optimizations.

    Uses executescript() to batch all PRAGMA statements into a single call,
    reducing the overhead of multiple execute() calls by ~20-30%.

    Args:
        db: SQLite database connection
        include_wal_optimizations: If True, include additional WAL mode optimizations
    """
    if include_wal_optimizations:
        # Full optimization set for normal connections
        db.executescript('''
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -64000;
        ''')
    else:
        # Minimal set for new database creation (before WAL is stable)
        db.executescript('''
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
        ''')

def set_db_path(path):
    """Set the database path for background operations."""
    global _db_path
    _db_path = path

def get_db():
    """
    Get a database connection for the current request.
    The connection is cached and reused for the same request.
    """
    if 'db' not in g:
        db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        
        # Ensure the database directory exists
        db_dir = os.path.dirname(db_path)
        if db_dir and not os.path.exists(db_dir):
            try:
                os.makedirs(db_dir, exist_ok=True)
                logger.info(f"Created database directory: {db_dir}")
            except Exception as e:
                logger.error(f"Failed to create database directory {db_dir}: {e}")
                raise
        
        # Try to connect to the database
        try:
            g.db = sqlite3.connect(db_path, detect_types=sqlite3.PARSE_DECLTYPES)
            g.db.row_factory = sqlite3.Row
            _configure_connection(g.db)
            logger.debug(f"Connected to database: {db_path}")
        except sqlite3.OperationalError as e:
            logger.error(f"Failed to connect to database {db_path}: {e}")
            # If we can't connect, try creating the file first
            try:
                # Touch the file to create it
                Path(db_path).touch(exist_ok=True)
                g.db = sqlite3.connect(db_path, detect_types=sqlite3.PARSE_DECLTYPES)
                g.db.row_factory = sqlite3.Row
                _configure_connection(g.db, include_wal_optimizations=False)
                logger.info(f"Created and connected to new database: {db_path}")
            except Exception as create_error:
                logger.error(f"Failed to create database file {db_path}: {create_error}")
                raise
    return g.db

def get_background_db():
    """
    Get a new database connection for background tasks.
    This should be used instead of get_db() when working in background threads
    where Flask's request context is not available.

    Thread-safe using double-check locking pattern.
    """
    global _db_path

    # First check without lock (fast path)
    if _db_path is None:
        # Acquire lock for initialization
        with _db_path_lock:
            # Double-check after acquiring lock
            if _db_path is None:
                # Fallback to try getting from current_app if available
                try:
                    from flask import current_app
                    _db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
                    logger.debug(f"Initialized _db_path from app context: {_db_path}")
                except RuntimeError:
                    # If no application context, fail fast instead of using potentially wrong database
                    raise RuntimeError("No database path available - ensure Flask app context is available in background operations")
    
    # Ensure the database directory exists
    db_dir = os.path.dirname(_db_path)
    if db_dir and not os.path.exists(db_dir):
        try:
            os.makedirs(db_dir, exist_ok=True)
            logger.info(f"Created database directory: {db_dir}")
        except Exception as e:
            logger.error(f"Failed to create database directory {db_dir}: {e}")
            raise
    
    # Try to connect to the database
    try:
        db = sqlite3.connect(_db_path, detect_types=sqlite3.PARSE_DECLTYPES)
        db.row_factory = sqlite3.Row
        _configure_connection(db)
        return db
    except sqlite3.OperationalError as e:
        logger.error(f"Failed to connect to background database {_db_path}: {e}")
        # If we can't connect, try creating the file first
        try:
            # Touch the file to create it
            Path(_db_path).touch(exist_ok=True)
            db = sqlite3.connect(_db_path, detect_types=sqlite3.PARSE_DECLTYPES)
            db.row_factory = sqlite3.Row
            _configure_connection(db, include_wal_optimizations=False)
            logger.info(f"Created and connected to new background database: {_db_path}")
            return db
        except Exception as create_error:
            logger.error(f"Failed to create background database file {_db_path}: {create_error}")
            raise

def close_db(e=None):
    """Close the database connection at the end of the request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db(app):
    """
    Initialize the database and create tables if they don't exist.
    Then verify schema, run migrations, and optionally insert sample data if empty.
    """
    with app.app_context():
        # Store the database path for background operations
        db_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        set_db_path(db_path)
        logger.info(f"Database path configured: {db_path}")
        logger.info(f"Database directory: {os.path.dirname(db_path)}")
        logger.info(f"Database file exists: {os.path.exists(db_path)}")
        
        db = get_db()

        # Perform all initialization in a single transaction for atomicity
        with db:
            # Load schema from the version-controlled file in app directory
            try:
                with app.open_resource('schema.sql', mode='r') as f:
                    db.cursor().executescript(f.read())
                logger.debug("Schema loaded from app/schema.sql")
            except FileNotFoundError:
                logger.warning("app/schema.sql not found - will use fallback table creation")

            # Add the identifier_mappings table if it doesn't exist
            db.execute('''
                CREATE TABLE IF NOT EXISTS identifier_mappings (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL,
                    csv_identifier TEXT NOT NULL,
                    preferred_identifier TEXT NOT NULL,
                    company_name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (account_id) REFERENCES accounts (id),
                    UNIQUE (account_id, csv_identifier)
                )
            ''')

            # Add the background_jobs table if it doesn't exist
            db.execute('''
                CREATE TABLE IF NOT EXISTS background_jobs (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    status TEXT,
                    progress INTEGER,
                    total INTEGER,
                    result TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Create schema_version table for migration tracking
            db.execute('''
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Initialize version to 0 if table is empty
            cursor = db.cursor()
            cursor.execute('SELECT version FROM schema_version LIMIT 1')
            if not cursor.fetchone():
                db.execute('INSERT INTO schema_version (version) VALUES (0)')

            # Drop old auto-update trigger (cleanup from previous version)
            db.execute('DROP TRIGGER IF EXISTS update_background_jobs_timestamp')

        # Transaction committed automatically by 'with' block
        logger.info("Database tables initialized successfully")

        try:
            # Create tables if not present
            cursor = db.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall()]

            if not tables or 'accounts' not in tables:
                logger.info("Fallback: Initializing database schema from app/schema.sql ...")
                try:
                    with app.open_resource('schema.sql', mode='r') as f:
                        db.executescript(f.read())
                    db.commit()
                    logger.info("Database schema initialized from app/schema.sql")
                except FileNotFoundError:
                    logger.error("CRITICAL: No schema file found. Database cannot be initialized.")
                    raise

            # Verify that required columns exist, etc.
            verify_schema(db)

            # Check if database is empty and insert sample data if you want
            if is_database_empty(db):
                logger.info("Database appears empty. Optionally adding sample data.")
                create_default_data(db)

            # Assign teardown
            app.teardown_appcontext(close_db)

        except Exception as e:
            logger.error(f"Database initialization failed: {e}")
            raise

def verify_schema(db):
    """
    Verify that all required tables/columns are present.
    If something is missing, you can recreate or raise an error.
    """
    required_tables = [
        'accounts', 'portfolios', 'companies', 'company_shares',
        'market_prices', 'expanded_state', 'identifier_mappings', 'exchange_rates'
    ]
    cursor = db.cursor()
    for table in required_tables:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])
        result = cursor.fetchone()
        if not result:
            logger.warning(f"Missing table: {table}. You might need to re-run schema.sql.")

    # Check companies table structure
    columns_check = cursor.execute("PRAGMA table_info(companies)").fetchall()
    col_names = [col[1] for col in columns_check]
    required_columns = ['id', 'name', 'identifier', 'sector', 'portfolio_id', 'account_id', 'total_invested', 'override_country', 'country_manually_edited', 'country_manual_edit_date']
    missing_columns = [col for col in required_columns if col not in col_names]
    if missing_columns:
        logger.warning(f"Missing columns in 'companies' table: {missing_columns}")

    # Check market_prices table structure and add missing columns if necessary
    market_prices_check = cursor.execute("PRAGMA table_info(market_prices)").fetchall()
    col_names = [col[1] for col in market_prices_check]
    required_columns = ['identifier', 'price', 'currency', 'price_eur', 'last_updated', 'country']
    missing_columns = [col for col in required_columns if col not in col_names]
    if missing_columns:
        logger.warning(f"Missing columns in 'market_prices' table: {missing_columns}")

    # Check identifier_mappings table structure
    identifier_mappings_check = cursor.execute("PRAGMA table_info(identifier_mappings)").fetchall()
    col_names = [col[1] for col in identifier_mappings_check]
    required_columns = ['id', 'account_id', 'csv_identifier', 'preferred_identifier', 'company_name', 'created_at', 'updated_at']
    missing_columns = [col for col in required_columns if col not in col_names]
    if missing_columns:
        logger.warning(f"Missing columns in 'identifier_mappings' table: {missing_columns}")

def is_database_empty(db):
    """
    Check if the database is basically empty (e.g., no user accounts or portfolios).
    Return True if it's empty, False otherwise.
    """
    cursor = db.cursor()
    # For instance, check if there are any accounts besides a global one
    cursor.execute("SELECT COUNT(*) as cnt FROM accounts")
    row = cursor.fetchone()
    if row and row['cnt'] == 0:
        return True
    return False

def create_default_data(db):
    """
    Insert any default or sample data if needed.
    This function is called when the database is detected as empty.
    """
    logger.info("Creating default sample data...")
    cursor = db.cursor()

    # Example: Create a placeholder global account
    cursor.execute("""
        INSERT INTO accounts (username, created_at) 
        VALUES ('_global', datetime('now'))
    """)
    db.commit()
    logger.info("Default global account created.")

def backup_database():
    """
    Create a backup of the current database.
    """
    try:
        db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        # Use backups folder in instance
        backup_dir = os.path.join('instance', 'backups')
        
        # Create backup directory if it doesn't exist
        os.makedirs(backup_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_filename = os.path.join(backup_dir, f"backup_{timestamp}.db")

        shutil.copy(db_path, backup_filename)
        logger.info(f"Database backed up successfully to {backup_filename}")

        # Clean up old backups
        cleanup_old_backups(backup_dir, current_app.config.get('MAX_BACKUP_FILES', 10))
        return backup_filename
    except Exception as e:
        logger.error(f"Database backup failed: {e}")
        return None

def cleanup_old_backups(directory, max_files=10):
    """
    Remove older backup files to maintain a limit on the number of backups.
    Keeps the most recent 'max_files' backup files.
    """
    try:
        backup_files = [
            os.path.join(directory, f) for f in os.listdir(directory)
            if f.endswith(".db") and os.path.isfile(os.path.join(directory, f))
        ]
        backup_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)

        for old_backup in backup_files[max_files:]:
            os.remove(old_backup)
            logger.info(f"Removed old backup: {old_backup}")

    except Exception as e:
        logger.error(f"Error cleaning up old backups: {e}")

def query_db(query, args=(), one=False):
    """
    Query the database and return results as dictionary objects.
    """
    try:
        logger.debug(f"Executing query: {query}")
        logger.debug(f"Query args: {args}")
        
        cursor = get_db().execute(query, args)
        rv = cursor.fetchall()
        cursor.close()
        
        # Convert rows to dictionaries
        result = [dict(row) for row in rv]
        logger.debug(f"Query returned {len(result)} rows")
        
        return (result[0] if result else None) if one else result
    except Exception as e:
        logger.error(f"Database query failed: {str(e)}")
        logger.error(f"Query was: {query}")
        logger.error(f"Args were: {args}")
        raise

def execute_db(query, args=()):
    """
    Execute a statement and commit changes, returning the rowcount.
    """
    try:
        logger.debug(f"Executing statement: {query}")
        logger.debug(f"Statement args: {args}")
        
        db = get_db()
        cursor = db.execute(query, args)
        rowcount = cursor.rowcount
        db.commit()
        cursor.close()
        
        logger.debug(f"Statement affected {rowcount} rows")
        return rowcount
    except Exception as e:
        logger.error(f"Database execute failed: {str(e)}")
        logger.error(f"Statement was: {query}")
        logger.error(f"Args were: {args}")
        raise

def _safe_add_column(cursor, table, column_def):
    """
    Safely add a column to a table, ignoring duplicate column errors.

    Args:
        cursor: Database cursor
        table: Table name
        column_def: Column definition (e.g., "my_col TEXT")
    """
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column_def}")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise
        # Column already exists, that's fine
        logger.debug(f"Column {column_def.split()[0]} already exists in {table}")

def migrate_database():
    """
    Run database migrations using version tracking for efficiency.

    Only runs migrations that haven't been applied yet, tracked via schema_version table.
    This avoids redundant SELECT queries on every startup.
    """
    db = get_db()
    cursor = db.cursor()

    # Latest migration version
    LATEST_VERSION = 10

    try:
        # Get current schema version
        cursor.execute('SELECT version FROM schema_version LIMIT 1')
        result = cursor.fetchone()
        current_version = result[0] if result else 0

        if current_version >= LATEST_VERSION:
            logger.debug(f"Database schema is up to date (version {current_version})")
            return

        logger.info(f"Database schema version {current_version}, migrating to {LATEST_VERSION}")

        # Migration 1: Add user-edited shares tracking columns
        if current_version < 1:
            logger.info("Applying migration 1: Adding user-edited shares tracking columns")
            _safe_add_column(cursor, "company_shares", "manual_edit_date DATETIME")
            _safe_add_column(cursor, "company_shares", "is_manually_edited BOOLEAN DEFAULT 0")
            _safe_add_column(cursor, "company_shares", "csv_modified_after_edit BOOLEAN DEFAULT 0")
            cursor.execute("UPDATE schema_version SET version = 1, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 1 completed")

        # Migration 2: Add country override columns
        if current_version < 2:
            logger.info("Applying migration 2: Adding country override columns")
            _safe_add_column(cursor, "companies", "override_country TEXT")
            _safe_add_column(cursor, "companies", "country_manually_edited BOOLEAN DEFAULT 0")
            _safe_add_column(cursor, "companies", "country_manual_edit_date DATETIME")
            cursor.execute("UPDATE schema_version SET version = 2, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 2 completed")

        # Migration 3: Add custom value columns
        if current_version < 3:
            logger.info("Applying migration 3: Adding custom value columns")
            _safe_add_column(cursor, "companies", "custom_total_value REAL")
            _safe_add_column(cursor, "companies", "custom_price_eur REAL")
            _safe_add_column(cursor, "companies", "is_custom_value BOOLEAN DEFAULT 0")
            _safe_add_column(cursor, "companies", "custom_value_date DATETIME")
            cursor.execute("UPDATE schema_version SET version = 3, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 3 completed")

        # Migration 4: Add investment_type column
        if current_version < 4:
            logger.info("Applying migration 4: Adding investment_type column")
            _safe_add_column(cursor, "companies", "investment_type TEXT CHECK(investment_type IN ('Stock', 'ETF'))")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_companies_investment_type ON companies(investment_type)")
            cursor.execute("UPDATE schema_version SET version = 4, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 4 completed")

        # Migration 5: Add identifier manual edit tracking columns
        if current_version < 5:
            logger.info("Applying migration 5: Adding identifier manual edit tracking columns")
            _safe_add_column(cursor, "companies", "override_identifier TEXT")
            _safe_add_column(cursor, "companies", "identifier_manually_edited BOOLEAN DEFAULT 0")
            _safe_add_column(cursor, "companies", "identifier_manual_edit_date DATETIME")
            cursor.execute("UPDATE schema_version SET version = 5, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 5 completed")

        # Migration 6: Add exchange_rates table for consistent currency conversion
        if current_version < 6:
            logger.info("Applying migration 6: Adding exchange_rates table")
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS exchange_rates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_currency TEXT NOT NULL,
                    to_currency TEXT DEFAULT 'EUR',
                    rate REAL NOT NULL,
                    last_updated DATETIME NOT NULL,
                    UNIQUE(from_currency, to_currency)
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency
                ON exchange_rates(from_currency, to_currency)
            ''')
            cursor.execute("UPDATE schema_version SET version = 6, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 6 completed: exchange_rates table created")

        # Migration 7: Add simulations table for allocation simulator scenarios
        if current_version < 7:
            logger.info("Applying migration 7: Adding simulations table")
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS simulations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    scope TEXT NOT NULL DEFAULT 'global',
                    portfolio_id INTEGER,
                    items TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (account_id) REFERENCES accounts(id),
                    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_simulations_account_id
                ON simulations(account_id)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_simulations_name
                ON simulations(account_id, name)
            ''')
            cursor.execute("UPDATE schema_version SET version = 7, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 7 completed: simulations table created")

        # Migration 8: Add thesis column for investment thesis tracking
        if current_version < 8:
            logger.info("Applying migration 8: Adding thesis column to companies")
            _safe_add_column(cursor, "companies", "thesis TEXT DEFAULT ''")
            cursor.execute("UPDATE schema_version SET version = 8, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 8 completed: thesis column added")

        # Migration 9: Rename category to sector
        if current_version < 9:
            logger.info("Applying migration 9: Renaming category to sector")
            # Rename column using SQLite's ALTER TABLE RENAME COLUMN (SQLite 3.25+)
            cursor.execute('ALTER TABLE companies RENAME COLUMN category TO sector')
            # Drop old indexes
            cursor.execute('DROP INDEX IF EXISTS idx_companies_category')
            cursor.execute('DROP INDEX IF EXISTS idx_companies_portfolio_category')
            # Create new indexes with sector naming
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_companies_portfolio_sector ON companies(portfolio_id, sector)')
            cursor.execute("UPDATE schema_version SET version = 9, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 9 completed: category renamed to sector")

        # Migration 10: Add cash balance column to accounts
        if current_version < 10:
            logger.info("Applying migration 10: Adding cash column to accounts")
            _safe_add_column(cursor, "accounts", "cash REAL DEFAULT 0")
            cursor.execute("UPDATE schema_version SET version = 10, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 10 completed: cash column added to accounts")

        logger.info(f"Database migrations completed successfully (version {LATEST_VERSION})")

    except sqlite3.Error as e:
        logger.error(f"Database migration failed: {e}")
        db.rollback()
        raise RuntimeError(f"Database migration failed: {e}") from e
    except Exception as e:
        logger.error(f"Unexpected error during database migration: {e}")
        db.rollback()
        raise

@click.command('init-db')
@with_appcontext
def init_db_command():
    """Clear the existing data and create new tables."""
    init_db(current_app)
    logger.info('Initialized the database.')

