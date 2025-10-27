from app.db_manager import query_db
from app.utils.db_utils import load_portfolio_data
from app.utils.yfinance_utils import get_isin_data
from app.repositories.portfolio_repository import PortfolioRepository
import logging
from .portfolio_processing import process_csv_data

# Set up logger
logger = logging.getLogger(__name__)


def get_portfolio_data(account_id):
    """
    Get portfolio data from the database.

    Refactored to use PortfolioRepository for cleaner architecture.
    Data fetching and transformation is now delegated to the repository layer.

    Args:
        account_id: Account ID to fetch data for

    Returns:
        List of enriched portfolio items
    """
    try:
        if not account_id:
            logger.error(
                "Invalid account_id provided to get_portfolio_data: empty or None")
            return []

        logger.info(f"Loading portfolio data for account_id: {account_id}")

        # Delegate to repository - single optimized query with all needed data
        portfolio_data = PortfolioRepository.get_portfolio_data_with_enrichment(account_id)

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
