import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List
from flask import current_app
from app.db_manager import query_db, backup_database
from app.utils.batch_processing import start_batch_process

logger = logging.getLogger(__name__)

# Common currencies to fetch exchange rates for
COMMON_CURRENCIES = ['USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'HKD', 'SGD', 'NZD']

# start_background_tasks must be exactly-once per process: dev reloader,
# repeated create_app calls, and the gunicorn hook all funnel through here.
_background_tasks_started = False
_background_tasks_lock = threading.Lock()


# How often the refresh loop re-checks staleness. The refreshers themselves
# gate on their own intervals (24h FX, PRICE_UPDATE_INTERVAL), so a fine-
# grained check is cheap: two SELECTs per hour when everything is fresh.
REFRESH_CHECK_INTERVAL_SECONDS = 60 * 60


def run_refresh_cycle(app):
    """
    Run one staleness check + refresh pass for exchange rates and prices.
    Each task is isolated so one failure doesn't block the other. Called at
    startup and then periodically — without the loop, a long-running server
    (Docker restart: unless-stopped) would keep boot-time prices forever.
    """
    with app.app_context():
        try:
            refresh_exchange_rates_if_needed()
        except Exception as e:
            logger.error(f"Exchange rate refresh failed: {e}")

        try:
            result = auto_update_prices_if_needed()
            if result and result.get('status') == 'error':
                logger.error(f"Price update failed: {result.get('error')}")
            elif result:
                logger.info(f"Price update result: {result.get('status')}")
        except Exception as e:
            logger.error(f"Automatic price update failed: {e}")


def run_startup_tasks(app):
    """
    Run the first refresh cycle, start the backup scheduler, then keep
    re-checking price/FX staleness periodically for the process lifetime.
    """
    run_refresh_cycle(app)

    with app.app_context():
        try:
            schedule_automatic_backups()
        except Exception as e:
            logger.error(f"Automatic backup setup failed: {e}")

    # Periodic re-check (runs in the same daemon thread that called us).
    while True:
        time.sleep(REFRESH_CHECK_INTERVAL_SECONDS)
        run_refresh_cycle(app)


def start_background_tasks(app):
    """
    Start the startup tasks in a daemon thread, exactly once per process.

    Callers:
    - dev (python3 run.py): create_app in the reloader child process
    - production (gunicorn): the when_ready hook in deployment/gunicorn.conf.py,
      which runs in the master so the scheduler survives worker restarts;
      PRISMO_DEFER_STARTUP_TASKS=1 keeps create_app from also starting them.
    """
    global _background_tasks_started
    with _background_tasks_lock:
        if _background_tasks_started:
            logger.info("Background startup tasks already started - skipping")
            return
        _background_tasks_started = True

    def _worker():
        # Small delay so the server finishes initializing (and, under gunicorn,
        # forking workers) before this thread starts doing DB/network work.
        time.sleep(1)
        run_startup_tasks(app)

    thread = threading.Thread(target=_worker, daemon=True, name='prismo-startup-tasks')
    thread.start()
    logger.info("Startup tasks scheduled in background thread")


def refresh_exchange_rates_if_needed() -> bool:
    """
    Refresh exchange rates if they are stale (>24 hours old) or missing.

    This ensures all portfolio calculations use consistent daily exchange rates.
    Rates are fetched from yfinance and stored in the database.

    Returns:
        bool: True if rates were refreshed, False if they were already fresh
    """
    try:
        from app.repositories.exchange_rate_repository import ExchangeRateRepository

        # Check if refresh is needed
        if not ExchangeRateRepository.is_refresh_needed(hours=24):
            logger.info("✅ Exchange rates are fresh")
            return False

        logger.info("🔄 Refreshing exchange rates...")

        # Get currencies actually used in the portfolio
        used_currencies = _get_portfolio_currencies()

        # Merge with common currencies list
        currencies_to_fetch = list(set(COMMON_CURRENCIES + used_currencies))
        currencies_to_fetch = [c for c in currencies_to_fetch if c and c != 'EUR']

        if not currencies_to_fetch:
            logger.info("No currencies to fetch (all EUR)")
            return False

        # Fetch rates from yfinance
        rates = _fetch_exchange_rates(currencies_to_fetch)

        if not rates:
            logger.warning("❌ Could not fetch any exchange rates")
            return False

        # Store rates in database
        ExchangeRateRepository.upsert_rates_batch(rates, 'EUR')

        # Clear value calculator cache so subsequent calc loops re-read fresh rates.
        from app.utils.value_calculator import clear_exchange_rate_cache
        clear_exchange_rate_cache()

        logger.info(f"✅ Refreshed {len(rates)} exchange rates: {list(rates.keys())}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to refresh exchange rates: {e}", exc_info=True)
        return False


def _get_portfolio_currencies() -> List[str]:
    """
    Get list of currencies actually used in the portfolio.

    Returns:
        List of currency codes found in market_prices table
    """
    try:
        results = query_db(
            """
            SELECT DISTINCT mp.currency
            FROM market_prices mp
            INNER JOIN companies c ON c.identifier = mp.identifier
            WHERE mp.currency IS NOT NULL AND mp.currency != ''
            """
        )
        currencies = [r['currency'] for r in results] if results else []
        logger.debug(f"Found {len(currencies)} currencies in portfolio: {currencies}")
        return currencies
    except Exception as e:
        logger.warning(f"Could not get portfolio currencies: {e}")
        return []


def _fetch_exchange_rates(currencies: List[str]) -> Dict[str, float]:
    """
    Fetch exchange rates from yfinance for a list of currencies.

    Args:
        currencies: List of currency codes (e.g., ['USD', 'GBP'])

    Returns:
        Dict mapping currency -> EUR exchange rate
    """
    # Network-only fetch: get_exchange_rate() falls back to stale stored
    # rates, which this refresh would re-upsert with a fresh timestamp and
    # mask real staleness.
    from app.utils.yfinance_utils import fetch_exchange_rate_from_network

    rates = {}
    for currency in currencies:
        try:
            rate = fetch_exchange_rate_from_network(currency, 'EUR')
            if rate and rate > 0:
                rates[currency] = rate
                logger.info(f"  {currency}/EUR: {rate:.6f}")
            else:
                logger.warning(f"  {currency}/EUR: invalid rate {rate}")
        except Exception as e:
            logger.warning(f"  {currency}/EUR: fetch failed - {e}")

    return rates


def _needs_price_update(last_str, update_interval: timedelta) -> bool:
    """
    Decide whether prices are stale given the stored accounts.last_price_update.

    Handles both the current format (timezone-aware UTC ISO) and legacy rows
    (naive local isoformat or 'YYYY-MM-DD HH:MM:SS'). Naive timestamps are
    compared against naive local now. Unparseable values count as stale.
    """
    if not last_str:
        return True

    try:
        last_dt = datetime.fromisoformat(last_str)
    except ValueError:
        try:
            last_dt = datetime.strptime(last_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            logger.warning(f"Unparseable last_price_update {last_str!r} - treating as stale")
            return True

    if last_dt.tzinfo is not None:
        now = datetime.now(timezone.utc)
    else:
        now = datetime.now()

    return (now - last_dt) >= update_interval


def auto_update_prices_if_needed():
    """
    Trigger bulk price update if last update is older than configured interval.

    Returns:
        dict: Status information with keys:
            - status: 'started', 'skipped', 'error', or 'no_identifiers'
            - reason: Human-readable explanation
            - job_id: (if started) The batch job ID
            - error: (if error) The error message
    """
    try:
        logger.info("=" * 50)
        logger.info("STARTUP: Checking if price update is needed...")

        # Check last update time
        row = query_db("SELECT MAX(last_price_update) as last FROM accounts", one=True)
        last_str = row['last'] if row else None
        logger.info(f"STARTUP: Last price update from database: {last_str}")

        update_interval = current_app.config.get('PRICE_UPDATE_INTERVAL', timedelta(hours=24))
        if not _needs_price_update(last_str, update_interval):
            logger.info("STARTUP: Prices are fresh - no update needed")
            logger.info("=" * 50)
            return {'status': 'skipped', 'reason': 'prices_fresh'}

        # Get identifiers from companies table
        logger.info("STARTUP: Querying companies table for identifiers...")
        identifiers = query_db(
            """
            SELECT DISTINCT identifier FROM companies
            WHERE identifier IS NOT NULL AND identifier != ''
            """
        )
        identifiers = [row['identifier'] for row in identifiers]

        logger.info(f"STARTUP: Found {len(identifiers)} unique identifiers")
        if identifiers:
            logger.debug(f"First 10 identifiers: {identifiers[:10]}")

        if not identifiers:
            logger.warning("STARTUP: No identifiers found - companies table may be empty")
            logger.info("=" * 50)
            return {'status': 'no_identifiers', 'reason': 'companies_table_empty'}

        # Clear price cache before fetching fresh data
        logger.info("STARTUP: Clearing price cache before update...")
        try:
            from app.utils.yfinance_utils import clear_price_cache
            clear_price_cache()
            logger.info("STARTUP: Price cache cleared successfully")
        except Exception as e:
            logger.warning(f"STARTUP: Could not clear price cache: {e}")

        # Start the batch update
        logger.info(f"STARTUP: Starting batch process for {len(identifiers)} identifiers...")
        job_id = start_batch_process(identifiers)
        logger.info(f"STARTUP: Started price update job {job_id}")
        logger.info("=" * 50)
        return {'status': 'started', 'job_id': job_id, 'identifier_count': len(identifiers)}

    except Exception as exc:
        # Log at ERROR level with clear visibility
        logger.error("=" * 50)
        logger.error(f"STARTUP FAILED: Price update error: {exc}")
        logger.error("=" * 50, exc_info=True)
        # Return error status instead of silent failure
        return {'status': 'error', 'error': str(exc)}


def schedule_automatic_backups():
    """Schedule automatic database backups based on configuration interval."""
    # Capture app reference while context is active (for use in background thread)
    app = current_app._get_current_object()
    backup_interval_hours = current_app.config.get('BACKUP_INTERVAL_HOURS', 6)
    backup_interval_seconds = backup_interval_hours * 60 * 60

    def backup_worker():
        """Background worker for automatic database backups."""
        while True:
            try:
                # Wait for configured interval between backups
                time.sleep(backup_interval_seconds)

                # Perform backup (with app context for database access)
                with app.app_context():
                    backup_file = backup_database()
                    if backup_file:
                        logger.info(f"Automatic database backup completed: {backup_file}")
                    else:
                        logger.error("Automatic database backup failed")

            except Exception as e:
                logger.error(f"Error in automatic backup worker: {e}")
                # Continue running despite errors
                time.sleep(60)  # Wait 1 minute before retrying

    # OPTIMIZATION: Skip initial backup on startup to speed up application start
    # The backup thread will create the first backup after the configured interval
    # This saves 1-3 seconds on startup depending on database size
    logger.info(f"Automatic database backup scheduler started (every {backup_interval_hours} hours)")
    logger.info(f"First backup will be created in {backup_interval_hours} hours")

    # Start background backup thread
    backup_thread = threading.Thread(target=backup_worker, daemon=True)
    backup_thread.start()
