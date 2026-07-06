"""
CSV import orchestration.

Thin coordinator around the modular pipeline in app/utils/csv_processing/
(parser → company_processor → share_calculator → transaction_manager →
price_updater), plus database-backed progress tracking for background jobs.
"""

import logging
import threading
import time

from app.db_manager import backup_database, get_db
from app.exceptions import CSVProcessingError

logger = logging.getLogger(__name__)

# Thread-local storage for database connections
_thread_local_db = threading.local()


def get_thread_db():
    """Get or create database connection for current thread."""
    if not hasattr(_thread_local_db, 'connection'):
        from app.db_manager import get_background_db
        # journal_mode/busy_timeout already set by _configure_connection in get_background_db
        _thread_local_db.connection = get_background_db()
    return _thread_local_db.connection


def close_thread_db():
    """Close thread-local database connection."""
    if hasattr(_thread_local_db, 'connection'):
        try:
            _thread_local_db.connection.close()
        except Exception as e:
            logger.warning(f"Error closing thread-local DB connection: {e}")
        finally:
            del _thread_local_db.connection


# Progress update throttling
_last_progress_update = {}  # job_id -> timestamp
_progress_update_lock = threading.Lock()


def process_csv_data(account_id: int, file_content: str, progress_callback=None, mode: str = 'replace'):
    """
    Process and import CSV data using the modular csv_processing pipeline.

    Args:
        account_id: Account ID for this import
        file_content: Raw CSV file content
        progress_callback: Optional callback(current, total, message, status)
        mode: Import mode - 'add' (no deletions), 'replace' (delete missing positions),
              or 'replace_all' (full wipe - delete ALL positions before importing)

    Returns:
        Tuple[bool, str, dict]: (success, message, details)
    """
    from app.utils.csv_processing import (
        parse_csv_file,
        detect_csv_format,
        parse_ibkr_csv,
        process_companies,
        process_companies_snapshot,
        assign_portfolios,
        calculate_share_changes,
        calculate_share_changes_snapshot,
        apply_share_changes,
        update_prices_from_csv
    )
    from app.utils.csv_processing.portfolio_handler import get_existing_overrides, get_user_edit_data
    from app.utils.csv_processing.share_calculator import identify_companies_to_remove
    from app.utils.data_processing import clear_data_caches

    db = None
    cursor = None

    try:
        logger.info(f"Starting CSV processing for account_id: {account_id}")

        # Step 1: Detect format and parse CSV file
        logger.info("Step 1: Detecting format and parsing CSV file...")
        if progress_callback:
            progress_callback(0, 100, "Detecting CSV format...", "processing")

        csv_format = detect_csv_format(file_content)
        logger.info(f"Detected CSV format: {csv_format}")

        if csv_format == 'ibkr':
            df = parse_ibkr_csv(file_content)
            source = 'ibkr'
        else:
            df = parse_csv_file(file_content)
            source = 'parqet'

        # Replace modes delete positions missing from the CSV, so take a
        # safety snapshot first (after parsing, so invalid files don't
        # produce backups). No snapshot, no destructive import.
        if mode != 'add':
            if progress_callback:
                progress_callback(5, 100, "Creating pre-import backup...", "processing")
            backup_file = backup_database(prefix='pre_import')
            if not backup_file:
                raise CSVProcessingError(
                    "Pre-import backup failed - aborting import to protect existing positions"
                )
            logger.info(f"Pre-import safety backup created: {backup_file}")

        # Step 2: Get database connection
        db = get_db()
        cursor = db.cursor()

        # Step 3: Process companies and calculate positions
        logger.info(f"Step 2: Processing company records ({csv_format} mode)...")
        if progress_callback:
            progress_callback(10, 100, f"Processing {csv_format.upper()} records...", "processing")

        if csv_format == 'ibkr':
            existing_company_map, company_positions = process_companies_snapshot(df, account_id, cursor)
        else:
            existing_company_map, company_positions = process_companies(df, account_id, cursor)

        # Step 4: Get/create portfolios
        logger.info("Step 3: Setting up portfolios...")
        if progress_callback:
            progress_callback(20, 100, "Setting up portfolios...", "processing")

        default_portfolio_id = assign_portfolios(account_id, cursor)
        override_map = get_existing_overrides(account_id)
        user_edit_map, identifier_edit_map = get_user_edit_data(account_id)

        # Step 5: Calculate share changes
        logger.info("Step 4: Calculating share changes...")
        if progress_callback:
            progress_callback(30, 100, "Calculating share changes...", "processing")

        if csv_format == 'ibkr':
            share_calculations = calculate_share_changes_snapshot(
                company_positions, user_edit_map, identifier_edit_map
            )
        else:
            share_calculations = calculate_share_changes(
                df, company_positions, user_edit_map, identifier_edit_map
            )

        # Step 6: Identify companies to remove (skip in add mode)
        if mode == 'add':
            companies_to_remove = set()
            logger.info("Add mode: skipping company removal")
        elif mode == 'replace_all':
            # Full wipe: mark ALL existing companies for removal
            companies_to_remove = set(existing_company_map.keys())
            logger.info(f"Replace All mode: marking all {len(companies_to_remove)} existing companies for removal")
        else:
            csv_company_names = set(df['holdingname'])
            db_company_names = {company['name'] for company in existing_company_map.values()}
            companies_to_remove = identify_companies_to_remove(
                csv_company_names, db_company_names, company_positions
            )

        # Step 7: Apply changes in transaction
        logger.info("Step 5: Applying database changes...")
        if progress_callback:
            progress_callback(40, 100, "Applying database changes...", "processing")

        results = apply_share_changes(
            account_id=account_id,
            company_positions=company_positions,
            share_calculations=share_calculations,
            existing_company_map=existing_company_map,
            override_map=override_map,
            default_portfolio_id=default_portfolio_id,
            companies_to_remove=companies_to_remove,
            cursor=cursor,
            progress_callback=progress_callback,
            source=source,
            force_remove_all=(mode == 'replace_all')
        )

        # Seed market prices from IBKR data for immediate display
        if csv_format == 'ibkr':
            _seed_ibkr_prices(company_positions, cursor)

        # Commit changes
        db.commit()
        clear_data_caches()

        logger.info(
            f"Database commit completed - added: {len(results['added'])}, "
            f"updated: {len(results['updated'])}, removed: {len(results['removed'])}"
        )

        # Step 8: Update prices
        logger.info("Step 6: Updating prices from external APIs...")
        if progress_callback:
            progress_callback(80, 100, "Starting price updates...", "processing")

        positions_for_price_update = results['added'] + results['updated']
        failed_prices = update_prices_from_csv(
            account_id, positions_for_price_update, progress_callback
        )

        # Final completion
        if progress_callback:
            progress_callback(100, 100, "CSV import completed successfully!", "completed")

        # Build result message
        format_label = csv_format.upper()
        message = f"{format_label} data imported successfully"
        if results['removed']:
            removed_details = ', '.join(results['removed'])
            if len(removed_details) > 100:
                removed_details = removed_details[:97] + '...'
            message += (
                f". <strong>Removed {len(results['removed'])} companies</strong> "
                f"that had zero shares or were not in the CSV: {removed_details}"
            )

        return True, message, {
            'added': results['added'],
            'updated': results['updated'],
            'removed': results['removed'],
            'failed_prices': failed_prices,
            'format': csv_format,
        }

    except ValueError as e:
        # Validation errors from parsing
        logger.error(f"Validation error in CSV: {str(e)}")
        if progress_callback:
            progress_callback(0, 1, f"Validation error: {str(e)}", "failed")
        if db:
            db.rollback()
        return False, str(e), {}

    except Exception as e:
        logger.error(f"Error processing CSV: {str(e)}", exc_info=True)
        if progress_callback:
            progress_callback(0, 1, f"Error: {str(e)}", "failed")
        if db:
            db.rollback()
        return False, str(e), {}

    finally:
        if cursor:
            cursor.close()


def _seed_ibkr_prices(company_positions, cursor):
    """
    Seed market_prices table with IBKR markPrice data for immediate display.

    This provides price data before yfinance refresh, so positions show values
    immediately after import. yfinance will overwrite with fresher data on next update.
    """
    seeded = 0
    for company_name, position in company_positions.items():
        identifier = position.get('identifier')
        price = position.get('price')
        currency = position.get('currency', 'USD')

        if not identifier or not price or price <= 0:
            continue

        # Only seed if no existing price (don't overwrite fresher data)
        cursor.execute('SELECT identifier FROM market_prices WHERE identifier = ?', [identifier])
        if cursor.fetchone():
            continue

        cursor.execute(
            '''INSERT OR IGNORE INTO market_prices (identifier, price, currency, last_updated)
               VALUES (?, ?, ?, datetime('now'))''',
            [identifier, price, currency]
        )
        seeded += 1

    if seeded > 0:
        logger.info(f"Seeded {seeded} market prices from IBKR data")


def update_csv_progress_background(job_id: str, current: int, total: int, message: str = "Processing...", status: str = "processing"):
    """Update CSV upload progress with throttling - max 1 per second per job."""

    # Always update immediately for terminal states
    if status in ['completed', 'failed', 'cancelled']:
        _do_progress_update(job_id, current, total, message, status)
        return

    # Throttle in-progress updates to 1 per second
    current_time = time.time()
    with _progress_update_lock:
        last_update = _last_progress_update.get(job_id, 0)

        # Skip if updated within last 1 second
        if current_time - last_update < 1.0:
            logger.debug(f"Throttling progress update for job {job_id} (too soon)")
            return

        _last_progress_update[job_id] = current_time

    _do_progress_update(job_id, current, total, message, status)


def _do_progress_update(job_id: str, current: int, total: int, message: str, status: str):
    """Perform actual database progress update."""
    percentage = int((current / total) * 100) if total > 0 else 0

    try:
        from datetime import datetime

        # Use thread-local connection (reused)
        db = get_thread_db()

        rows_affected = db.execute(
            "UPDATE background_jobs SET progress = ?, result = ?, updated_at = ? WHERE id = ?",
            (percentage, message, datetime.now(), job_id)
        ).rowcount

        db.commit()

        logger.info(f"CSV Progress: {percentage}% - {message} (Status: {status})")

        if rows_affected == 0:
            logger.warning(f"No rows updated for job_id {job_id}!")

    except Exception as e:
        logger.warning(f"Failed to update progress for job {job_id}: {e}", exc_info=True)


def process_csv_data_background(account_id: int, file_content: str, job_id: str, mode: str = 'replace'):
    """
    Process CSV data in background thread using database-based progress tracking.
    This version doesn't use Flask session which isn't available in background threads.

    Args:
        account_id: Account ID for this import
        file_content: Raw CSV file content
        job_id: Background job ID for progress tracking
        mode: Import mode - 'add' (no deletions) or 'replace' (delete missing positions)

    Returns:
        Tuple[bool, str, dict]: (success, message, details)
    """
    logger.debug(f" process_csv_data_background starting - account_id: {account_id}, job_id: {job_id}")
    logger.debug(f" File content length: {len(file_content)} characters")

    # Create a progress function that updates the database
    def background_progress_wrapper(current, total, message="Processing...", status="processing"):
        logger.debug(f" Background wrapper called with current={current}, total={total}, message='{message}', status='{status}'")

        # First update the progress - this ensures users see progress even if job gets cancelled
        update_csv_progress_background(job_id, current, total, message, status)

        # THEN check if job was cancelled (after progress is recorded)
        from app.utils.batch_processing import get_job_status
        job_status = get_job_status(job_id)
        if job_status.get('status') == 'cancelled':
            logger.debug(f" Job {job_id} was cancelled, stopping processing")
            raise KeyboardInterrupt("Upload cancelled by user")

    try:
        return process_csv_data(account_id, file_content, background_progress_wrapper, mode=mode)

    except KeyboardInterrupt as e:
        logger.info(f"CSV processing cancelled for job {job_id}: {str(e)}")
        # For cancelled jobs, update the final status to show it was cancelled
        update_csv_progress_background(job_id, 0, 1, f"Cancelled: {str(e)}", "cancelled")
        return False, f"Processing cancelled: {str(e)}", {}
    except Exception as e:
        logger.error(f"Error processing CSV in background: {str(e)}", exc_info=True)
        update_csv_progress_background(job_id, 0, 1, f"Error: {str(e)}", "failed")
        return False, str(e), {}
    finally:
        # Clean up thread-local database connection
        close_thread_db()
