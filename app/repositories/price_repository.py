"""
Repository for price data access.

Centralizes all price-related database queries.
Philosophy: Single source of truth for price data, optimized for caching layer.
"""

from typing import Optional, Dict, Any, List
from decimal import Decimal
from datetime import datetime
from app.db_manager import query_db, execute_db, get_db
import logging

logger = logging.getLogger(__name__)


class PriceRepository:
    """Data access layer for market prices"""

    @staticmethod
    def get_latest_price(identifier: str) -> Optional[Dict[str, Any]]:
        """
        Get the most recent price for a given identifier (ISIN/ticker).

        Args:
            identifier: ISIN or ticker symbol

        Returns:
            Price dict with price_eur, currency, last_updated or None
        """
        logger.debug(f"Fetching latest price for identifier: {identifier}")
        return query_db(
            '''
            SELECT
                identifier,
                price_eur,
                currency,
                last_updated
            FROM market_prices
            WHERE identifier = ?
            ORDER BY last_updated DESC
            LIMIT 1
            ''',
            [identifier],
            one=True
        )

    @staticmethod
    def get_latest_price_by_isin(isin: str) -> Optional[Dict[str, Any]]:
        """
        Get the most recent price for a given ISIN.

        Alias for get_latest_price for clarity in code.

        Args:
            isin: ISIN code

        Returns:
            Price dict or None
        """
        return PriceRepository.get_latest_price(isin)

    @staticmethod
    def get_prices_batch(identifiers: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Get latest prices for multiple identifiers in a single query.

        More efficient than multiple get_latest_price calls.

        Args:
            identifiers: List of ISINs/ticker symbols

        Returns:
            Dict mapping identifier -> price data
        """
        if not identifiers:
            return {}

        logger.debug(f"Fetching batch prices for {len(identifiers)} identifiers")

        # Build placeholders for SQL IN clause
        placeholders = ','.join('?' * len(identifiers))

        query = f'''
            SELECT
                mp.identifier,
                mp.price_eur,
                mp.currency,
                mp.last_updated
            FROM market_prices mp
            INNER JOIN (
                SELECT identifier, MAX(last_updated) as max_updated
                FROM market_prices
                WHERE identifier IN ({placeholders})
                GROUP BY identifier
            ) latest ON mp.identifier = latest.identifier
                     AND mp.last_updated = latest.max_updated
        '''

        results = query_db(query, identifiers)

        if not results:
            return {}

        # Convert to dict for easy lookup
        return {row['identifier']: row for row in results}

    @staticmethod
    def update_price(
        identifier: str,
        price_eur: Decimal,
        currency: str,
        last_updated: Optional[datetime] = None
    ) -> None:
        """
        Insert or update a price record.

        Uses INSERT OR REPLACE to handle duplicates.

        Args:
            identifier: ISIN or ticker symbol
            price_eur: Price in EUR
            currency: Currency code (e.g., 'EUR', 'USD')
            last_updated: Timestamp (defaults to now)
        """
        if last_updated is None:
            last_updated = datetime.now()

        logger.debug(f"Updating price for {identifier}: {price_eur} {currency}")

        execute_db(
            '''
            INSERT OR REPLACE INTO market_prices
            (identifier, price_eur, currency, last_updated)
            VALUES (?, ?, ?, ?)
            ''',
            [identifier, float(price_eur), currency, last_updated]
        )

    @staticmethod
    def update_prices_batch(price_data: List[Dict[str, Any]]) -> int:
        """
        Update multiple prices in a single transaction.

        More efficient than multiple update_price calls.

        Args:
            price_data: List of dicts with keys: identifier, price_eur, currency, last_updated

        Returns:
            Number of prices updated

        Example:
            price_data = [
                {'identifier': 'US0378331005', 'price_eur': 150.0, 'currency': 'USD'},
                {'identifier': 'IE00B4L5Y983', 'price_eur': 80.0, 'currency': 'EUR'},
            ]
            count = PriceRepository.update_prices_batch(price_data)
        """
        if not price_data:
            return 0

        logger.info(f"Batch updating {len(price_data)} prices")

        db = get_db()
        cursor = db.cursor()
        count = 0

        try:
            for data in price_data:
                identifier = data['identifier']
                price_eur = float(data['price_eur'])
                currency = data.get('currency', 'EUR')
                last_updated = data.get('last_updated', datetime.now())

                cursor.execute(
                    '''
                    INSERT OR REPLACE INTO market_prices
                    (identifier, price_eur, currency, last_updated)
                    VALUES (?, ?, ?, ?)
                    ''',
                    [identifier, price_eur, currency, last_updated]
                )
                count += 1

            db.commit()
            logger.info(f"Successfully updated {count} prices")
            return count

        except Exception as e:
            logger.error(f"Error in batch price update: {e}")
            db.rollback()
            raise

    @staticmethod
    def get_stale_prices(hours: int = 24) -> List[Dict[str, Any]]:
        """
        Get prices that haven't been updated in the specified hours.

        Useful for identifying prices that need refreshing.

        Args:
            hours: Number of hours to consider "stale"

        Returns:
            List of identifier dicts that need updating
        """
        logger.debug(f"Fetching prices older than {hours} hours")

        return query_db(
            '''
            SELECT DISTINCT
                mp.identifier,
                mp.last_updated
            FROM market_prices mp
            INNER JOIN (
                SELECT identifier, MAX(last_updated) as max_updated
                FROM market_prices
                GROUP BY identifier
            ) latest ON mp.identifier = latest.identifier
                     AND mp.last_updated = latest.max_updated
            WHERE datetime(mp.last_updated) < datetime('now', '-' || ? || ' hours')
            ''',
            [hours]
        ) or []

    @staticmethod
    def get_price_count() -> int:
        """
        Get total number of price records.

        Returns:
            Total count of price records
        """
        result = query_db(
            'SELECT COUNT(*) as count FROM market_prices',
            one=True
        )
        return result['count'] if result else 0

    @staticmethod
    def get_unique_identifiers_count() -> int:
        """
        Get count of unique identifiers with prices.

        Returns:
            Number of unique identifiers
        """
        result = query_db(
            'SELECT COUNT(DISTINCT identifier) as count FROM market_prices',
            one=True
        )
        return result['count'] if result else 0

    @staticmethod
    def get_all_identifiers() -> List[str]:
        """
        Get list of all unique identifiers with price data.

        Returns:
            List of identifier strings
        """
        results = query_db(
            'SELECT DISTINCT identifier FROM market_prices ORDER BY identifier'
        )
        return [r['identifier'] for r in results] if results else []

    @staticmethod
    def price_exists(identifier: str) -> bool:
        """
        Check if a price exists for the given identifier.

        Args:
            identifier: ISIN or ticker symbol

        Returns:
            True if price exists, False otherwise
        """
        result = query_db(
            'SELECT 1 FROM market_prices WHERE identifier = ? LIMIT 1',
            [identifier],
            one=True
        )
        return result is not None
