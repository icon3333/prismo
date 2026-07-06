# app/utils/db_utils.py
import logging
import threading
from datetime import datetime
from typing import Optional, List, Dict, Any, Union
from app.db_manager import query_db, execute_db, get_background_db

logger = logging.getLogger(__name__)


# --- Thread-local SQLite connections for background threads ---
#
# The previous implementation opened and closed a fresh sqlite3.Connection on
# every helper call. During a batch refresh that fires `_update_job_progress_background`
# every 2s and `_process_single_identifier` per identifier, that was many
# open/PRAGMA-executescript/close cycles per second. Reusing a connection per
# thread eliminates that overhead. ThreadPoolExecutor reuses its workers, so the
# pool ends up holding a small fixed number of persistent connections; idle SQLite
# connections are cheap.

_bg_local = threading.local()


def _get_thread_conn():
    """Return a SQLite connection owned by the current thread (lazy create)."""
    conn = getattr(_bg_local, 'conn', None)
    if conn is None:
        conn = get_background_db()
        _bg_local.conn = conn
    return conn


def close_thread_conn() -> None:
    """Close and drop the current thread's background connection (if any).

    Call at the end of a long-running background job for the threads you own
    (the job's main thread). Workers in the persistent pool keep their
    connections for their lifetime — that is intentional.
    """
    conn = getattr(_bg_local, 'conn', None)
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass
    _bg_local.conn = None


def _reset_thread_conn_on_error() -> None:
    """Drop a possibly-bad thread connection so the next call recreates it."""
    conn = getattr(_bg_local, 'conn', None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
    _bg_local.conn = None


def query_background_db(query, args=(), one=False):
    """
    Query the database from background threads. Uses a thread-local connection.
    """
    cursor = None
    try:
        db = _get_thread_conn()
        cursor = db.execute(query, args)
        rv = cursor.fetchall()
        result = [dict(row) for row in rv]
        return (result[0] if result else None) if one else result
    except Exception as e:
        logger.error(f"Background query failed: {e} | query={query} args={args}")
        _reset_thread_conn_on_error()
        raise
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass


def execute_background_db(query, args=()):
    """
    Execute a statement from background threads and commit, returning rowcount.
    Uses a thread-local connection.
    """
    cursor = None
    try:
        db = _get_thread_conn()
        cursor = db.execute(query, args)
        rowcount = cursor.rowcount
        db.commit()
        return rowcount
    except Exception as e:
        logger.error(f"Background execute failed: {e} | query={query} args={args}")
        _reset_thread_conn_on_error()
        raise
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass


def update_price_in_db_background(identifier: str, price: float, currency: str, price_eur: float, country: Optional[str] = None, modified_identifier: Optional[str] = None) -> bool:
    """
    Update price in database for a single identifier from background threads.
    Uses a SINGLE database connection/transaction for all operations to avoid SQLite lock contention.

    Args:
        identifier: Stock identifier (ISIN or ticker)
        price: Price in original currency
        currency: Currency code
        price_eur: Price in EUR
        country: Country of the company
        modified_identifier: If provided, update the company's identifier to this value

    Returns:
        Success status
    """
    try:
        if not identifier or price is None:
            logger.warning(f"Missing identifier or price: {identifier}, {price}")
            return False

        now = datetime.now().isoformat()

        # Reuse the thread-local connection — workers in the persistent batch
        # pool keep one connection each, instead of paying open + PRAGMA + close
        # per identifier.
        conn = _get_thread_conn()
        cursor = conn.cursor()

        # If we have a modified identifier, update the company records first
        if modified_identifier:
            logger.info(f"Updating identifier in database from {identifier} to {modified_identifier}")
            cursor.execute('''
                UPDATE companies
                SET identifier = ?
                WHERE identifier = ?
            ''', [modified_identifier, identifier])
            logger.info(f"Updated {cursor.rowcount} company records with new identifier {modified_identifier}")
            # Use the modified identifier for all subsequent operations
            identifier = modified_identifier

        # Single upsert instead of SELECT + UPDATE/INSERT to reduce lock
        # contention. price_eur=None (EUR conversion unavailable) preserves
        # the previously stored price_eur instead of clobbering it with NULL.
        logger.debug(f"Upserting price record for {identifier}")
        cursor.execute('''
            INSERT INTO market_prices
            (identifier, price, currency, price_eur, last_updated, country)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(identifier) DO UPDATE SET
                price = excluded.price,
                currency = excluded.currency,
                price_eur = COALESCE(excluded.price_eur, market_prices.price_eur),
                last_updated = excluded.last_updated,
                country = excluded.country
        ''', [identifier, price, currency, price_eur, now, country])

        # NOTE: accounts.last_price_update is no longer updated here. The
        # batch_processing job calls bulk_update_accounts_last_price_update()
        # once at the end of the batch, replacing N per-identifier UPDATEs.

        conn.commit()

        # Auto-categorize investment type if not already set (non-critical).
        try:
            from app.utils.yfinance_utils import auto_categorize_investment_type

            investment_type = auto_categorize_investment_type(identifier)
            if investment_type:
                cursor.execute('''
                    UPDATE companies
                    SET investment_type = ?
                    WHERE identifier = ? AND investment_type IS NULL
                ''', [investment_type, identifier])
                if cursor.rowcount > 0:
                    logger.info(f"Auto-categorized {cursor.rowcount} companies with identifier {identifier} as {investment_type}")
                # CRITICAL: commit even when 0 rows matched. A write statement opens a
                # transaction and takes SQLite's WAL write lock the moment it runs —
                # before it knows the row count. Skipping commit on rowcount == 0 leaves
                # that transaction open, and since batch-pool worker connections are
                # long-lived, the write lock is then held indefinitely, blocking ALL
                # other writers (e.g. UI state saves) with "database is locked".
                conn.commit()
        except Exception as e:
            # Don't fail the entire price update if auto-categorization fails
            logger.warning(f"Auto-categorization failed for {identifier}: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

        # Safety net: never leave this long-lived connection holding the write lock.
        if conn.in_transaction:
            conn.commit()

        logger.info(f"Updated price for {identifier}: {price} {currency} ({price_eur} EUR) country={country}")
        return True

    except Exception as e:
        # Roll back so the thread connection stays usable for the next call.
        try:
            _get_thread_conn().rollback()
        except Exception:
            _reset_thread_conn_on_error()
        logger.error(f"Failed to update price for {identifier}: {e}", exc_info=True)
        return False


def bulk_update_accounts_last_price_update(identifiers: List[str]) -> int:
    """
    Set accounts.last_price_update for every account that holds any of the
    given identifiers. Replaces N per-identifier UPDATEs at end of a batch.
    Uses the thread-local connection.
    """
    if not identifiers:
        return 0

    try:
        db = _get_thread_conn()
        placeholders = ','.join('?' * len(identifiers))
        rowcount = db.execute(
            f'''
            UPDATE accounts
            SET last_price_update = ?
            WHERE id IN (
                SELECT DISTINCT account_id
                FROM companies
                WHERE identifier IN ({placeholders})
            )
            ''',
            [datetime.now().isoformat(), *identifiers],
        ).rowcount
        db.commit()
        logger.info(f"Bulk-updated last_price_update on {rowcount} account(s) for {len(identifiers)} identifier(s)")
        return rowcount
    except Exception as e:
        logger.error(f"bulk_update_accounts_last_price_update failed: {e}")
        _reset_thread_conn_on_error()
        return 0


def update_price_in_db(identifier: str, price: float, currency: str, price_eur: float, country: Optional[str] = None, modified_identifier: Optional[str] = None) -> bool:
    """
    Update price in database for a single identifier.

    Uses a single upsert statement (instead of SELECT + UPDATE/INSERT,
    matching the background variant). When price_eur is None (EUR conversion
    unavailable, e.g. no FX rate stored and network down), the previously
    stored price_eur is preserved instead of being clobbered with NULL.
    """
    try:
        if not identifier or price is None:
            logger.warning(
                f"Missing identifier or price: {identifier}, {price}")
            return False

        now = datetime.now().isoformat()

        if modified_identifier:
            logger.info(
                f"Updating identifier in database from {identifier} to {modified_identifier}")
            rows_updated = execute_db(
                'UPDATE companies SET identifier = ? WHERE identifier = ?',
                [modified_identifier, identifier]
            )
            logger.info(
                f"Updated {rows_updated} company records with new identifier {modified_identifier}")
            identifier = modified_identifier

        execute_db('''
            INSERT INTO market_prices
            (identifier, price, currency, price_eur, last_updated, country)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(identifier) DO UPDATE SET
                price = excluded.price,
                currency = excluded.currency,
                price_eur = COALESCE(excluded.price_eur, market_prices.price_eur),
                last_updated = excluded.last_updated,
                country = excluded.country
        ''', [identifier, price, currency, price_eur, now, country])

        execute_db('''
            UPDATE accounts
            SET last_price_update = ?
            WHERE id IN (
                SELECT DISTINCT account_id
                FROM companies
                WHERE identifier = ?
            )
        ''', [now, identifier])

        logger.info(
            f"Successfully updated price for {identifier}: {price} {currency} ({price_eur} EUR) country={country}")
        return True

    except Exception as e:
        logger.error(
            f"Failed to update price in database for {identifier}: {str(e)}")
        return False


def load_portfolio_data(account_id=None, portfolio_id=None):
    """
    Load portfolio data from the database.

    Args:
        account_id: Optional account ID to filter by
        portfolio_id: Optional portfolio ID to filter by

    Returns:
        List of portfolio items or empty list if error
    """
    try:
        if account_id is None and portfolio_id is None:
            logger.error(
                "Both account_id and portfolio_id are None - at least one is required")
            return []

        # Build main query. Empty input ranges return [] naturally; the
        # previous three preliminary existence/count queries were just logging.
        params = []
        query = '''
            SELECT
                c.id, c.name, c.identifier, c.sector, c.total_invested,
                c.override_country, c.country_manually_edited, c.country_manual_edit_date,
                cs.shares, cs.override_share, cs.manual_edit_date, cs.is_manually_edited, cs.csv_modified_after_edit,
                p.name as portfolio_name, p.id as portfolio_id,
                mp.price, mp.currency, mp.price_eur, mp.last_updated,
                mp.country
            FROM companies c
            LEFT JOIN company_shares cs ON c.id = cs.company_id
            LEFT JOIN portfolios p ON c.portfolio_id = p.id
            LEFT JOIN market_prices mp ON c.identifier = mp.identifier
            WHERE 1=1
        '''

        if account_id:
            query += ' AND c.account_id = ?'
            params.append(account_id)

        if portfolio_id:
            query += ' AND c.portfolio_id = ?'
            params.append(portfolio_id)

        # Execute query and get results
        logger.info(f"Executing portfolio data query with params: {params}")
        results = query_db(query, params)

        # Add detailed logging about results
        if not results:
            logger.warning("Query returned no results")
            return []

        if len(results) > 0:
            sample = results[0]
            logger.debug(f"Sample portfolio data keys: {list(sample.keys())}")
            if 'portfolio_name' in sample:
                logger.debug(
                    f"Sample portfolio_name value: '{sample['portfolio_name']}'")
            else:
                logger.warning(
                    "portfolio_name key not found in results - check portfolio_id references")

            # Log some metrics about the results
            missing_portfolio_names = sum(
                1 for r in results if not r.get('portfolio_name'))
            if missing_portfolio_names > 0:
                logger.warning(
                    f"{missing_portfolio_names} out of {len(results)} items have missing portfolio names")

        logger.info(f"Successfully loaded {len(results)} portfolio data items")
        return results

    except Exception as e:
        logger.error(f"Error loading portfolio data: {str(e)}", exc_info=True)
        return []


def update_batch_prices_in_db(results):
    """Update market prices with results from batch processing."""
    success_count = 0
    modified_count = 0
    failed_count = 0

    try:
        for isin, result in results.items():
            if result.get('success'):
                # Extract nested data structure (matches yfinance_utils.get_isin_data return format)
                data = result.get('data', {})
                price = data.get('currentPrice')
                currency = data.get('currency', 'USD')
                price_eur = data.get('priceEUR', price)
                country = data.get('country')
                modified_identifier = result.get('modified_identifier')

                if price is None:
                    logger.warning(f"No price data for {isin}, skipping")
                    failed_count += 1
                    continue

                if modified_identifier:
                    logger.info(
                        f"📝 Found modified identifier: {isin} -> {modified_identifier}")
                    modified_count += 1

                success = update_price_in_db(
                    isin,
                    price,
                    currency,
                    price_eur,
                    country,
                    modified_identifier      # Pass modified_identifier if present
                )

                if success:
                    success_count += 1
                    if modified_identifier:
                        logger.info(
                            f"✅ Successfully updated price AND identifier for {isin} -> {modified_identifier}")
                else:
                    failed_count += 1
                    logger.warning(f"Failed to update price for {isin}")

        logger.info(
            f"Batch update complete. Success: {success_count}, Modified: {modified_count}, Failed: {failed_count}")
        return True
    except Exception as e:
        logger.error(f"Error updating batch prices in database: {str(e)}")
        return False


def update_prices(portfolio_items, get_price_function=None):
    """
    Update prices for portfolio items.

    Args:
        portfolio_items: List of portfolio items
        get_price_function: Optional function to get price for an identifier

    Returns:
        Tuple of (updated items, success count, failure count)
    """
    if not portfolio_items:
        return [], 0, 0

    success_count = 0
    failure_count = 0
    updated_items = []

    for item in portfolio_items:
        identifier = item.get('identifier')
        if not identifier:
            failure_count += 1
            updated_items.append(item)
            continue

        if get_price_function:
            # Use provided price function
            success, price_data = get_price_function(identifier)
        else:
            # Use default implementation
            from app.utils.yfinance_utils import get_yfinance_info
            # Use get_yfinance_info which includes all data fields
            result = get_yfinance_info(identifier)
            success = result.get('success', False)
            price_data = result if success else None

        if success and price_data:
            # Extract price details from result
            price = price_data.get('price')
            currency = price_data.get('currency', 'USD')
            price_eur = price_data.get('price_eur', price)
            country = price_data.get('country')

            # Validate required numeric values
            if price is None or price_eur is None:
                failure_count += 1
                updated_items.append(item)
                continue

            # Update database
            updated = update_price_in_db(
                identifier, float(price), currency, float(price_eur), country
            )

            if updated:
                # Update item with new price and additional data
                item['price'] = price
                item['currency'] = currency
                item['price_eur'] = price_eur
                item['country'] = country
                item['last_updated'] = datetime.now().isoformat()
                success_count += 1
            else:
                failure_count += 1
        else:
            failure_count += 1

        updated_items.append(item)

    return updated_items, success_count, failure_count


def calculate_portfolio_composition(portfolio_data):
    """
    Calculate portfolio composition metrics.

    Args:
        portfolio_data: List of portfolio items or DataFrame

    Returns:
        Dictionary with portfolio metrics
    """
    import pandas as pd

    try:
        # Convert to DataFrame if list
        if isinstance(portfolio_data, list):
            df = pd.DataFrame(portfolio_data)
        else:
            df = portfolio_data

        if df.empty:
            return {
                'total_value_eur': 0,
                'holdings_count': 0,
                'holdings_by_currency': {},
                'holdings_by_type': {}
            }

        # Calculate total portfolio value in EUR
        total_value_eur = df['value_eur'].sum(
        ) if 'value_eur' in df.columns else 0

        # Count holdings
        holdings_count = len(df)

        # Group by currency
        holdings_by_currency = {}
        if 'currency' in df.columns and 'value' in df.columns:
            currency_groups = df.groupby('currency')['value'].sum()
            for currency, value in currency_groups.items():
                holdings_by_currency[currency] = float(value)

        # Group by asset type
        holdings_by_type = {}
        if 'type' in df.columns and 'value_eur' in df.columns:
            type_groups = df.groupby('type')['value_eur'].sum()
            for asset_type, value in type_groups.items():
                if total_value_eur > 0:
                    holdings_by_type[asset_type] = {
                        'value': float(value),
                        'percentage': float(value / total_value_eur * 100)
                    }
                else:
                    holdings_by_type[asset_type] = {
                        'value': float(value),
                        'percentage': 0
                    }


        return {
            'total_value_eur': float(total_value_eur),
            'holdings_count': holdings_count,
            'holdings_by_currency': holdings_by_currency,
            'holdings_by_type': holdings_by_type
        }

    except Exception as e:
        logger.error(f"Error calculating portfolio composition: {str(e)}")
        return {
            'total_value_eur': 0,
            'holdings_count': 0,
            'holdings_by_currency': {},
            'holdings_by_type': {}
        }


def get_effective_shares_sql():
    """
    Return SQL expression to calculate effective shares.
    Uses override_share if not null, otherwise uses shares.
    """
    return "COALESCE(cs.override_share, cs.shares, 0)"


def get_effective_shares_value(row):
    """
    Calculate effective shares from a database row.
    Uses override_share if not null, otherwise uses shares.
    
    Args:
        row: Database row dict with 'override_share' and 'shares' keys
        
    Returns:
        float: Effective shares value
    """
    override_share = row.get('override_share')
    shares = row.get('shares', 0)
    
    if override_share is not None:
        return float(override_share)
    return float(shares) if shares is not None else 0.0
