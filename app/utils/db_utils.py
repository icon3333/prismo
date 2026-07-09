# app/utils/db_utils.py
import logging
import threading
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Union
from app.db_manager import query_db, execute_db, get_background_db

logger = logging.getLogger(__name__)


def utc_now_iso() -> str:
    """Timezone-aware UTC ISO timestamp (ends in +00:00).

    Timestamps the frontend parses (market_prices.last_updated,
    accounts.last_price_update) MUST carry an explicit offset: a tz-less ISO
    string is parsed by JS `new Date()` as browser-local time, so a fresh
    price written as naive UTC in Docker shows as 1-2h old in a CET browser.
    """
    return datetime.now(timezone.utc).isoformat()


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

        now = utc_now_iso()

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
            [utc_now_iso(), *identifiers],
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

        now = utc_now_iso()

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
