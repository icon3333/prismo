import logging
import threading
import time
from datetime import datetime, timedelta
from flask import current_app
from app.database.db_manager import query_db, backup_database
from app.utils.batch_processing import start_batch_process

logger = logging.getLogger(__name__)


def auto_update_prices_if_needed():
    """Trigger bulk price update if last update is older than configured interval."""
    try:
        row = query_db("SELECT MAX(last_price_update) as last FROM accounts", one=True)
        last_str = row['last'] if row else None
        needs_update = True
        if last_str:
            try:
                last_dt = datetime.fromisoformat(last_str)
            except ValueError:
                last_dt = datetime.strptime(last_str, "%Y-%m-%d %H:%M:%S")
            if datetime.now() - last_dt < current_app.config.get('PRICE_UPDATE_INTERVAL', timedelta(hours=24)):
                needs_update = False
        if not needs_update:
            logger.info("Price data is recent; skipping automatic update.")
            return

        identifiers = query_db(
            """
            SELECT DISTINCT identifier FROM companies
            WHERE identifier IS NOT NULL AND identifier != ''
            """
        )
        identifiers = [row['identifier'] for row in identifiers]
        if not identifiers:
            logger.info("No identifiers found for automatic price update.")
            return

        job_id = start_batch_process(identifiers)
        logger.info(f"Started automatic price update job {job_id} for {len(identifiers)} identifiers")
    except Exception as exc:
        logger.error(f"Failed to run automatic price update: {exc}")


def schedule_automatic_backups():
    """Schedule automatic database backups based on configuration interval."""
    backup_interval_hours = current_app.config.get('BACKUP_INTERVAL_HOURS', 6)
    backup_interval_seconds = backup_interval_hours * 60 * 60
    
    def backup_worker():
        """Background worker for automatic database backups."""
        while True:
            try:
                # Wait for configured interval between backups
                time.sleep(backup_interval_seconds)
                
                # Perform backup
                backup_file = backup_database()
                if backup_file:
                    logger.info(f"Automatic database backup completed: {backup_file}")
                else:
                    logger.error("Automatic database backup failed")
                    
            except Exception as e:
                logger.error(f"Error in automatic backup worker: {e}")
                # Continue running despite errors
                time.sleep(60)  # Wait 1 minute before retrying
    
    # Create initial backup immediately
    try:
        initial_backup = backup_database()
        if initial_backup:
            logger.info(f"Initial database backup completed: {initial_backup}")
        else:
            logger.error("Initial database backup failed")
    except Exception as e:
        logger.error(f"Failed to create initial backup: {e}")
    
    # Start background backup thread
    backup_thread = threading.Thread(target=backup_worker, daemon=True)
    backup_thread.start()
    logger.info(f"Automatic database backup scheduler started (every {backup_interval_hours} hours)")
