import os
import sqlite3
from datetime import datetime
from pathlib import Path
import logging
import threading
from flask import g, current_app

# Configure logging
logger = logging.getLogger(__name__)

# Schema version that app/schema.sql produces. Bump it together with every new
# migration in migrate_database(); a database built fresh from schema.sql is
# stamped straight at this version rather than replaying the migration chain.
LATEST_SCHEMA_VERSION = 24

# Oldest schema version this build can migrate FROM. Migrations 1-23 were
# removed as unreachable (see migrate_database); commit 4226f05 still has them.
MIN_MIGRATABLE_VERSION = 23

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
        # Full optimization set for normal connections.
        # mmap_size enables memory-mapped reads (256 MB cap); on hot pages this
        # turns repeated reads into pointer derefs instead of file I/O.
        db.executescript('''
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -64000;
            PRAGMA mmap_size = 268435456;
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
    Bring the database up to date, then seed it if it is empty.

    Order matters. schema.sql only ever CREATEs — it cannot add a column to a
    table that already exists — so an older database has to be migrated FIRST,
    otherwise schema.sql's newer indexes reference columns that are not there
    yet (that is exactly how migration 24's `background_jobs.account_id` index
    broke startup on a v23 database).

      1. bootstrap schema_version
      2. migrate_database()  — brings an existing database's columns forward
      3. schema.sql          — creates anything still missing (idempotent)
    """
    with app.app_context():
        # Store the database path for background operations
        db_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        set_db_path(db_path)
        logger.info(f"Database path configured: {db_path}")
        logger.info(f"Database file exists: {os.path.exists(db_path)}")

        db = get_db()

        try:
            with db:
                # Is this an empty file, or an existing Prismo database?
                # Must be decided before schema.sql creates anything.
                is_new_database = db.execute(
                    "SELECT COUNT(*) FROM sqlite_master "
                    "WHERE type='table' AND name='accounts'"
                ).fetchone()[0] == 0

                db.execute('''
                    CREATE TABLE IF NOT EXISTS schema_version (
                        version INTEGER PRIMARY KEY,
                        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                if not db.execute('SELECT version FROM schema_version LIMIT 1').fetchone():
                    # A new database gets built from the CURRENT schema.sql, so
                    # it is already at the latest version — stamp it there
                    # instead of replaying the whole chain over a schema that is
                    # correct by construction. That replay is why every
                    # migration also had to be a no-op on a fresh schema (see
                    # migration 9's `category` guard). A pre-schema_version
                    # database starts at 0 and migrates normally.
                    start_version = LATEST_SCHEMA_VERSION if is_new_database else 0
                    db.execute(
                        'INSERT INTO schema_version (version) VALUES (?)',
                        [start_version],
                    )
                    logger.info(
                        f"Stamped {'new' if is_new_database else 'existing'} "
                        f"database at schema version {start_version}"
                    )

            # 2. Migrate an existing database's columns forward.
            migrate_database()

            # 3. Create whatever is still missing. All statements are
            #    CREATE ... IF NOT EXISTS, so this is a no-op once current.
            with db:
                with app.open_resource('schema.sql', mode='r') as f:
                    db.cursor().executescript(f.read())
            logger.debug("Schema applied from app/schema.sql")

            if is_database_empty(db):
                logger.info("Database is empty - creating default account.")
                create_default_data(db)

            app.teardown_appcontext(close_db)

        except Exception as e:
            logger.error(f"Database initialization failed: {e}")
            raise

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

def backup_database(prefix='backup'):
    """
    Create a backup of the current database.

    Uses SQLite's online backup API instead of a file copy: the database runs
    in WAL mode, so a plain copy can miss committed-but-uncheckpointed WAL
    data or tear mid-write. The backup API produces a consistent snapshot
    even while other connections hold the database open.

    Args:
        prefix: Backup filename prefix. Each prefix gets its own retention
                pool (e.g. 'pre_import' snapshots don't evict scheduled
                'backup' files).

    Returns:
        str | None: Path of the backup file, or None on failure.
    """
    backup_filename = None
    try:
        db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        backup_dir = current_app.config.get('DB_BACKUP_DIR') or os.path.join('instance', 'backups')

        # sqlite3.connect would silently create an empty DB for a bad path,
        # producing a "successful" backup of nothing
        if not os.path.exists(db_path):
            raise FileNotFoundError(f"Database file not found: {db_path}")

        # Create backup directory if it doesn't exist
        os.makedirs(backup_dir, exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        final_filename = os.path.join(backup_dir, f"{prefix}_{timestamp}.db")
        # Write to a temp name and rename only once the snapshot is complete,
        # so a hard shutdown mid-backup never leaves a torn *.db file that
        # looks like a valid backup. cleanup_old_backups ignores *.tmp.
        backup_filename = final_filename + '.tmp'

        src = sqlite3.connect(db_path)
        try:
            src.execute('PRAGMA busy_timeout = 5000')
            dest = sqlite3.connect(backup_filename)
            try:
                src.backup(dest)
            finally:
                dest.close()
        finally:
            src.close()

        os.rename(backup_filename, final_filename)
        backup_filename = final_filename

        logger.info(f"Database backed up successfully to {backup_filename}")

        # Clean up old backups
        cleanup_old_backups(backup_dir, current_app.config.get('MAX_BACKUP_FILES', 10), prefix=prefix)
        return backup_filename
    except Exception as e:
        logger.error(f"Database backup failed: {e}")
        # Never leave a partial snapshot behind that could be mistaken for a good backup
        if backup_filename and os.path.exists(backup_filename):
            try:
                os.remove(backup_filename)
            except OSError:
                pass
        return None

def cleanup_old_backups(directory, max_files=10, prefix='backup'):
    """
    Remove older backup files to maintain a limit on the number of backups.
    Keeps the most recent 'max_files' files for the given prefix; other
    prefixes are left untouched so backup families don't evict each other.
    """
    try:
        entries = [
            os.path.join(directory, f) for f in os.listdir(directory)
            if f.startswith(f"{prefix}_") and os.path.isfile(os.path.join(directory, f))
        ]

        # Completed backups end in .db; *.tmp files are in-progress or torn
        # snapshots — never counted as backups, and stale ones are removed.
        backup_files = [p for p in entries if p.endswith(".db")]
        for stale_tmp in (p for p in entries if p.endswith(".tmp")):
            try:
                os.remove(stale_tmp)
                logger.info(f"Removed stale temp backup: {stale_tmp}")
            except OSError:
                pass

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
    Bring an existing database forward to LATEST_SCHEMA_VERSION.

    Migrations 1-23 were deleted in favour of MIN_MIGRATABLE_VERSION: this is a
    single-user application, and every database in existence — the live one and
    every backup — was already at 23, so they could never run again. A database
    created fresh is stamped at LATEST_SCHEMA_VERSION by init_db() and skips
    this entirely.

    The old chain is not lost, just not carried: `git show 4226f05` has it, and
    the guard below names that commit. Upgrading a pre-v23 database means
    checking that commit out and booting once.
    """
    db = get_db()
    cursor = db.cursor()

    LATEST_VERSION = LATEST_SCHEMA_VERSION

    try:
        # Get current schema version
        cursor.execute('SELECT version FROM schema_version LIMIT 1')
        result = cursor.fetchone()
        current_version = result[0] if result else 0

        if current_version >= LATEST_VERSION:
            logger.debug(f"Database schema is up to date (version {current_version})")
            return

        if current_version < MIN_MIGRATABLE_VERSION:
            raise RuntimeError(
                f"Database is at schema version {current_version}; this build can "
                f"only migrate from {MIN_MIGRATABLE_VERSION} or later. Migrations "
                f"1-{MIN_MIGRATABLE_VERSION} were removed as unreachable. To "
                f"upgrade this file, check out commit 4226f05 (which still has "
                f"the full chain), boot once against it, then return to this "
                f"build. Refusing to start rather than half-migrate."
            )

        logger.info(f"Database schema version {current_version}, migrating to {LATEST_VERSION}")

        # Migration 24: Account-owned CSV jobs and monthly decision reviews
        if current_version < 24:
            logger.info("Applying migration 24: Adding account-owned jobs and monthly reviews")
            _safe_add_column(cursor, "background_jobs", "account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE")
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS monthly_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL,
                    source_job_id TEXT,
                    period TEXT NOT NULL,
                    previous_review_id INTEGER,
                    status TEXT NOT NULL DEFAULT 'draft'
                        CHECK(status IN ('draft', 'completed')),
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    payload TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                    FOREIGN KEY (source_job_id) REFERENCES background_jobs(id) ON DELETE SET NULL,
                    FOREIGN KEY (previous_review_id) REFERENCES monthly_reviews(id) ON DELETE SET NULL
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_background_jobs_account_status
                ON background_jobs(account_id, status)
            ''')
            cursor.execute('''
                CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_active_account
                ON background_jobs(account_id)
                WHERE account_id IS NOT NULL AND status IN ('pending', 'processing')
            ''')
            cursor.execute('''
                CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_reviews_account_source_job
                ON monthly_reviews(account_id, source_job_id)
                WHERE source_job_id IS NOT NULL
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_monthly_reviews_account_status_created
                ON monthly_reviews(account_id, status, created_at DESC, id DESC)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_monthly_reviews_account_completed
                ON monthly_reviews(account_id, completed_at DESC, id DESC)
                WHERE status = 'completed'
            ''')
            cursor.execute("UPDATE schema_version SET version = 24, applied_at = CURRENT_TIMESTAMP")
            db.commit()
            logger.info("Migration 24 completed: account-owned jobs and monthly reviews added")

        logger.info(f"Database migrations completed successfully (version {LATEST_VERSION})")

    except sqlite3.Error as e:
        logger.error(f"Database migration failed: {e}")
        db.rollback()
        raise RuntimeError(f"Database migration failed: {e}") from e
    except Exception as e:
        logger.error(f"Unexpected error during database migration: {e}")
        db.rollback()
        raise
