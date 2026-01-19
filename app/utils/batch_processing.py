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
from app.db_manager import get_db
from app.exceptions import PriceFetchError, DatabaseError
from app.repositories.price_repository import PriceRepository

logger = logging.getLogger(__name__)

# Threshold for async processing - use threads only for batches >= this size
# For single-user homeserver, small batches are faster with synchronous processing
ASYNC_THRESHOLD = 20


def _extract_price_data(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract and normalize price data from yfinance result.

    Handles nested data structures from get_isin_data.

    Args:
        result: Result dict from get_isin_data()

    Returns:
        Dict with normalized price data (price, currency, price_eur, country, etc.)
    """
    data = result.get('data', {})

    return {
        'price': data.get('currentPrice') or result.get('price'),
        'price_eur': data.get('priceEUR') or result.get('price_eur'),
        'currency': data.get('currency') or result.get('currency', 'USD'),
        'country': data.get('country') or result.get('country'),
        'modified_identifier': result.get('modified_identifier')
    }


def _process_single_identifier(identifier: str) -> Dict[str, Any]:
    """
    Process a single identifier: fetch price and update database.

    Refactored for cleaner separation of concerns:
    - Fetch price data via yfinance
    - Extract and validate data
    - Update database via background-safe function

    This function is designed to be run in a thread pool.

    Args:
        identifier: Stock identifier (ISIN/ticker)

    Returns:
        Dict with processing result (status, identifier, error if any)
    """
    try:
        logger.info(f"Processing identifier: {identifier}")

        # Fetch price data from yfinance (with caching from Phase 2)
        result = get_isin_data(identifier)
        logger.debug(f"Price fetch result for {identifier}: success={result.get('success')}")

        if not result.get('success'):
            logger.warning(f"Failed to fetch data for {identifier}: {result.get('error')}")
            return {
                'identifier': identifier,
                'status': 'fetch_error',
                'error': result.get('error')
            }

        # Extract price data from result
        price_data = _extract_price_data(result)
        logger.debug(
            f"Extracted data: price={price_data['price']}, "
            f"currency={price_data['currency']}, price_eur={price_data['price_eur']}"
        )

        if price_data['price'] is None:
            logger.warning(f"No price data found for {identifier}")
            return {
                'identifier': identifier,
                'status': 'no_price',
                'error': 'No price data available'
            }

        # Update database (background-safe function)
        logger.debug(f"Updating database for {identifier}")
        update_success = update_price_in_db_background(
            identifier,
            price_data['price'],
            price_data['currency'],
            price_data['price_eur'] or price_data['price'],
            country=price_data['country'],
            modified_identifier=price_data['modified_identifier']
        )

        if update_success:
            logger.info(f"Successfully updated price for {identifier}")
            return {'identifier': identifier, 'status': 'success'}
        else:
            logger.error(f"Failed to update price in database for {identifier}")
            return {
                'identifier': identifier,
                'status': 'db_error',
                'error': 'Failed to write to DB'
            }

    except (KeyError, ValueError, TypeError) as e:
        logger.warning(f"Data error processing {identifier}: {e.__class__.__name__}: {e}")
        return {
            'identifier': identifier,
            'status': 'data_error',
            'error': f"{e.__class__.__name__}: {e}"
        }
    except Exception as e:
        logger.exception(f"Unexpected error processing {identifier}")
        return {
            'identifier': identifier,
            'status': 'exception',
            'error': f"{e.__class__.__name__}: {e}"
        }


def _run_csv_job(app, account_id: int, file_content: str, job_id: str):
    """
    Background job to process a CSV file.
    This runs in a separate thread with Flask application context.
    Uses database-based progress tracking to avoid session context issues.
    """
    with app.app_context():
        try:
            logger.debug(f" _run_csv_job started in background thread for account_id: {account_id}, job_id: {job_id}")
            logger.info(f"Starting background CSV processing for account_id: {account_id}, job_id: {job_id}")
            
            # Import here to avoid circular imports
            from app.utils.portfolio_processing import process_csv_data_background
            
            logger.debug(f" About to call process_csv_data_background with job_id: {job_id}")
            # Use the background version that doesn't depend on session
            success, message, result = process_csv_data_background(account_id, file_content, job_id)
            
            if success:
                logger.info(f"Background CSV processing completed successfully for account_id: {account_id}")
                # Mark job as completed in database
                _update_csv_job_final(job_id, 100, "CSV processing completed successfully")
                # Invalidate portfolio cache after successful CSV import
                try:
                    from app.routes.portfolio_api import invalidate_portfolio_cache
                    invalidate_portfolio_cache(account_id)
                    logger.debug(f"Cache invalidated after CSV processing for account_id: {account_id}")
                except Exception as cache_error:
                    logger.warning(f"Failed to invalidate cache after CSV processing: {cache_error}")
            else:
                logger.error(f"Background CSV processing failed for account_id: {account_id}: {message}")
                # Mark job as failed in database
                _update_csv_job_final(job_id, 0, f"Processing failed: {message}", "failed")
                
        except Exception as e:
            logger.error(f"Error in background CSV processing for account {account_id}: {e}", exc_info=True)
            # Set a final error status in database
            try:
                _update_csv_job_final(job_id, 0, f"Processing failed: {str(e)}", "failed")
            except Exception as db_error:
                logger.error(f"Failed to update error status in database: {db_error}")


def _update_csv_job_progress(job_id: str, progress: int, message: str = "Processing..."):
    """Update CSV job progress in the database."""
    try:
        execute_background_db(
            "UPDATE background_jobs SET progress = ?, result = ?, updated_at = ? WHERE id = ?",
            (progress, message, datetime.now(), job_id)
        )
    except Exception as e:
        logger.error(f"Failed to update CSV job progress for {job_id}: {e}")


def _update_csv_job_final(job_id: str, progress: int, message: str, status: str = "completed"):
    """Mark CSV job as completed or failed in the database."""
    try:
        execute_background_db(
            "UPDATE background_jobs SET status = ?, progress = ?, result = ?, updated_at = ? WHERE id = ?",
            (status, progress, message, datetime.now(), job_id)
        )
    except Exception as e:
        logger.error(f"Failed to finalize CSV job {job_id}: {e}")


def start_csv_processing_job(account_id: int, file_content: str) -> str:
    """
    Starts a background thread to process the uploaded CSV file.
    Returns job_id for tracking progress.
    """
    app = current_app._get_current_object()  # type: ignore
    job_id = str(uuid.uuid4())
    
    logger.info(f"Dispatching CSV processing to background thread for account {account_id}, job_id: {job_id}")

    try:
        # Create job record in database
        logger.debug(f" Creating job record in database for job_id: {job_id}")
        db = get_db()
        db.execute(
            "INSERT INTO background_jobs (id, name, status, progress, total) VALUES (?, ?, ?, ?, ?)",
            (job_id, 'csv_upload', 'processing', 0, 100)
        )
        db.commit()
        logger.debug(f" Job record created successfully in database for job_id: {job_id}")

        # Create and start the background thread
        logger.debug(f" Creating background thread for job_id: {job_id}")
        thread = threading.Thread(
            target=_run_csv_job, 
            args=(app, account_id, file_content, job_id),
            name=f"csv-processing-{account_id}-{job_id[:8]}"
        )
        thread.daemon = True
        thread.start()
        
        logger.info(f"CSV processing thread started successfully for account {account_id}, job_id: {job_id}")
        return job_id
        
    except Exception as e:
        logger.error(f"Failed to start CSV processing job: {e}")
        raise


def _run_batch_job(app, job_id: str, identifiers: List[str]):
    """
    The main logic for the background batch processing job.

    Smart execution: Uses sync processing for small batches (< ASYNC_THRESHOLD),
    async threading for large batches. This optimizes performance for single-user
    homeserver by avoiding thread overhead for small jobs.
    """
    with app.app_context():
        total_items = len(identifiers)

        # Decide execution mode based on batch size
        use_async = total_items >= ASYNC_THRESHOLD

        if use_async:
            logger.info(f"Processing {total_items} identifiers ASYNC (>= {ASYNC_THRESHOLD})")
            _run_batch_async(job_id, identifiers, total_items)
        else:
            logger.info(f"Processing {total_items} identifiers SYNC (< {ASYNC_THRESHOLD})")
            _run_batch_sync(job_id, identifiers, total_items)


def _track_batch_result(
    result: Dict[str, Any],
    success_count: int,
    failure_count: int,
    failed_identifiers: List[Dict]
) -> tuple[int, int, List[Dict]]:
    """
    Track batch processing result and update counters.

    Helper function to reduce duplication between sync and async processing.

    Args:
        result: Processing result from _process_single_identifier
        success_count: Current success count
        failure_count: Current failure count
        failed_identifiers: List of failed identifier dicts

    Returns:
        Tuple of (updated_success_count, updated_failure_count, updated_failed_list)
    """
    if result.get('status') == 'success':
        success_count += 1
    else:
        failure_count += 1
        failed_identifiers.append({
            'identifier': result['identifier'],
            'error': result.get('error', 'Unknown error')
        })

    return success_count, failure_count, failed_identifiers


def _create_job_summary(
    total_items: int,
    success_count: int,
    failure_count: int,
    failed_identifiers: List[Dict],
    execution_mode: str
) -> str:
    """
    Create job completion summary JSON.

    Args:
        total_items: Total number of items processed
        success_count: Number of successful updates
        failure_count: Number of failed updates
        failed_identifiers: List of failed identifiers with errors
        execution_mode: 'synchronous' or 'asynchronous'

    Returns:
        JSON string with summary
    """
    summary = {
        'total': total_items,
        'success_count': success_count,
        'failure_count': failure_count,
        'failed': failed_identifiers,
        'execution_mode': execution_mode,
        'completion_time': datetime.now().isoformat()
    }
    return json.dumps(summary)


def _run_batch_sync(job_id: str, identifiers: List[str], total_items: int):
    """
    Process identifiers synchronously (simple loop).

    Optimized for small batches (< ASYNC_THRESHOLD).
    Faster due to no thread overhead.

    Args:
        job_id: Job ID for tracking
        identifiers: List of identifiers to process
        total_items: Total number of items
    """
    processed_count = 0
    success_count = 0
    failure_count = 0
    failed_identifiers = []
    last_update_time = time.time()

    # Process each identifier sequentially
    for identifier in identifiers:
        result = _process_single_identifier(identifier)

        # Track result
        success_count, failure_count, failed_identifiers = _track_batch_result(
            result, success_count, failure_count, failed_identifiers
        )

        processed_count += 1

        # Throttled progress updates (every 2 seconds)
        current_time = time.time()
        if current_time - last_update_time > 2:
            _update_job_progress_background(job_id, processed_count)
            last_update_time = current_time

    # Final update with summary
    summary = _create_job_summary(
        total_items, success_count, failure_count, failed_identifiers, 'synchronous'
    )
    _update_job_final_background(job_id, total_items, summary)

    logger.info(f"Batch job {job_id} complete (SYNC). Success: {success_count}, Failed: {failure_count}")
    if failed_identifiers:
        logger.warning(f"Failed identifiers: {', '.join(f['identifier'] for f in failed_identifiers)}")


def _run_batch_async(job_id: str, identifiers: List[str], total_items: int):
    """
    Process identifiers asynchronously (ThreadPoolExecutor).

    Optimized for large batches (>= ASYNC_THRESHOLD).
    More efficient with parallel execution.

    Args:
        job_id: Job ID for tracking
        identifiers: List of identifiers to process
        total_items: Total number of items
    """
    processed_count = 0
    success_count = 0
    failure_count = 0
    failed_identifiers = []
    last_update_time = time.time()

    # Process identifiers in parallel with thread pool
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_identifier = {
            executor.submit(_process_single_identifier, identifier): identifier
            for identifier in identifiers
        }

        for future in as_completed(future_to_identifier):
            result = future.result()

            # Track result
            success_count, failure_count, failed_identifiers = _track_batch_result(
                result, success_count, failure_count, failed_identifiers
            )

            processed_count += 1

            # Throttled progress updates (every 2 seconds)
            current_time = time.time()
            if current_time - last_update_time > 2:
                _update_job_progress_background(job_id, processed_count)
                last_update_time = current_time

    # Final update with summary
    summary = _create_job_summary(
        total_items, success_count, failure_count, failed_identifiers, 'asynchronous'
    )
    _update_job_final_background(job_id, total_items, summary)

    logger.info(f"Batch job {job_id} complete (ASYNC). Success: {success_count}, Failed: {failure_count}")
    if failed_identifiers:
        logger.warning(f"Failed identifiers: {', '.join(f['identifier'] for f in failed_identifiers)}")


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

        # Handle result field safely - it might be a string message or JSON
        result_data = None
        if row['result']:
            try:
                # Try to parse as JSON first
                result_data = json.loads(row['result'])
            except (json.JSONDecodeError, TypeError):
                # If JSON parsing fails, treat as plain string message
                result_data = {'message': str(row['result'])}

        return {
            'job_id': row['id'],
            'status': row['status'],
            'progress': row['progress'],
            'total': row['total'],
            'results': result_data,
            'message': str(row['result']) if row['result'] else 'Processing...',
            'created_at': row['created_at'].isoformat() if row['created_at'] else None,
            'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None
        }
    except Exception as e:
        logger.error(f"Failed to get job status for {job_id}: {e}")
        return {'status': 'db_error', 'error': str(e)}


def cancel_background_job(job_id: str) -> bool:
    """
    Cancel a background job by marking it as cancelled in the database.
    Returns True if successful, False otherwise.
    """
    try:
        # Update job status to cancelled
        from app.utils.db_utils import execute_background_db
        rowcount = execute_background_db(
            "UPDATE background_jobs SET status = 'cancelled', result = 'Upload cancelled by user', updated_at = ? WHERE id = ? AND status IN ('pending', 'processing')",
            (datetime.now(), job_id)
        )
        
        if rowcount > 0:
            logger.info(f"Background job {job_id} marked as cancelled")
            return True
        else:
            logger.warning(f"Background job {job_id} not found or already completed")
            return False
        
    except Exception as e:
        logger.error(f"Failed to cancel background job {job_id}: {e}")
        return False


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
