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
        logger.info(f"🔄 Processing identifier: {identifier}")
        result = get_isin_data(identifier)

        logger.debug(f"📊 Price fetch result for {identifier}: success={result.get('success')}, price={result.get('price')}, currency={result.get('currency')}")

        if result.get('success'):
            # Extract price data from nested 'data' structure or fallback to top level
            data = result.get('data', {})
            price = data.get('currentPrice') or result.get('price')
            price_eur = data.get('priceEUR') or result.get('price_eur')
            currency = data.get('currency') or result.get('currency', 'USD')
            country = data.get('country') or result.get('country')
            modified_identifier = result.get('modified_identifier')

            logger.debug(f"🔍 Extracted data: price={price}, currency={currency}, price_eur={price_eur}")

            if price is not None:
                logger.debug(f"💰 Price data found for {identifier}: {price} {currency} ({price_eur} EUR)")
                
                # Update the price in the main database using background-specific function
                logger.debug(f"💾 Attempting database update for {identifier}")
                update_success = update_price_in_db_background(
                    identifier,
                    price,
                    currency,
                    price_eur or price,
                    country=country,
                    modified_identifier=modified_identifier
                )
                
                logger.debug(f"📝 Database update result for {identifier}: {update_success}")
                
                if update_success:
                    logger.info(f"✅ Successfully updated price for {identifier}")
                    return {'identifier': identifier, 'status': 'success'}
                else:
                    logger.error(f"❌ Failed to update price in database for {identifier} - check database logs above")
                    return {'identifier': identifier, 'status': 'db_error', 'error': 'Failed to write to DB'}
            else:
                logger.warning(f"⚠️ No price data found for {identifier} (price is None)")
                logger.debug(f"🔍 Full result for {identifier}: {result}")
                return {'identifier': identifier, 'status': 'no_price', 'error': 'No price data available'}
        else:
            logger.warning(f"⚠️ Failed to fetch data for {identifier}: {result.get('error')}")
            logger.debug(f"🔍 Full failed result for {identifier}: {result}")
            return {'identifier': identifier, 'status': 'fetch_error', 'error': result.get('error')}
    except Exception as e:
        logger.error(f"💥 Unhandled error processing {identifier}: {e}", exc_info=True)
        return {'identifier': identifier, 'status': 'exception', 'error': str(e)}


def _run_csv_job(app, account_id: int, file_content: str, job_id: str):
    """
    Background job to process a CSV file.
    This runs in a separate thread with Flask application context.
    Uses database-based progress tracking to avoid session context issues.
    """
    with app.app_context():
        try:
            logger.info(f"DEBUG: _run_csv_job started in background thread for account_id: {account_id}, job_id: {job_id}")
            logger.info(f"Starting background CSV processing for account_id: {account_id}, job_id: {job_id}")
            
            # Import here to avoid circular imports
            from app.utils.portfolio_processing import process_csv_data_background
            
            logger.info(f"DEBUG: About to call process_csv_data_background with job_id: {job_id}")
            # Use the background version that doesn't depend on session
            success, message, result = process_csv_data_background(account_id, file_content, job_id)
            
            if success:
                logger.info(f"Background CSV processing completed successfully for account_id: {account_id}")
                # Mark job as completed in database
                _update_csv_job_final(job_id, 100, "CSV processing completed successfully")
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
        logger.info(f"DEBUG: Creating job record in database for job_id: {job_id}")
        db = get_db()
        db.execute(
            "INSERT INTO background_jobs (id, name, status, progress, total) VALUES (?, ?, ?, ?, ?)",
            (job_id, 'csv_upload', 'processing', 0, 100)
        )
        db.commit()
        logger.info(f"DEBUG: Job record created successfully in database for job_id: {job_id}")

        # Create and start the background thread
        logger.info(f"DEBUG: Creating background thread for job_id: {job_id}")
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
