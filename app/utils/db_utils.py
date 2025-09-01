# app/utils/db_utils.py
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any, Union
from app.db_manager import query_db, execute_db, get_background_db

logger = logging.getLogger(__name__)


def query_background_db(query, args=(), one=False):
    """
    Query the database from background threads and return results as dictionary objects.
    This function doesn't require Flask application context.
    """
    try:
        logger.debug(f"Executing background query: {query}")
        logger.debug(f"Query args: {args}")
        
        db = get_background_db()
        cursor = db.execute(query, args)
        rv = cursor.fetchall()
        cursor.close()
        db.close()
        
        # Convert rows to dictionaries
        result = [dict(row) for row in rv]
        logger.debug(f"Background query returned {len(result)} rows")
        
        return (result[0] if result else None) if one else result
    except Exception as e:
        logger.error(f"Background database query failed: {str(e)}")
        logger.error(f"Query was: {query}")
        logger.error(f"Args were: {args}")
        raise


def execute_background_db(query, args=()):
    """
    Execute a statement from background threads and commit changes, returning the rowcount.
    This function doesn't require Flask application context.
    """
    try:
        logger.debug(f"Executing background statement: {query}")
        logger.debug(f"Statement args: {args}")
        
        db = get_background_db()
        cursor = db.execute(query, args)
        rowcount = cursor.rowcount
        db.commit()
        cursor.close()
        db.close()
        
        logger.debug(f"Background statement affected {rowcount} rows")
        return rowcount
    except Exception as e:
        logger.error(f"Background database execute failed: {str(e)}")
        logger.error(f"Statement was: {query}")
        logger.error(f"Args were: {args}")
        raise


def update_price_in_db_background(identifier: str, price: float, currency: str, price_eur: float, country: Optional[str] = None, modified_identifier: Optional[str] = None) -> bool:
    """
    Update price in database for a single identifier from background threads.
    This version uses get_background_db() and doesn't require Flask application context.

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
            logger.warning(
                f"Missing identifier or price: {identifier}, {price}")
            return False

        now = datetime.now().isoformat()

        # If we have a modified identifier, update the company records first
        if modified_identifier:
            logger.info(
                f"⚠️ Updating identifier in database from {identifier} to {modified_identifier}")

            # Update identifier in companies table
            rows_updated = execute_background_db('''
                UPDATE companies 
                SET identifier = ?
                WHERE identifier = ?
            ''', [modified_identifier, identifier])

            logger.info(
                f"Updated {rows_updated} company records with new identifier {modified_identifier}")

            # Use the modified identifier for all subsequent operations
            identifier = modified_identifier

        # Check if the record exists in market_prices
        existing = query_background_db(
            'SELECT 1 FROM market_prices WHERE identifier = ?',
            [identifier],
            one=True
        )

        if existing:
            # Update existing record
            execute_background_db('''
                UPDATE market_prices
                SET price = ?, currency = ?, price_eur = ?, last_updated = ?,
                    country = ?
                WHERE identifier = ?
            ''', [price, currency, price_eur, now, country, identifier])
            logger.info(
                f"Updated existing price record for {identifier} with additional data")
        else:
            # Insert new record
            execute_background_db('''
                INSERT INTO market_prices
                (identifier, price, currency, price_eur, last_updated, country)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', [identifier, price, currency, price_eur, now, country])
            logger.info(
                f"Created new price record for {identifier} with additional data")

        # Update last_price_update in accounts table for all accounts that have this identifier
        execute_background_db('''
            UPDATE accounts 
            SET last_price_update = ? 
            WHERE id IN (
                SELECT DISTINCT account_id 
                FROM companies 
                WHERE identifier = ?
            )
        ''', [now, identifier])

        logger.info(
            f"Successfully updated price for {identifier}: {price} {currency} ({price_eur} EUR) with country={country}")
        return True

    except Exception as e:
        logger.error(
            f"Failed to update price in database for {identifier}: {str(e)}")
        return False


def update_price_in_db(identifier: str, price: float, currency: str, price_eur: float, country: Optional[str] = None, modified_identifier: Optional[str] = None) -> bool:
    """
    Update price in database for a single identifier.

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
            logger.warning(
                f"Missing identifier or price: {identifier}, {price}")
            return False

        now = datetime.now().isoformat()

        # If we have a modified identifier, update the company records first
        if modified_identifier:
            logger.info(
                f"⚠️ Updating identifier in database from {identifier} to {modified_identifier}")

            # Update identifier in companies table
            rows_updated = execute_db('''
                UPDATE companies 
                SET identifier = ?
                WHERE identifier = ?
            ''', [modified_identifier, identifier])

            logger.info(
                f"Updated {rows_updated} company records with new identifier {modified_identifier}")

            # Use the modified identifier for all subsequent operations
            identifier = modified_identifier

        # Check if the record exists in market_prices
        existing = query_db(
            'SELECT 1 FROM market_prices WHERE identifier = ?',
            [identifier],
            one=True
        )

        if existing:
            # Update existing record
            execute_db('''
                UPDATE market_prices
                SET price = ?, currency = ?, price_eur = ?, last_updated = ?,
                    country = ?
                WHERE identifier = ?
            ''', [price, currency, price_eur, now, country, identifier])
            logger.info(
                f"Updated existing price record for {identifier} with additional data")
        else:
            # Insert new record
            execute_db('''
                INSERT INTO market_prices
                (identifier, price, currency, price_eur, last_updated, country)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', [identifier, price, currency, price_eur, now, country])
            logger.info(
                f"Created new price record for {identifier} with additional data")

        # Update last_price_update in accounts table for all accounts that have this identifier
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
            f"Successfully updated price for {identifier}: {price} {currency} ({price_eur} EUR) with country={country}")
        return True

    except Exception as e:
        logger.error(
            f"Failed to update price in database for {identifier}: {str(e)}")
        return False


def get_portfolios(account_id):
    """Get list of portfolios for an account"""
    try:
        portfolios = query_db('''
            SELECT id, name
            FROM portfolios
            WHERE account_id = ?
            ORDER BY name
        ''', [account_id])

        if portfolios is None:
            return []
        
        return [{'id': p['id'], 'name': p['name']} for p in portfolios]
    except Exception as e:
        logger.error(f"Error getting portfolios: {str(e)}")
        return []


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
        # Validate inputs
        if account_id is None and portfolio_id is None:
            logger.error(
                "Both account_id and portfolio_id are None - at least one is required")
            return []

        # Check for valid account_id
        if account_id is not None:
            account_check = query_db('SELECT id FROM accounts WHERE id = ?', [
                                     account_id], one=True)
            if not account_check:
                logger.error(
                    f"Account with ID {account_id} does not exist in database")
                return []

        # Check for valid portfolio_id
        if portfolio_id is not None:
            portfolio_check = query_db('SELECT id FROM portfolios WHERE id = ?', [
                                       portfolio_id], one=True)
            if not portfolio_check:
                logger.error(
                    f"Portfolio with ID {portfolio_id} does not exist in database")
                return []

        # Check for companies associated with this account/portfolio
        company_check_query = 'SELECT COUNT(*) as count FROM companies WHERE 1=1'
        company_check_params = []

        if account_id:
            company_check_query += ' AND account_id = ?'
            company_check_params.append(account_id)
        if portfolio_id:
            company_check_query += ' AND portfolio_id = ?'
            company_check_params.append(portfolio_id)

        company_count = query_db(
            company_check_query, company_check_params, one=True)
        if not company_count or (isinstance(company_count, dict) and company_count.get('count', 0) == 0):
            logger.warning(
                f"No companies found for the specified filters (account_id={account_id}, portfolio_id={portfolio_id})")
        else:
            count_value = company_count.get('count', 0) if isinstance(company_count, dict) else 0
            logger.info(
                f"Found {count_value} companies for the specified filters")

        # Build main query
        params = []
        query = '''
            SELECT
                c.id, c.name, c.identifier, c.category, c.total_invested,
                cs.shares, cs.override_share, cs.manual_edit_date, cs.is_manually_edited, cs.csv_modified_after_edit,
                p.name as portfolio_name, p.id as portfolio_id,
                mp.price, mp.currency, mp.price_eur, mp.last_updated,
                mp.country, mp.sector, mp.industry
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


def process_portfolio_dataframe(df, account_id=None, portfolio_id=None):
    """
    Process a portfolio dataframe and calculate additional metrics.

    Args:
        df: Pandas DataFrame with portfolio data
        account_id: Optional account ID to filter by
        portfolio_id: Optional portfolio ID to filter by

    Returns:
        Processed DataFrame with additional columns
    """
    try:
        if df.empty:
            return df

        # Make a copy to avoid SettingWithCopyWarning
        df = df.copy()

        # Calculate value in EUR
        df['value_eur'] = df.apply(
            lambda row: row.get('quantity', 0) * row.get('price_eur', 0)
            if row.get('price_eur') is not None else 0,
            axis=1
        )

        # Calculate value in original currency
        df['value'] = df.apply(
            lambda row: row.get('quantity', 0) * row.get('price', 0)
            if row.get('price') is not None else 0,
            axis=1
        )

        # Calculate totals
        total_value_eur = df['value_eur'].sum()

        # Calculate portfolio weights
        if total_value_eur > 0:
            df['weight'] = df['value_eur'] / total_value_eur
        else:
            df['weight'] = 0

        return df

    except Exception as e:
        logger.error(f"Error processing portfolio dataframe: {str(e)}")
        return df


def update_batch_prices_in_db(results):
    """Update market prices with results from batch processing."""
    success_count = 0
    modified_count = 0
    failed_count = 0

    try:
        for isin, result in results.items():
            if result.get('success') and result.get('price') is not None:
                # Check if we have a modified identifier
                modified_identifier = result.get('modified_identifier')

                if modified_identifier:
                    logger.info(
                        f"📝 Found modified identifier: {isin} -> {modified_identifier}")
                    modified_count += 1

                success = update_price_in_db(
                    isin,
                    result.get('price'),
                    result.get('currency', 'USD'),
                    result.get('price_eur', result.get('price')),
                    result.get('country'),
                    modified_identifier      # Pass modified_identifier if present
                )

                if success:
                    success_count += 1
                    if modified_identifier:
                        logger.info(
                            f"✅ Successfully updated price AND identifier for {isin} -> {modified_identifier}")
                else:
                    failed_count += 1
                    logger.warning(f"❌ Failed to update price for {isin}")

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
