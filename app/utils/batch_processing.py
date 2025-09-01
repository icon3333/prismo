import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import uuid
import json
from datetime import datetime
from typing import Dict, Any, List
import time

from flask import current_app

from app.utils.yfinance_utils import get_isin_data
from app.utils.db_utils import update_price_in_db_background, query_background_db, execute_background_db
from app.database.db_manager import get_db

logger = logging.getLogger(__name__)

# This list is just a reference. Actual ISINs will come from the database or user input
ISIN_LIST = [
    'US88579Y1010',  # MMM
    'US36467W1099',  # GME
    'DE000BAY0017',  # Bayer
    'US0231351067',  # Amazon
    'US88160R1014',  # Tesla
    # (ISIN list shortened for clarity)
]


def init_db():
    """Initialize database with required table - now handled by main database schema."""
    # This function is no longer needed as background_jobs table 
    # is now part of the main database schema
    pass


def _process_single_identifier(identifier: str) -> Dict[str, Any]:
    """
    Processes a single identifier to fetch its price and metadata.
    This function is designed to be run in a thread pool.
    """
    try:
        logger.info(f"Processing identifier: {identifier}")
        result = get_isin_data(identifier)

        if result.get('success'):
            # get_isin_data returns data directly, not nested in a 'data' field
            price = result.get('price')
            price_eur = result.get('price_eur')

            if price is not None:
                # Update the price in the main database using background-specific function
                update_success = update_price_in_db_background(
                    identifier,
                    price,
                    result.get('currency', 'USD'),
                    price_eur or price,
                    country=result.get('country'),
                    modified_identifier=result.get('modified_identifier')
                )
                if update_success:
                    logger.info(f"Successfully updated price for {identifier}")
                    return {'identifier': identifier, 'status': 'success'}
                else:
                    logger.warning(
                        f"Failed to update price in database for {identifier}")
                    return {'identifier': identifier, 'status': 'db_error', 'error': 'Failed to write to DB'}
            else:
                logger.warning(f"No price data found for {identifier}")
                return {'identifier': identifier, 'status': 'no_price', 'error': 'No price data available'}
        else:
            logger.warning(
                f"Failed to fetch data for {identifier}: {result.get('error')}")
            return {'identifier': identifier, 'status': 'fetch_error', 'error': result.get('error')}
    except Exception as e:
        logger.error(
            f"Unhandled error processing {identifier}: {e}", exc_info=True)
        return {'identifier': identifier, 'status': 'exception', 'error': str(e)}


def _run_batch_job(app, job_id: str, identifiers: List[str]):
    """
    The main logic for the background batch processing job.
    Manages a thread pool and reports progress.
    """
    with app.app_context():
        total_items = len(identifiers)
        processed_count = 0
        success_count = 0
        failure_count = 0

        last_update_time = time.time()

        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_identifier = {executor.submit(
                _process_single_identifier, i): i for i in identifiers}

            for future in as_completed(future_to_identifier):
                result = future.result()

                if result.get('status') == 'success':
                    success_count += 1
                else:
                    failure_count += 1

                processed_count += 1

                # Batch progress updates to avoid excessive DB writes
                current_time = time.time()
                if current_time - last_update_time > 2:  # Update every 2 seconds
                    _update_job_progress_background(job_id, processed_count)
                    last_update_time = current_time

        # Final update with summary
        summary = {
            'total': total_items,
            'success_count': success_count,
            'failure_count': failure_count,
            'completion_time': datetime.now().isoformat()
        }
        _update_job_final_background(job_id, total_items, json.dumps(summary))
        logger.info(
            f"Batch job {job_id} complete. Success: {success_count}, Failed: {failure_count}")


def _update_job_progress_background(job_id: str, progress: int):
    """Update the progress of a job in the database using background connection."""
    try:
        execute_background_db(
            "UPDATE background_jobs SET progress = ?, updated_at = ? WHERE id = ?",
            (progress, datetime.now(), job_id)
        )
    except Exception as e:
        logger.error(f"Failed to update job progress for {job_id}: {e}")


def _update_job_final_background(job_id: str, total: int, summary: str):
    """Mark the job as completed in the database using background connection."""
    try:
        execute_background_db(
            "UPDATE background_jobs SET status = 'completed', progress = ?, result = ?, updated_at = ? WHERE id = ?",
            (total, summary, datetime.now(), job_id)
        )
    except Exception as e:
        logger.error(f"Failed to finalize job {job_id}: {e}")


def start_batch_process(identifiers: List[str]) -> str:
    """
    Starts a new background job to process a list of identifiers.
    Returns the job ID.
    """
    app = current_app._get_current_object()  # type: ignore

    job_id = str(uuid.uuid4())
    total = len(identifiers)

    try:
        db = get_db()
        db.execute(
            "INSERT INTO background_jobs (id, name, status, progress, total) VALUES (?, ?, ?, ?, ?)",
            (job_id, 'price_update', 'processing', 0, total)
        )
        db.commit()

        thread = threading.Thread(
            target=_run_batch_job, args=(app, job_id, identifiers))
        thread.daemon = True
        thread.start()

        return job_id
    except Exception as e:
        logger.error(f"Failed to start batch job: {e}")
        raise


def get_job_status(job_id: str) -> Dict[str, Any]:
    """
    Get the status and results of a batch processing job from the main database.
    """
    try:
        row = get_db().execute("SELECT * FROM background_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return {'status': 'not_found'}

        return {
            'job_id': row['id'],
            'status': row['status'],
            'progress': row['progress'],
            'total': row['total'],
            'results': json.loads(row['result']) if row['result'] else None,
            'created_at': row['created_at'].isoformat(),
            'updated_at': row['updated_at'].isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get job status for {job_id}: {e}")
        return {'status': 'db_error', 'error': str(e)}


def get_latest_job_progress() -> Dict[str, Any]:
    """
    Get the progress of the most recent batch processing job.
    """
    try:
        row = get_db().execute(
            "SELECT * FROM background_jobs ORDER BY created_at DESC LIMIT 1").fetchone()
        if row is None:
            return {'current': 0, 'total': 0, 'percentage': 0, 'status': 'idle'}

        progress = row['progress'] or 0
        total = row['total'] or 1
        percentage = int((progress / total) * 100) if total > 0 else 0

        return {
            'current': progress,
            'total': total,
            'percentage': percentage,
            'status': row['status'] or 'idle',
            'job_id': row['id']
        }
    except Exception as e:
        logger.error(f"Failed to get latest job progress: {e}")
        return {'current': 0, 'total': 0, 'percentage': 0, 'status': 'db_error'}
