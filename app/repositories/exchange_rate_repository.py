"""
Repository for exchange rate data access.

Centralizes all exchange rate database queries.
Philosophy: Single source of truth for currency conversion rates.

Exchange rates are stored per currency pair (from_currency -> EUR) and
refreshed every 24 hours. Only the latest rate is kept (no historical tracking).
"""

from typing import Optional, Dict, List
from datetime import datetime, timezone
from app.db_manager import query_db, execute_db, get_db
import logging

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    """
    Naive UTC timestamp for last_updated.

    Freshness predicates (get_fresh_rate, get_stale_currencies,
    is_refresh_needed) compare against SQLite's datetime('now'), which is UTC,
    so stored timestamps must be UTC too — a naive local datetime.now() would
    skew freshness by the host's UTC offset.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

# Note: this repository used to hold its own in-memory cache (with a thread
# lock) on top of value_calculator's `_exchange_rates_cache`. Two caches for
# ~10 rows of data was redundant and the lock cost was paid per call in the
# value-calc inner loop. value_calculator is now the sole reader-side cache;
# this repository is a thin DB shim. yfinance_utils.get_exchange_rate is
# DB-first: it reads fresh rates from here and only hits the network (and
# persists back via upsert_rate) when the stored rate is stale or missing.


class ExchangeRateRepository:
    """Data access layer for exchange rates"""

    @staticmethod
    def get_rate(from_currency: str, to_currency: str = 'EUR') -> Optional[float]:
        """Get the exchange rate for a currency pair, or None if not found."""
        if from_currency == to_currency:
            return 1.0

        result = query_db(
            '''
            SELECT rate
            FROM exchange_rates
            WHERE from_currency = ? AND to_currency = ?
            ''',
            [from_currency, to_currency],
            one=True
        )
        return result['rate'] if result else None

    @staticmethod
    def get_fresh_rate(
        from_currency: str,
        to_currency: str = 'EUR',
        max_age_hours: int = 24
    ) -> Optional[float]:
        """
        Get the stored rate only if it was updated within max_age_hours.

        Returns None when the rate is missing or stale, signalling that the
        caller should refresh from the network (see yfinance_utils.get_exchange_rate).
        """
        if from_currency == to_currency:
            return 1.0

        result = query_db(
            '''
            SELECT rate
            FROM exchange_rates
            WHERE from_currency = ? AND to_currency = ?
            AND datetime(last_updated) >= datetime('now', '-' || ? || ' hours')
            ''',
            [from_currency, to_currency, max_age_hours],
            one=True
        )
        return result['rate'] if result else None

    @staticmethod
    def get_all_rates(to_currency: str = 'EUR') -> Dict[str, float]:
        """Return {from_currency: rate} for all stored rates targeting to_currency."""
        results = query_db(
            'SELECT from_currency, rate FROM exchange_rates WHERE to_currency = ?',
            [to_currency]
        )

        rates: Dict[str, float] = {row['from_currency']: row['rate'] for row in (results or [])}
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
            last_updated = _utc_now()

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
        now = _utc_now()

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

        # Invalidate the value_calculator-side cache so calc loops re-read.
        try:
            from app.utils.value_calculator import clear_exchange_rate_cache
            clear_exchange_rate_cache()
        except Exception:
            pass

        logger.info(f"Deleted {deleted} exchange rate records")
        return deleted
