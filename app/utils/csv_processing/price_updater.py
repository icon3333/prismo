"""
Price Updater Module
Handles batch price updates from CSV or external APIs.
"""

import logging
from typing import List, Set
from app.db_manager import query_db
from app.utils.db_utils import update_price_in_db
from app.utils.yfinance_utils import get_isin_data

logger = logging.getLogger(__name__)


def update_prices_from_csv(
    account_id: int,
    positions_to_update: List[str],
    progress_callback=None
) -> List[str]:
    """
    Batch update prices for companies from external APIs.

    Args:
        account_id: Account ID for this import
        positions_to_update: List of company names to update
        progress_callback: Optional callback(current, total, message, status)

    Returns:
        List[str]: Identifiers that failed to update
    """
    # Get all identifiers for companies to update
    all_identifiers = set()
    failed_prices = []

    for company_name in positions_to_update:
        company = query_db(
            'SELECT id, identifier FROM companies WHERE name = ? AND account_id = ?',
            [company_name, account_id],
            one=True
        )
        if company and company['identifier']:
            all_identifiers.add(company['identifier'])
            logger.debug(f"Found identifier for {company_name}: {company['identifier']}")
        else:
            logger.debug(f"No identifier found for company: {company_name}")

    if not all_identifiers:
        logger.info("No identifiers found for price updates")
        return failed_prices

    logger.info(f"Starting price updates for {len(all_identifiers)} identifiers")

    total_identifiers = len(all_identifiers)
    processed_identifiers = 0

    # Update prices for each identifier
    for identifier in all_identifiers:
        processed_identifiers += 1

        if progress_callback:
            # Calculate progress: (api_calls_completed / total_api_calls) * 100%
            progress_percentage = int((processed_identifiers / total_identifiers) * 100)
            progress_callback(
                processed_identifiers,
                total_identifiers,
                f"API call {processed_identifiers}/{total_identifiers}: Fetching {identifier[:20]}...",
                "processing"
            )

        logger.info(f"Making API call {processed_identifiers}/{total_identifiers} for {identifier}")

        # Fetch price data
        success = _fetch_and_update_price(identifier)
        if not success:
            failed_prices.append(identifier)

    logger.info(
        f"Price updates completed: {processed_identifiers - len(failed_prices)} succeeded, "
        f"{len(failed_prices)} failed"
    )

    return failed_prices


def _fetch_and_update_price(identifier: str) -> bool:
    """
    Fetch price for a single identifier and update database.

    Args:
        identifier: Company identifier (ISIN, ticker, etc.)

    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # This is the actual API call - 1 call per stock
        result = get_isin_data(identifier)

        if result['success'] and result.get('price') is not None:
            price = result.get('price')
            currency = result.get('currency', 'USD')
            price_eur = result.get('price_eur', price)
            country = result.get('country')

            logger.info(f"API call successful for {identifier}: {price_eur} EUR")

            if not update_price_in_db(identifier, price, currency, price_eur, country):
                logger.warning(f"Failed to update price in database for {identifier}")
                return False

            return True
        else:
            error_reason = (
                "No price data returned" if result.get('success')
                else result.get('error', 'Unknown error')
            )
            logger.warning(f"API call failed for {identifier}: {error_reason}")
            return False

    except Exception as e:
        logger.error(f"API call exception for {identifier}: {str(e)}")
        return False


def get_identifiers_for_update(account_id: int, company_names: List[str]) -> Set[str]:
    """
    Get all identifiers for a list of company names.

    Args:
        account_id: Account ID
        company_names: List of company names

    Returns:
        Set[str]: Set of identifiers to update
    """
    identifiers = set()

    for company_name in company_names:
        company = query_db(
            'SELECT identifier FROM companies WHERE name = ? AND account_id = ?',
            [company_name, account_id],
            one=True
        )
        if company and company['identifier']:
            identifiers.add(company['identifier'])

    logger.info(f"Found {len(identifiers)} identifiers for price updates")
    return identifiers
