import logging
from datetime import datetime, timedelta
from flask import current_app
from app.database.db_manager import query_db
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
