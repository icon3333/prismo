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
                c.sector,
                c.country,
                p.id as portfolio_id,
                p.name as portfolio_name,
                cs.shares,
                cs.purchase_price,
                cs.purchase_date,
                mp.price,
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
                mp.price,
                mp.price_eur,
                mp.currency
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.id = ? AND c.account_id = ?
        '''

        results = query_db(query, [company_id, account_id])
        return results[0] if results else None

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
    def create_holding(
        account_id: int,
        portfolio_id: int,
        name: str,
        identifier: str,
        isin: Optional[str] = None,
        sector: Optional[str] = None,
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
            sector: Asset sector (optional)
            country: Country code (optional)

        Returns:
            New company ID
        """
        execute_db(
            '''INSERT INTO companies
               (account_id, portfolio_id, name, identifier, isin, sector, country)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            [account_id, portfolio_id, name, identifier, isin, sector, country]
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
        allowed_fields = ['name', 'identifier', 'isin', 'sector', 'country']

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
                mp.price,
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
        # Verify company belongs to account (lightweight check)
        if not PortfolioRepository.company_exists(company_id, account_id):
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

    @staticmethod
    def get_portfolio_allocation_data(
        account_id: int,
        portfolio_id: Optional[int] = None
    ) -> List[Dict]:
        """
        Get portfolio data optimized for allocation calculations.

        Returns all necessary data for rebalancing in a single query.
        Used by AllocationService for rebalancing calculations.

        Args:
            account_id: Account ID
            portfolio_id: Optional portfolio ID to filter (None = all portfolios)

        Returns:
            List of holdings with shares, prices, and portfolio info
        """
        logger.debug(f"Fetching allocation data for account {account_id}, portfolio {portfolio_id}")

        query = '''
            SELECT
                c.id as company_id,
                c.name,
                c.identifier,
                c.isin,
                c.sector,
                c.country,
                p.id as portfolio_id,
                p.name as portfolio_name,
                COALESCE(cs.shares, 0) as shares,
                COALESCE(cs.override_share, cs.shares, 0) as effective_shares,
                cs.is_manually_edited,
                cs.purchase_price,
                cs.purchase_date,
                mp.price,
                mp.price_eur,
                mp.currency,
                mp.last_updated as price_updated,
                (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0)) as position_value
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
        '''

        params = [account_id]

        if portfolio_id is not None:
            query += ' AND p.id = ?'
            params.append(portfolio_id)

        query += ' ORDER BY p.name, c.name'

        results = query_db(query, params)
        return results if results else []

    @staticmethod
    def get_detailed_portfolio_summary(
        account_id: int,
        portfolio_id: Optional[int] = None
    ) -> Dict:
        """
        Get detailed portfolio summary with statistics.

        Calculates total value, number of holdings, asset allocation,
        and country allocation in a single optimized query set.

        Args:
            account_id: Account ID
            portfolio_id: Optional portfolio ID (None = all portfolios)

        Returns:
            Dict with summary statistics
        """
        logger.debug(f"Fetching detailed summary for account {account_id}, portfolio {portfolio_id}")

        # Base query for holdings
        holdings_query = '''
            SELECT
                c.id,
                c.name,
                c.sector,
                c.country,
                COALESCE(cs.override_share, cs.shares, 0) as shares,
                COALESCE(mp.price, 0) as price,
                COALESCE(mp.price_eur, 0) as price_eur,
                mp.currency,
                (COALESCE(cs.override_share, cs.shares, 0) * COALESCE(mp.price_eur, 0)) as value
            FROM companies c
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE c.account_id = ?
        '''

        params = [account_id]
        if portfolio_id is not None:
            holdings_query += ' AND p.id = ?'
            params.append(portfolio_id)

        holdings = query_db(holdings_query, params)

        if not holdings:
            return {
                'total_value': 0,
                'num_holdings': 0,
                'num_sectors': 0,
                'num_countries': 0,
                'sector_allocation': {},
                'country_allocation': {}
            }

        # Calculate aggregations
        total_value = sum(h['value'] for h in holdings)
        num_holdings = len(holdings)

        # Sector allocation
        sector_allocation = {}
        for holding in holdings:
            sector = holding['sector'] or 'Unknown'
            sector_allocation[sector] = sector_allocation.get(sector, 0) + holding['value']

        # Country allocation
        country_allocation = {}
        for holding in holdings:
            country = holding['country'] or 'Unknown'
            country_allocation[country] = country_allocation.get(country, 0) + holding['value']

        # Convert to percentages
        if total_value > 0:
            sector_allocation = {
                k: (v / total_value * 100)
                for k, v in sector_allocation.items()
            }
            country_allocation = {
                k: (v / total_value * 100)
                for k, v in country_allocation.items()
            }

        return {
            'total_value': total_value,
            'num_holdings': num_holdings,
            'num_sectors': len(sector_allocation),
            'num_countries': len(country_allocation),
            'sector_allocation': sector_allocation,
            'country_allocation': country_allocation
        }

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

        # Validate account exists
        account = query_db('SELECT * FROM accounts WHERE id = ?', [account_id], one=True)
        if not account:
            logger.error(f"Account with ID {account_id} not found in database")
            return []

        # Check if any portfolios exist for this account
        portfolios = query_db(
            'SELECT COUNT(*) as count FROM portfolios WHERE account_id = ?',
            [account_id],
            one=True
        )
        if not portfolios or portfolios['count'] == 0:
            logger.error(f"No portfolios found for account_id: {account_id}")
            return []

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
                    'custom_value_date': row.get('custom_value_date')
                }
                portfolio_data.append(item)
            except Exception as e:
                logger.error(f"Error processing row: {row}")
                logger.error(f"Error details: {str(e)}")
                continue

        logger.info(f"Returning {len(portfolio_data)} portfolio items")
        return portfolio_data
