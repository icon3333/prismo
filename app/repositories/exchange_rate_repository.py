"""
Repository for exchange rate data access.

Centralizes all exchange rate database queries.
Philosophy: Single source of truth for currency conversion rates.

Exchange rates are stored per currency pair (from_currency -> EUR) and
refreshed every 24 hours. Only the latest rate is kept (no historical tracking).
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from app.db_manager import query_db, execute_db, get_db
import logging
import threading

logger = logging.getLogger(__name__)

# In-memory cache for exchange rates (cleared daily)
# Thread-safe access via _cache_lock
_rates_cache: Dict[str, float] = {}
_cache_timestamp: Optional[datetime] = None
_cache_lock = threading.Lock()
CACHE_DURATION_HOURS = 24


class ExchangeRateRepository:
    """Data access layer for exchange rates"""

    @staticmethod
    def get_rate(from_currency: str, to_currency: str = 'EUR') -> Optional[float]:
        """
        Get the exchange rate for a currency pair.

        Args:
            from_currency: Source currency code (e.g., 'USD', 'GBP')
            to_currency: Target currency code (default: 'EUR')

        Returns:
            Exchange rate as float, or None if not found
        """
        if from_currency == to_currency:
            return 1.0

        # Check in-memory cache first
        cache_key = f"{from_currency}_{to_currency}"
        cached_rate = ExchangeRateRepository._get_cached_rate(cache_key)
        if cached_rate is not None:
            return cached_rate

        logger.debug(f"Fetching exchange rate from DB: {from_currency} -> {to_currency}")
        result = query_db(
            '''
            SELECT rate, last_updated
            FROM exchange_rates
            WHERE from_currency = ? AND to_currency = ?
            ''',
            [from_currency, to_currency],
            one=True
        )

        if result:
            rate = result['rate']
            # Update in-memory cache
            ExchangeRateRepository._set_cached_rate(cache_key, rate)
            logger.debug(f"Exchange rate {from_currency}->{to_currency}: {rate}")
            return rate

        return None

    @staticmethod
    def get_all_rates(to_currency: str = 'EUR') -> Dict[str, float]:
        """
        Get all exchange rates for a target currency.

        Args:
            to_currency: Target currency code (default: 'EUR')

        Returns:
            Dict mapping from_currency -> rate
        """
        logger.debug(f"Fetching all exchange rates to {to_currency}")
        results = query_db(
            '''
            SELECT from_currency, rate
            FROM exchange_rates
            WHERE to_currency = ?
            ''',
            [to_currency]
        )

        rates = {}
        if results:
            for row in results:
                rates[row['from_currency']] = row['rate']
                # Update in-memory cache
                cache_key = f"{row['from_currency']}_{to_currency}"
                ExchangeRateRepository._set_cached_rate(cache_key, row['rate'])

        # Always include EUR -> EUR = 1.0
        rates['EUR'] = 1.0

        logger.info(f"Loaded {len(rates)} exchange rates to {to_currency}")
        return rates

    @staticmethod
    def upsert_rate(
        from_currency: str,
        rate: float,
        to_currency: str = 'EUR',
        last_updated: Optional[datetime] = None
    ) -> None:
        """
        Insert or update an exchange rate.

        Args:
            from_currency: Source currency code
            rate: Exchange rate value
            to_currency: Target currency code (default: 'EUR')
            last_updated: Timestamp (defaults to now)
        """
        if last_updated is None:
            last_updated = datetime.now()

        logger.info(f"Upserting exchange rate: {from_currency}->{to_currency} = {rate}")

        execute_db(
            '''
            INSERT INTO exchange_rates (from_currency, to_currency, rate, last_updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(from_currency, to_currency) DO UPDATE SET
                rate = excluded.rate,
                last_updated = excluded.last_updated
            ''',
            [from_currency, to_currency, rate, last_updated]
        )

        # Update in-memory cache
        cache_key = f"{from_currency}_{to_currency}"
        ExchangeRateRepository._set_cached_rate(cache_key, rate)

    @staticmethod
    def upsert_rates_batch(rates: Dict[str, float], to_currency: str = 'EUR') -> int:
        """
        Insert or update multiple exchange rates in a single transaction.

        Args:
            rates: Dict mapping from_currency -> rate
            to_currency: Target currency code (default: 'EUR')

        Returns:
            Number of rates updated
        """
        if not rates:
            return 0

        logger.info(f"Batch upserting {len(rates)} exchange rates")

        db = get_db()
        cursor = db.cursor()
        count = 0
        now = datetime.now()

        try:
            for from_currency, rate in rates.items():
                if from_currency == to_currency:
                    continue  # Skip EUR -> EUR

                cursor.execute(
                    '''
                    INSERT INTO exchange_rates (from_currency, to_currency, rate, last_updated)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(from_currency, to_currency) DO UPDATE SET
                        rate = excluded.rate,
                        last_updated = excluded.last_updated
                    ''',
                    [from_currency, to_currency, rate, now]
                )
                count += 1

                # Update in-memory cache
                cache_key = f"{from_currency}_{to_currency}"
                ExchangeRateRepository._set_cached_rate(cache_key, rate)

            db.commit()
            logger.info(f"Successfully updated {count} exchange rates")
            return count

        except Exception as e:
            logger.error(f"Error in batch exchange rate update: {e}")
            db.rollback()
            raise

    @staticmethod
    def get_stale_currencies(hours: int = 24) -> List[str]:
        """
        Get list of currencies with stale exchange rates.

        Args:
            hours: Number of hours to consider "stale"

        Returns:
            List of currency codes that need updating
        """
        logger.debug(f"Checking for exchange rates older than {hours} hours")

        results = query_db(
            '''
            SELECT from_currency
            FROM exchange_rates
            WHERE to_currency = 'EUR'
            AND datetime(last_updated) < datetime('now', '-' || ? || ' hours')
            ''',
            [hours]
        )

        stale = [r['from_currency'] for r in results] if results else []
        if stale:
            logger.info(f"Found {len(stale)} stale exchange rates: {stale}")
        return stale

    @staticmethod
    def is_refresh_needed(hours: int = 24) -> bool:
        """
        Check if exchange rates need refreshing.

        Returns True if:
        - No rates exist in database
        - Any rate is older than specified hours

        Args:
            hours: Threshold for staleness

        Returns:
            True if refresh is needed
        """
        # Single query: check both existence and staleness
        result = query_db(
            '''
            SELECT
                COUNT(*) as total_count,
                SUM(CASE
                    WHEN datetime(last_updated) < datetime('now', '-' || ? || ' hours')
                    THEN 1 ELSE 0
                END) as stale_count
            FROM exchange_rates
            WHERE to_currency = 'EUR'
            ''',
            [hours],
            one=True
        )

        if not result or result['total_count'] == 0:
            logger.info("No exchange rates in database - refresh needed")
            return True

        if result['stale_count'] and result['stale_count'] > 0:
            logger.info(f"Found {result['stale_count']} stale exchange rates - refresh needed")
            return True

        return False

    @staticmethod
    def get_last_update_time() -> Optional[datetime]:
        """
        Get the timestamp of the most recent exchange rate update.

        Returns:
            Datetime of last update, or None if no rates exist
        """
        result = query_db(
            '''
            SELECT MAX(last_updated) as last_updated
            FROM exchange_rates
            WHERE to_currency = 'EUR'
            ''',
            one=True
        )

        if result and result['last_updated']:
            return result['last_updated']
        return None

    @staticmethod
    def delete_all_rates() -> int:
        """
        Delete all exchange rates (for testing/reset purposes).

        Returns:
            Number of records deleted
        """
        logger.warning("Deleting all exchange rates")

        db = get_db()
        cursor = db.cursor()

        cursor.execute('DELETE FROM exchange_rates')
        deleted = cursor.rowcount
        db.commit()

        # Clear in-memory cache
        ExchangeRateRepository._clear_cache()

        logger.info(f"Deleted {deleted} exchange rate records")
        return deleted

    # --- In-memory cache management (thread-safe) ---

    @staticmethod
    def _get_cached_rate(cache_key: str) -> Optional[float]:
        """Get rate from in-memory cache if still valid (thread-safe)."""
        global _rates_cache, _cache_timestamp

        with _cache_lock:
            if _cache_timestamp is None:
                return None

            # Check if cache is still valid (within 24 hours)
            if datetime.now() - _cache_timestamp > timedelta(hours=CACHE_DURATION_HOURS):
                # Clear cache while holding lock
                _rates_cache.clear()
                # Note: can't call _clear_cache here to avoid deadlock
                return None

            return _rates_cache.get(cache_key)

    @staticmethod
    def _set_cached_rate(cache_key: str, rate: float) -> None:
        """Set rate in in-memory cache (thread-safe)."""
        global _rates_cache, _cache_timestamp

        with _cache_lock:
            if _cache_timestamp is None:
                _cache_timestamp = datetime.now()

            _rates_cache[cache_key] = rate

    @staticmethod
    def _clear_cache() -> None:
        """Clear the in-memory cache (thread-safe)."""
        global _rates_cache, _cache_timestamp

        with _cache_lock:
            _rates_cache = {}
            _cache_timestamp = None
            logger.debug("Cleared exchange rate in-memory cache")

    @staticmethod
    def preload_cache() -> None:
        """
        Preload all exchange rates into in-memory cache.

        Call this at application startup for optimal performance.
        """
        logger.info("Preloading exchange rates into cache")
        ExchangeRateRepository.get_all_rates('EUR')
