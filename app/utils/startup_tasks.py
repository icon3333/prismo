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

# start_background_tasks must be exactly-once per process: the dev reloader
# and any repeated create_app calls all funnel through here.
_background_tasks_started = False
_background_tasks_lock = threading.Lock()


# How often the maintenance loop wakes up. The refreshers gate on their own
# intervals (24h FX, PRICE_UPDATE_INTERVAL), so a fine-grained tick is cheap:
# two SELECTs per hour when everything is fresh.
MAINTENANCE_TICK_SECONDS = 60 * 60


def run_refresh_cycle(app):
    """
    Run one staleness check + refresh pass for exchange rates and prices.
    Each task is isolated so one failure doesn't block the other. Called at
    startup and then periodically — without the loop, a long-running server
    process would keep boot-time prices forever.
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


def run_backup(app):
    """Take one scheduled database backup. Never raises."""
    try:
        with app.app_context():
            backup_file = backup_database()
        if backup_file:
            logger.info(f"Automatic database backup completed: {backup_file}")
        else:
            logger.error("Automatic database backup failed")
    except Exception as e:
        logger.error(f"Automatic database backup failed: {e}")


def run_startup_tasks(app):
    """
    Boot-time pass, then one maintenance loop for the process lifetime.

    Staleness refresh and database backup share a single thread. Both are
    periodic and neither is time-critical to the minute, so a second thread
    bought nothing but a second thing to reason about.

    Elapsed time is measured with the monotonic clock, not the wall clock, so
    a DST shift or an NTP correction can't skip or double-fire a backup.
    """
    with app.app_context():
        try:
            from app.utils.batch_processing import interrupt_stale_csv_jobs
            interrupted = interrupt_stale_csv_jobs()
            if interrupted:
                logger.warning(
                    f"Marked {interrupted} interrupted CSV import(s) as failed"
                )
        except Exception as e:
            logger.error(f"Interrupted CSV job cleanup failed: {e}")

        backup_interval = current_app.config.get('BACKUP_INTERVAL_HOURS', 6) * 3600

    run_refresh_cycle(app)

    # No boot-time backup — it costs 1-3s of startup for a snapshot that is
    # near-identical to the one the previous run already took. The first
    # backup lands one interval in.
    tick = min(MAINTENANCE_TICK_SECONDS, backup_interval)
    last_backup = time.monotonic()
    logger.info(
        f"Maintenance loop started: tick {tick / 60:g}min, "
        f"backup every {backup_interval / 3600:g}h"
    )

    while True:
        time.sleep(tick)
        try:
            run_refresh_cycle(app)

            if time.monotonic() - last_backup >= backup_interval:
                last_backup = time.monotonic()
                run_backup(app)
        except Exception as e:
            # The loop outlives any single failed cycle.
            logger.error(f"Maintenance cycle failed: {e}", exc_info=True)


def start_background_tasks(app):
    """
    Start the startup tasks in a daemon thread, exactly once per process.

    Called from create_app (app/main.py) once the main process is identified
    (the dev reloader child, or a non-reloader run of run.py).
    """
    global _background_tasks_started
    with _background_tasks_lock:
        if _background_tasks_started:
            logger.info("Background startup tasks already started - skipping")
            return
        _background_tasks_started = True

    def _worker():
        # Small delay so the server finishes initializing before this thread
        # starts doing DB/network work.
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
    from app.utils.yfinance_utils import (
        fetch_exchange_rate_from_network,
        fetch_exchange_rates_from_network_bulk,
    )

    # Fast path: fetch every currency→EUR rate in ONE yf.download call instead
    # of one blocking round-trip per currency. Same rate math, same network-only
    # semantics. On error, treat as zero bulk results.
    try:
        rates = dict(fetch_exchange_rates_from_network_bulk(currencies, 'EUR'))
    except Exception as e:
        logger.warning(f"Bulk exchange rate fetch failed, falling back to serial: {e}")
        rates = {}

    for currency, rate in rates.items():
        logger.info(f"  {currency}/EUR: {rate:.6f}")

    # Serial fallback for ONLY the currencies the bulk call did not resolve.
    # fetch_exchange_rate_from_network() uses yf.Ticker().history(), a different
    # code path that can succeed when yf.download() soft-fails (returns NaN) for
    # an individual ticker. When bulk covers everything (the common case) this
    # loop makes zero network calls, preserving the full speedup; a total bulk
    # failure degrades to the original per-currency behavior.
    missing = [c for c in currencies if c not in rates]
    if missing:
        logger.info(
            f"Bulk fetch missed {len(missing)} currencies - serial fallback: {missing}")
    for currency in missing:
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
