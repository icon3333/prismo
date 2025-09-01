import os
import sqlite3
import shutil
from datetime import datetime
import logging
from flask import g, current_app
import click
from flask.cli import with_appcontext

# Configure logging
logger = logging.getLogger(__name__)

# Store the database path when the app initializes
_db_path = None

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
            logger.debug(f"Connected to database: {db_path}")
        except sqlite3.OperationalError as e:
            logger.error(f"Failed to connect to database {db_path}: {e}")
            # If we can't connect, try creating the file first
            try:
                # Touch the file to create it
                open(db_path, 'a').close()
                g.db = sqlite3.connect(db_path, detect_types=sqlite3.PARSE_DECLTYPES)
                g.db.row_factory = sqlite3.Row
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
    """
    global _db_path
    if _db_path is None:
        # Fallback to try getting from current_app if available
        try:
            from flask import current_app
            _db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
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
        return db
    except sqlite3.OperationalError as e:
        logger.error(f"Failed to connect to background database {_db_path}: {e}")
        # If we can't connect, try creating the file first
        try:
            # Touch the file to create it
            open(_db_path, 'a').close()
            db = sqlite3.connect(_db_path, detect_types=sqlite3.PARSE_DECLTYPES)
            db.row_factory = sqlite3.Row
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
        
        db = get_db()
        # Use safe schema that doesn't drop existing tables
        with app.open_resource('../instance/schema.sql', mode='r') as f:
            db.cursor().executescript(f.read())
        
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
        db.commit()

        try:
            # Create tables if not present
            cursor = db.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall()]

            if not tables or 'accounts' not in tables:
                logger.info("Initializing database schema from schema.sql ...")
                schema_path = os.path.join('instance', 'schema.sql')
                with open(schema_path, 'r', encoding='utf-8') as f:
                    db.executescript(f.read())
                db.commit()
                logger.info("Database schema initialized.")

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
        'market_prices', 'expanded_state', 'identifier_mappings'
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
    required_columns = ['id', 'name', 'identifier', 'category', 'portfolio_id', 'account_id', 'total_invested']
    missing_columns = [col for col in required_columns if col not in col_names]
    if missing_columns:
        logger.warning(f"Missing columns in 'companies' table: {missing_columns}")

    # Check market_prices table structure and add missing columns if necessary
    market_prices_check = cursor.execute("PRAGMA table_info(market_prices)").fetchall()
    col_names = [col[1] for col in market_prices_check]
    required_columns = ['identifier', 'price', 'currency', 'price_eur', 'last_updated']
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

def migrate_database():
    """Run database migrations"""
    db = get_db()
    cursor = db.cursor()
    
    try:
        # Check if we need to add the new columns for tracking user-edited shares
        try:
            cursor.execute("SELECT manual_edit_date FROM company_shares LIMIT 1")
        except Exception:
            # Columns don't exist, add them
            logger.info("Adding user-edited shares tracking columns to company_shares table")
            cursor.execute("ALTER TABLE company_shares ADD COLUMN manual_edit_date DATETIME")
            cursor.execute("ALTER TABLE company_shares ADD COLUMN is_manually_edited BOOLEAN DEFAULT 0")
            cursor.execute("ALTER TABLE company_shares ADD COLUMN csv_modified_after_edit BOOLEAN DEFAULT 0")
            db.commit()
            logger.info("Successfully added user-edited shares tracking columns")
    
    except Exception as e:
        logger.error(f"Error during database migration: {e}")
        db.rollback()
        raise

@click.command('init-db')
@with_appcontext
def init_db_command():
    """Clear the existing data and create new tables."""
    init_db(current_app)
    logger.info('Initialized the database.')

