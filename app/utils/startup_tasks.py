import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List
from flask import current_app
from app.db_manager import query_db, backup_database
from app.utils.batch_processing import start_batch_process

logger = logging.getLogger(__name__)

# Common currencies to fetch exchange rates for
COMMON_CURRENCIES = ['USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'HKD', 'SGD', 'NZD']


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
            last_update = ExchangeRateRepository.get_last_update_time()
            logger.info(f"✅ Exchange rates are fresh (last updated: {last_update})")
            # Preload into cache for fast access
            ExchangeRateRepository.preload_cache()
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

        # Clear value calculator cache to use new rates
        from app.utils.value_calculator import clear_exchange_rate_cache
        clear_exchange_rate_cache()

        # Preload into cache for fast access
        ExchangeRateRepository.preload_cache()

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
    from app.utils.yfinance_utils import get_exchange_rate

    rates = {}
    for currency in currencies:
        try:
            rate = get_exchange_rate(currency, 'EUR')
            if rate and rate > 0:
                rates[currency] = rate
                logger.info(f"  {currency}/EUR: {rate:.6f}")
            else:
                logger.warning(f"  {currency}/EUR: invalid rate {rate}")
        except Exception as e:
            logger.warning(f"  {currency}/EUR: fetch failed - {e}")

    return rates


def auto_update_prices_if_needed():
    """Trigger bulk price update if last update is older than configured interval."""
    try:
        logger.info("🚀 Starting automatic price update check...")
        
        # Check last update time
        row = query_db("SELECT MAX(last_price_update) as last FROM accounts", one=True)
        last_str = row['last'] if row else None
        logger.debug(f"📅 Last price update from database: {last_str}")
        
        needs_update = True
        if last_str:
            try:
                last_dt = datetime.fromisoformat(last_str)
            except ValueError:
                last_dt = datetime.strptime(last_str, "%Y-%m-%d %H:%M:%S")
            
            time_since_update = datetime.now() - last_dt
            update_interval = current_app.config.get('PRICE_UPDATE_INTERVAL', timedelta(hours=24))
            logger.debug(f"Time since last update: {time_since_update}")
            logger.debug(f"Required update interval: {update_interval}")
            
            if time_since_update < update_interval:
                needs_update = False
                
        logger.info(f"Price update needed: {needs_update}")
        
        if not needs_update:
            logger.info("✅ Price data is recent; skipping automatic update.")
            return

        # Get identifiers from companies table
        logger.debug("🔍 Querying companies table for identifiers...")
        identifiers = query_db(
            """
            SELECT DISTINCT identifier FROM companies
            WHERE identifier IS NOT NULL AND identifier != ''
            """
        )
        identifiers = [row['identifier'] for row in identifiers]
        
        logger.info(f"Found {len(identifiers)} unique identifiers in companies table")
        if identifiers:
            logger.debug(f"First 10 identifiers: {identifiers[:10]}")
            if len(identifiers) > 10:
                logger.debug(f"... and {len(identifiers) - 10} more")
        
        if not identifiers:
            logger.warning("No identifiers found for automatic price update - companies table may be empty")
            return

        logger.info(f"Starting batch process for {len(identifiers)} identifiers...")
        job_id = start_batch_process(identifiers)
        logger.info(f"Started automatic price update job {job_id} for {len(identifiers)} identifiers")
    except Exception as exc:
        logger.error(f"Failed to run automatic price update: {exc}", exc_info=True)


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
