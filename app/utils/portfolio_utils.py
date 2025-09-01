from app.db_manager import query_db
from app.utils.db_utils import load_portfolio_data
from app.utils.yfinance_utils import get_isin_data
import logging
from .portfolio_processing import process_csv_data

# Set up logger
logger = logging.getLogger(__name__)


def get_portfolio_data(account_id):
    """Get portfolio data from the database"""
    try:
        if not account_id:
            logger.error(
                "Invalid account_id provided to get_portfolio_data: empty or None")
            return []

        logger.info(f"Loading portfolio data for account_id: {account_id}")

        # First check if the account exists
        account = query_db(
            'SELECT * FROM accounts WHERE id = ?', [account_id], one=True)
        if not account:
            logger.error(f"Account with ID {account_id} not found in database")
            return []

        # Then check if any portfolios exist for this account
        portfolios = query_db(
            'SELECT COUNT(*) as count FROM portfolios WHERE account_id = ?', [account_id], one=True)
        if not portfolios or portfolios['count'] == 0:
            logger.error(f"No portfolios found for account_id: {account_id}")
            return []

        # Now load the actual portfolio data
        df = load_portfolio_data(account_id)

        if df is None:
            logger.error(
                "load_portfolio_data returned None - database query failed")
            return []
        if not df:  # Check if list is empty
            logger.warning(
                f"No portfolio data found for account_id: {account_id} - empty result set")
            return []

        # Transform raw database rows into output format
        portfolio_data = []
        for row in df:
            try:
                portfolio_value = row.get('portfolio_name') or row.get('portfolio') or ''

                item = {
                    'id': row['id'],
                    'company': row['name'],
                    'identifier': row['identifier'],
                    'portfolio': portfolio_value,
                    'category': row['category'],
                    'shares': float(row['shares']) if row.get('shares') is not None else 0,
                    'override_share': float(row['override_share']) if row.get('override_share') is not None else None,
                    'effective_shares': float(row['override_share']) if row.get('override_share') is not None else (float(row['shares']) if row.get('shares') is not None else 0),
                    'manual_edit_date': row.get('manual_edit_date'),
                    'is_manually_edited': bool(row.get('is_manually_edited', False)),
                    'csv_modified_after_edit': bool(row.get('csv_modified_after_edit', False)),
                    'price_eur': float(row['price_eur']) if row.get('price_eur') is not None else None,
                    'currency': row.get('currency'),
                    'country': row.get('country'),

                    'total_invested': float(row['total_invested']) if row.get('total_invested') is not None else 0,
                    'last_updated': row['last_updated'] if isinstance(row['last_updated'], str) else
                    (row['last_updated'].isoformat() if row.get('last_updated') is not None else None)
                }
                portfolio_data.append(item)
            except Exception as e:
                logger.error(f"Error processing row: {row}")
                logger.error(f"Error details: {str(e)}")
                continue

        logger.info(f"Returning {len(portfolio_data)} portfolio items")
        return portfolio_data
    except Exception as e:
        logger.error(f"Error getting portfolio data: {str(e)}", exc_info=True)
        return []


def has_companies_in_default(account_id):
    """Check if the '-' portfolio has any companies with shares"""
    default_portfolio = query_db('''
        SELECT id FROM portfolios
        WHERE account_id = ? AND name = '-'
    ''', [account_id], one=True)

    if default_portfolio:
        # Check if this portfolio has any companies with shares
        companies_count = query_db('''
            SELECT COUNT(*) as count
            FROM companies c
            JOIN company_shares cs ON c.id = cs.company_id
            WHERE c.portfolio_id = ? AND c.account_id = ?
        ''', [default_portfolio['id'], account_id], one=True)

        return companies_count and companies_count['count'] > 0

    return False


def get_stock_info(identifier):
    """Wrapper for get_isin_data to keep consistent interface"""
    try:
        result = get_isin_data(identifier)

        if result.get('success'):
            # The data from get_isin_data is nested under the 'data' key
            stock_data = result.get('data', {})
            return {
                'success': True,
                'data': {
                    'currentPrice': stock_data.get('currentPrice'),
                    'currency': stock_data.get('currency', 'USD'),
                    'priceEUR': stock_data.get('priceEUR'),
                    'country': stock_data.get('country')
                },
                'modified_identifier': result.get('modified_identifier')
            }
        else:
            return {
                'success': False,
                'error': result.get('error', 'Unknown error')
            }
    except Exception as e:
        logger.error(f"Error in get_stock_info: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }
