"""
Repository for portfolio data access.

Centralizes all portfolio-related database queries.
Philosophy: Single source of truth for data access, optimized queries.
"""

from typing import List, Dict, Optional
from app.db_manager import query_db, execute_db, get_db
import logging

logger = logging.getLogger(__name__)


class PortfolioRepository:
    """Data access layer for portfolios"""

    @staticmethod
    def get_all_holdings(account_id: int) -> List[Dict]:
        """
        Get all holdings for an account with optimized single query.

        Replaces scattered queries with one efficient JOIN.

        Args:
            account_id: Account ID

        Returns:
            List of holdings with all related data
        """
        query = '''
            SELECT
                c.id,
                c.name,
                c.identifier,
                c.isin,
                c.category,
                c.country,
                p.id as portfolio_id,
                p.name as portfolio_name,
                cs.shares,
                cs.purchase_price,
                cs.purchase_date,
                mp.price_eur,
                mp.currency,
                mp.last_updated as price_updated
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            ORDER BY p.name, c.name
        '''

        return query_db(query, [account_id])

    @staticmethod
    def get_holding_by_id(company_id: int, account_id: int) -> Optional[Dict]:
        """
        Get single holding by ID.

        Args:
            company_id: Company ID
            account_id: Account ID (for security)

        Returns:
            Holding dict or None
        """
        query = '''
            SELECT
                c.*,
                p.name as portfolio_name,
                cs.shares,
                mp.price_eur
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.id = ? AND c.account_id = ?
        '''

        results = query_db(query, [company_id, account_id])
        return results[0] if results else None

    @staticmethod
    def create_holding(
        account_id: int,
        portfolio_id: int,
        name: str,
        identifier: str,
        isin: Optional[str] = None,
        category: Optional[str] = None,
        country: Optional[str] = None
    ) -> int:
        """
        Create new holding and return its ID.

        Args:
            account_id: Account ID
            portfolio_id: Portfolio ID
            name: Company name
            identifier: Ticker or ISIN
            isin: ISIN code (optional)
            category: Asset category (optional)
            country: Country code (optional)

        Returns:
            New company ID
        """
        execute_db(
            '''INSERT INTO companies
               (account_id, portfolio_id, name, identifier, isin, category, country)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            [account_id, portfolio_id, name, identifier, isin, category, country]
        )

        # Get inserted ID
        result = get_db().execute('SELECT last_insert_rowid()').fetchone()
        return result[0]

    @staticmethod
    def update_holding(
        company_id: int,
        account_id: int,
        **kwargs
    ) -> bool:
        """
        Update holding fields.

        Args:
            company_id: Company ID
            account_id: Account ID (for security)
            **kwargs: Fields to update

        Returns:
            True if successful
        """
        allowed_fields = ['name', 'identifier', 'isin', 'category', 'country']

        updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

        if not updates:
            return False

        set_clause = ', '.join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [company_id, account_id]

        execute_db(
            f'''UPDATE companies
                SET {set_clause}
                WHERE id = ? AND account_id = ?''',
            values
        )

        return True

    @staticmethod
    def delete_holding(company_id: int, account_id: int) -> bool:
        """
        Delete holding.

        Args:
            company_id: Company ID
            account_id: Account ID (for security)

        Returns:
            True if successful
        """
        execute_db(
            'DELETE FROM companies WHERE id = ? AND account_id = ?',
            [company_id, account_id]
        )

        return True

    @staticmethod
    def get_all_identifiers(account_id: int) -> List[str]:
        """
        Get all unique identifiers for an account.

        Args:
            account_id: Account ID

        Returns:
            List of identifiers
        """
        query = '''
            SELECT DISTINCT identifier
            FROM companies
            WHERE account_id = ?
            AND identifier IS NOT NULL
        '''

        results = query_db(query, [account_id])
        return [r['identifier'] for r in results]

    @staticmethod
    def get_holdings_by_portfolio(
        portfolio_id: int,
        account_id: int
    ) -> List[Dict]:
        """
        Get all holdings for a specific portfolio.

        Args:
            portfolio_id: Portfolio ID
            account_id: Account ID (for security)

        Returns:
            List of holdings
        """
        query = '''
            SELECT
                c.*,
                cs.shares,
                cs.purchase_price,
                mp.price_eur,
                mp.currency
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.portfolio_id = ? AND c.account_id = ?
            ORDER BY c.name
        '''

        return query_db(query, [portfolio_id, account_id])

    @staticmethod
    def get_portfolio_summary(account_id: int) -> List[Dict]:
        """
        Get portfolio summary with aggregated values.

        Args:
            account_id: Account ID

        Returns:
            List of portfolio summaries
        """
        query = '''
            SELECT
                p.id,
                p.name,
                COUNT(DISTINCT c.id) as num_holdings,
                COALESCE(SUM(cs.shares * mp.price_eur), 0) as total_value
            FROM portfolios p
            LEFT JOIN companies c ON p.id = c.portfolio_id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE p.account_id = ?
            GROUP BY p.id, p.name
            ORDER BY p.name
        '''

        return query_db(query, [account_id])

    @staticmethod
    def get_holdings_without_prices(account_id: int) -> List[Dict]:
        """
        Get holdings that don't have price data.

        Args:
            account_id: Account ID

        Returns:
            List of holdings missing prices
        """
        query = '''
            SELECT
                c.id,
                c.name,
                c.identifier
            FROM companies c
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            AND mp.price_eur IS NULL
            ORDER BY c.name
        '''

        return query_db(query, [account_id])

    @staticmethod
    def update_shares(
        company_id: int,
        account_id: int,
        shares: float,
        purchase_price: Optional[float] = None,
        purchase_date: Optional[str] = None
    ) -> bool:
        """
        Update or insert share information for a company.

        Args:
            company_id: Company ID
            account_id: Account ID (for security)
            shares: Number of shares
            purchase_price: Purchase price per share (optional)
            purchase_date: Purchase date (optional)

        Returns:
            True if successful
        """
        # Verify company belongs to account
        company = PortfolioRepository.get_holding_by_id(company_id, account_id)
        if not company:
            return False

        # Check if shares record exists
        existing = query_db(
            'SELECT id FROM company_shares WHERE company_id = ?',
            [company_id],
            one=True
        )

        if existing:
            # Update existing
            execute_db(
                '''UPDATE company_shares
                   SET shares = ?, purchase_price = ?, purchase_date = ?
                   WHERE company_id = ?''',
                [shares, purchase_price, purchase_date, company_id]
            )
        else:
            # Insert new
            execute_db(
                '''INSERT INTO company_shares
                   (company_id, shares, purchase_price, purchase_date)
                   VALUES (?, ?, ?, ?)''',
                [company_id, shares, purchase_price, purchase_date]
            )

        return True
