"""
Repository for portfolio data access.

Centralizes all portfolio-related database queries.
Philosophy: Single source of truth for data access, optimized queries.
"""

from typing import List, Dict, Optional
from app.db_manager import query_db, execute_db, get_db
from app.cache import cache
import logging

# Cache timeout for portfolio summary (5 minutes)
CACHE_TIMEOUT_PORTFOLIO_SUMMARY = 300

logger = logging.getLogger(__name__)


class PortfolioRepository:
    """Data access layer for portfolios"""

    @staticmethod
    def company_exists(company_id: int, account_id: int) -> bool:
        """
        Lightweight check if company exists and belongs to account.

        More efficient than get_holding_by_id() when you only need
        to verify existence/ownership without fetching all data.

        Args:
            company_id: Company ID
            account_id: Account ID (for security)

        Returns:
            True if company exists and belongs to account
        """
        result = query_db(
            'SELECT 1 FROM companies WHERE id = ? AND account_id = ? LIMIT 1',
            [company_id, account_id],
            one=True
        )
        return result is not None

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
    @cache.memoize(timeout=CACHE_TIMEOUT_PORTFOLIO_SUMMARY)
    def get_portfolio_summary(account_id: int) -> List[Dict]:
        """
        Get portfolio summary with aggregated values.

        Cached for 5 minutes to reduce database load on frequently accessed data.

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
                COALESCE(SUM(cs.shares * mp.price_eur), 0) as total_value,
                COUNT(DISTINCT CASE WHEN c.id IS NOT NULL AND mp.price_eur IS NULL THEN c.id END) as num_missing_prices
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
    def get_portfolios_list(account_id: int) -> List[Dict]:
        """
        Get list of all portfolios for an account.

        Args:
            account_id: Account ID

        Returns:
            List of portfolio dicts with id and name
        """
        logger.debug(f"Fetching portfolios list for account {account_id}")

        query = '''
            SELECT
                id,
                name
            FROM portfolios
            WHERE account_id = ?
            ORDER BY name
        '''

        results = query_db(query, [account_id])
        return results if results else []

    @staticmethod
    def get_or_create_portfolio(account_id: int, portfolio_name: str) -> int:
        """
        Get portfolio ID by name, create if doesn't exist.

        Args:
            account_id: Account ID
            portfolio_name: Portfolio name

        Returns:
            Portfolio ID

        Raises:
            DatabaseError: If portfolio creation fails
        """
        from app.exceptions import DatabaseError
        from app.utils.text_normalization import normalize_portfolio

        # Normalize portfolio name to lowercase
        portfolio_name = normalize_portfolio(portfolio_name) or portfolio_name

        # Try to get existing
        existing = query_db(
            'SELECT id FROM portfolios WHERE account_id = ? AND name = ?',
            [account_id, portfolio_name],
            one=True
        )

        if existing:
            return existing['id']

        # Create new
        logger.info(f"Creating new portfolio '{portfolio_name}' for account {account_id}")

        try:
            from app.db_manager import get_db
            db = get_db()
            cursor = db.execute(
                'INSERT INTO portfolios (account_id, name) VALUES (?, ?)',
                [account_id, portfolio_name]
            )
            portfolio_id = cursor.lastrowid
            db.commit()

            if portfolio_id:
                logger.info(f"Created portfolio '{portfolio_name}' with ID {portfolio_id}")
                return portfolio_id
            else:
                # lastrowid is 0 or None - something went wrong
                raise DatabaseError(f"Failed to create portfolio '{portfolio_name}' - no ID returned")

        except Exception as e:
            logger.error(f"Failed to create portfolio '{portfolio_name}': {e}")
            # Try fallback query in case it was created but commit failed
            created = query_db(
                'SELECT id FROM portfolios WHERE account_id = ? AND name = ?',
                [account_id, portfolio_name],
                one=True
            )
            if created:
                logger.warning(f"Portfolio '{portfolio_name}' exists despite creation error - using existing ID {created['id']}")
                return created['id']
            else:
                raise DatabaseError(f"Failed to create or find portfolio '{portfolio_name}'") from e

    @staticmethod
    def delete_portfolio(portfolio_id: int, account_id: int) -> bool:
        """
        Delete a portfolio and optionally its holdings.

        Args:
            portfolio_id: Portfolio ID
            account_id: Account ID (for security)

        Returns:
            True if successful
        """
        logger.warning(f"Deleting portfolio {portfolio_id} for account {account_id}")

        # This will only delete the portfolio, not the companies
        # Companies will need portfolio_id set to NULL or reassigned
        execute_db(
            'DELETE FROM portfolios WHERE id = ? AND account_id = ?',
            [portfolio_id, account_id]
        )

        return True

    @staticmethod
    def rename_portfolio(
        portfolio_id: int,
        account_id: int,
        new_name: str
    ) -> bool:
        """
        Rename a portfolio.

        Args:
            portfolio_id: Portfolio ID
            account_id: Account ID (for security)
            new_name: New portfolio name

        Returns:
            True if successful
        """
        logger.info(f"Renaming portfolio {portfolio_id} to '{new_name}'")

        rowcount = execute_db(
            'UPDATE portfolios SET name = ? WHERE id = ? AND account_id = ?',
            [new_name, portfolio_id, account_id]
        )

        return rowcount is not None and rowcount > 0

    @staticmethod
    @cache.memoize(timeout=30)
    def get_portfolio_data_with_enrichment(account_id: int) -> list:
        """
        Get enriched portfolio data with all fields needed for the frontend.

        This is an optimized single-query replacement for get_portfolio_data().
        Returns data in the format expected by the frontend, with computed fields
        for effective shares, effective country, etc.

        Args:
            account_id: Account ID

        Returns:
            List of enriched portfolio items as dicts
        """
        logger.debug(f"Fetching enriched portfolio data for account {account_id}")

        # Single optimized query to fetch all data
        query = '''
            SELECT
                c.id,
                c.name,
                c.identifier,
                c.override_identifier,
                c.identifier_manually_edited,
                c.identifier_manual_edit_date,
                c.sector,
                c.thesis,
                c.investment_type,
                c.total_invested,
                c.override_country,
                c.country_manually_edited,
                c.country_manual_edit_date,
                c.custom_total_value,
                c.custom_price_eur,
                c.is_custom_value,
                c.custom_value_date,
                c.source,
                c.first_bought_date,
                p.name as portfolio_name,
                cs.shares,
                cs.override_share,
                cs.manual_edit_date,
                cs.is_manually_edited,
                cs.csv_modified_after_edit,
                mp.price,
                mp.price_eur,
                mp.currency,
                mp.last_updated,
                mp.country
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
            ORDER BY p.name, c.name
        '''

        results = query_db(query, [account_id])

        if not results:
            logger.warning(f"No portfolio data found for account_id: {account_id}")
            return []

        # Transform raw database rows into enriched output format
        portfolio_data = []
        for row in results:
            try:
                # Calculate effective values
                effective_shares = (
                    float(row['override_share']) if row.get('override_share') is not None
                    else (float(row['shares']) if row.get('shares') is not None else 0)
                )

                # Skip companies with zero shares (defensive filter)
                # These should have been removed during import, but filter here as safety net
                if effective_shares <= 1e-6:
                    logger.debug(f"Skipping company {row['name']} with zero shares (effective_shares={effective_shares})")
                    continue

                effective_country = row.get('override_country') or row.get('country')

                # Format last_updated
                last_updated = row.get('last_updated')
                if last_updated and not isinstance(last_updated, str):
                    last_updated = last_updated.isoformat()

                item = {
                    'id': row['id'],
                    'company': row['name'],
                    'identifier': row['identifier'],
                    'override_identifier': row.get('override_identifier'),
                    'identifier_manually_edited': bool(row.get('identifier_manually_edited', False)),
                    'identifier_manual_edit_date': row.get('identifier_manual_edit_date'),
                    'portfolio': row.get('portfolio_name') or row.get('portfolio') or '',
                    'sector': row['sector'],
                    'thesis': row.get('thesis') or '',
                    'investment_type': row.get('investment_type'),
                    'shares': float(row['shares']) if row.get('shares') is not None else 0,
                    'override_share': float(row['override_share']) if row.get('override_share') is not None else None,
                    'effective_shares': effective_shares,
                    'manual_edit_date': row.get('manual_edit_date'),
                    'is_manually_edited': bool(row.get('is_manually_edited', False)),
                    'csv_modified_after_edit': bool(row.get('csv_modified_after_edit', False)),
                    'price': float(row['price']) if row.get('price') is not None else None,
                    'price_eur': float(row['price_eur']) if row.get('price_eur') is not None else None,
                    'currency': row.get('currency'),
                    'country': row.get('country'),
                    'override_country': row.get('override_country'),
                    'effective_country': effective_country,
                    'country_manually_edited': bool(row.get('country_manually_edited', False)),
                    'country_manual_edit_date': row.get('country_manual_edit_date'),
                    'total_invested': float(row['total_invested']) if row.get('total_invested') is not None else 0,
                    'last_updated': last_updated,
                    'custom_total_value': float(row['custom_total_value']) if row.get('custom_total_value') is not None else None,
                    'custom_price_eur': float(row['custom_price_eur']) if row.get('custom_price_eur') is not None else None,
                    'is_custom_value': bool(row.get('is_custom_value', False)),
                    'custom_value_date': row.get('custom_value_date'),
                    'source': row.get('source', 'parqet'),  # 'parqet', 'ibkr', or 'manual'
                    'first_bought_date': row.get('first_bought_date')
                }
                portfolio_data.append(item)
            except Exception as e:
                logger.error(f"Error processing row: {row}")
                logger.error(f"Error details: {str(e)}")
                continue

        logger.info(f"Returning {len(portfolio_data)} portfolio items")
        return portfolio_data

    @staticmethod
    def find_duplicate_company(
        account_id: int,
        name: str,
        identifier: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Check if company with same name or identifier exists.

        Args:
            account_id: Account ID
            name: Company name to check
            identifier: Optional identifier to check

        Returns:
            Existing company dict or None
        """
        query = '''
            SELECT c.id, c.name, c.identifier, c.portfolio_id,
                   p.name as portfolio_name
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            WHERE c.account_id = ?
              AND (LOWER(c.name) = LOWER(?)
                   OR (c.identifier = ? AND ? IS NOT NULL AND c.identifier IS NOT NULL))
            LIMIT 1
        '''
        return query_db(query, [account_id, name, identifier, identifier], one=True)

    @staticmethod
    def create_company_manual(
        account_id: int,
        portfolio_id: Optional[int],
        name: str,
        identifier: Optional[str],
        sector: str,
        investment_type: Optional[str],
        country: Optional[str],
        shares: float,
        is_custom_value: bool,
        custom_total_value: Optional[float],
        custom_price_eur: Optional[float],
        source: str = 'manual',
        total_invested: float = 0
    ) -> int:
        """
        Create a manually-added company.

        Args:
            account_id: Account ID
            portfolio_id: Portfolio ID (None for unassigned)
            name: Company name
            identifier: Ticker/ISIN (optional)
            sector: Sector name
            investment_type: 'Stock', 'ETF', or None
            country: Country code (optional)
            shares: Number of shares
            is_custom_value: Whether using custom value (no market price)
            custom_total_value: Custom total value (if is_custom_value)
            custom_price_eur: Custom price per share (if is_custom_value)
            source: 'manual', 'parqet', or 'ibkr'
            total_invested: Total amount invested (for P&L tracking)

        Returns:
            New company ID
        """
        db = get_db()

        # Insert company
        cursor = db.execute('''
            INSERT INTO companies (
                account_id, portfolio_id, name, identifier, sector,
                investment_type, override_country, country_manually_edited,
                is_custom_value, custom_total_value, custom_price_eur,
                custom_value_date, source, total_invested
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
                      ?, ?)
        ''', [
            account_id, portfolio_id, name, identifier, sector,
            investment_type, country, 1 if country else 0,
            1 if is_custom_value else 0, custom_total_value, custom_price_eur,
            is_custom_value,  # for the CASE statement
            source, total_invested
        ])

        company_id = cursor.lastrowid

        # Insert shares record
        db.execute('''
            INSERT INTO company_shares (company_id, shares)
            VALUES (?, ?)
        ''', [company_id, shares])

        db.commit()

        logger.info(f"Created manual company '{name}' with ID {company_id}")
        return company_id

    @staticmethod
    def delete_manual_company(account_id: int, company_id: int) -> bool:
        """
        Delete a manually-added company.

        Only companies with source='manual' can be deleted.

        Args:
            account_id: Account ID (for security)
            company_id: Company ID to delete

        Returns:
            True if deleted, False if not found or not manual
        """
        db = get_db()

        # First verify it's a manual company
        company = query_db(
            'SELECT id, source FROM companies WHERE id = ? AND account_id = ?',
            [company_id, account_id],
            one=True
        )

        if not company:
            logger.warning(f"Company {company_id} not found for account {account_id}")
            return False

        if company.get('source') != 'manual':
            logger.warning(f"Company {company_id} is not manual (source={company.get('source')})")
            return False

        # Delete shares first (foreign key)
        db.execute('DELETE FROM company_shares WHERE company_id = ?', [company_id])

        # Delete company
        db.execute(
            'DELETE FROM companies WHERE id = ? AND account_id = ? AND source = ?',
            [company_id, account_id, 'manual']
        )

        db.commit()
        logger.info(f"Deleted manual company {company_id}")
        return True

    @staticmethod
    def get_manual_company_ids(account_id: int, company_ids: List[int]) -> List[int]:
        """
        Filter a list of company IDs to only include manual companies.

        Args:
            account_id: Account ID
            company_ids: List of company IDs to filter

        Returns:
            List of company IDs that are manual
        """
        if not company_ids:
            return []

        placeholders = ','.join('?' * len(company_ids))
        query = f'''
            SELECT id FROM companies
            WHERE account_id = ? AND source = 'manual' AND id IN ({placeholders})
        '''
        results = query_db(query, [account_id] + company_ids)
        return [r['id'] for r in results]
