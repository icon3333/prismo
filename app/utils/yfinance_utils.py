import logging
import yfinance as yf
import requests
from datetime import datetime
from typing import Dict, Any, Optional
import warnings
from app.exceptions import PriceFetchError
from app.cache import cache

# Suppress specific yfinance warnings
warnings.filterwarnings("ignore", message="^[Tt]he 'period'")
logger = logging.getLogger(__name__)

# --- Helper Functions ---


@cache.memoize(timeout=3600)  # Cache for 1 hour - exchange rates change infrequently
def get_exchange_rate(from_currency: str, to_currency: str = "EUR") -> float:
    """
    Fetch the exchange rate between two currencies.

    Cached for 1 hour to reduce API calls. Exchange rates don't change frequently
    enough to require real-time updates for a homeserver portfolio app.
    """
    logger.info(f"Fetching exchange rate (not cached): {from_currency} → {to_currency}")

    if from_currency == to_currency:
        return 1.0

    # yfinance uses 'GBp' for pence, which needs to be converted to 'GBP'
    if from_currency == 'GBp':
        from_currency = 'GBP'
        base_rate = 0.01
    else:
        base_rate = 1.0

    try:
        # Construct the currency pair ticker
        ticker = f"{from_currency}{to_currency}=X"
        rate_data = yf.Ticker(ticker)

        # Get the current price
        rate = rate_data.history(period='1d')['Close'].iloc[0]
        if rate:
            return rate * base_rate
        else:
            logger.warning(
                f"Could not retrieve exchange rate for {from_currency}-{to_currency}")
            return 1.0 * base_rate  # Fallback
    except (KeyError, IndexError, ValueError) as e:
        # Expected errors - missing data, empty dataframe, invalid values
        logger.warning(
            f"Exchange rate data issue: {from_currency}→{to_currency}: {e.__class__.__name__}: {e}",
            extra={'currency_from': from_currency, 'currency_to': to_currency}
        )
        return 1.0 * base_rate  # Fallback
    except Exception as e:
        # Unexpected errors - log with full traceback
        logger.exception(
            f"Unexpected error fetching exchange rate: {from_currency}→{to_currency}"
        )
        # For single-user homeserver, log but don't crash - return fallback
        return 1.0 * base_rate

# --- Helper Functions for Identifier Detection ---


def _is_valid_isin_format(identifier: str) -> bool:
    """
    Validate basic ISIN format requirements.

    ISIN format: 2-letter country code + 9 alphanumeric chars + 1 check digit = 12 total
    Example: US0378331005 (Apple)

    This is a basic format check - it doesn't validate the checksum.

    Args:
        identifier: String to check

    Returns:
        True if identifier matches basic ISIN format
    """
    if not identifier or len(identifier) != 12:
        return False

    # First 2 characters must be letters (country code)
    if not identifier[:2].isalpha():
        return False

    # Remaining 10 characters must be alphanumeric
    if not identifier[2:].isalnum():
        return False

    return True


def _is_likely_crypto(identifier: str) -> bool:
    """
    Determine if an identifier is likely a cryptocurrency.
    
    Since all traditional stocks will be ISINs (12 characters), 
    any short identifier (≤4 characters) that's alphabetic is likely crypto.
    This greatly simplifies the detection logic.
    """
    if not identifier:
        return False
    
    # Clean identifier
    clean_id = identifier.upper().strip()
    
    # ISINs are 12 characters - exclude them
    if len(clean_id) == 12 and clean_id[:2].isalpha() and clean_id[2:].isalnum():
        return False
    
    # Skip if it contains exchange suffixes (e.g., ".PA", ".L")
    if '.' in clean_id:
        return False
    
    # Short identifiers (≤4 chars) that are alphabetic are crypto
    # since all traditional stocks will be ISINs
    if len(clean_id) <= 4 and clean_id.isalpha():
        return True
    
    return False


# --- Main Data Fetching Function ---


@cache.memoize(timeout=900)  # Cache for 15 minutes - good balance for stock prices
def get_isin_data(identifier: str) -> Dict[str, Any]:
    """
    Get stock/crypto data using fallback pattern instead of pre-normalization.

    Uses the new fallback approach: try original identifier first, then crypto format
    if rules suggest it. This replaces the expensive dual-testing during normalization.

    Cached for 15 minutes to significantly reduce API calls while keeping prices
    reasonably fresh for a homeserver portfolio app.
    """
    from .identifier_normalization import fetch_price_with_crypto_fallback

    logger.info(f"Fetching data (not cached) with fallback for identifier: {identifier}")

    # Use the new fallback pattern
    data = fetch_price_with_crypto_fallback(identifier)
    
    if not data:
        logger.error(f"Failed to fetch data for identifier '{identifier}' with fallback")
        return {'success': False, 'error': f"Could not find data for identifier {identifier}."}

    # Get the effective identifier used (original or crypto format)
    effective_identifier = data.get('effective_identifier', identifier)
    
    # Set crypto-specific fields if identifier ends with -USD (crypto format)
    if effective_identifier.endswith('-USD'):
        data['country'] = 'N/A'
        logger.info(f"Using crypto identifier: {effective_identifier}")

    # --- Post-processing and Currency Conversion ---

    price = data.get('price')
    currency = data.get('currency', 'USD')

    # Convert price to EUR if not already
    if price is not None and currency != 'EUR':
        exchange_rate = get_exchange_rate(currency, "EUR")
        data['priceEUR'] = price * exchange_rate
        logger.info(
            f"Converted {price:.2f} {currency} to {data['priceEUR']:.2f} EUR (rate: {exchange_rate})")
    elif price is not None:
        data['priceEUR'] = price  # Already in EUR

    return {
        'success': True,
        'data': {
            'currentPrice': data.get('price'),
            'priceEUR': data.get('priceEUR'),
            'currency': currency,
            'country': data.get('country')
        },
        'modified_identifier': effective_identifier
    }


def _fetch_yfinance_data_robust(identifier: str) -> Optional[Dict[str, Any]]:
    """
    Robust yfinance data fetching using the exact same pattern as the working script.
    Handles yfinance session/cookie bugs by mimicking the working script's approach.
    """
    # Pre-validate ISIN format if it looks like an ISIN (12 chars)
    if len(identifier) == 12:
        if not _is_valid_isin_format(identifier):
            logger.warning(
                f"Invalid ISIN format for '{identifier}': "
                f"ISINs must be 12 characters with 2-letter country code"
            )
            return None

    try:
        # The working script shows this pattern works - follow it exactly
        ticker = yf.Ticker(identifier)

        # The working script uses this exact pattern for error handling
        try:
            info = ticker.info
        except (KeyError, ValueError, TypeError) as e:
            # Expected data issues
            logger.warning(f"Data error fetching ticker info for {identifier}: {e.__class__.__name__}: {e}")
            info = {}
        except Exception as e:
            # Unexpected errors - still catch but log differently
            logger.warning(f"Unexpected error fetching ticker info for {identifier}: {e.__class__.__name__}: {e}")
            info = {}

        # The working script checks for empty info like this
        if not info:
            logger.debug(f"Empty info dictionary for '{identifier}'")
            return None

        # The working script validates price data this way
        price = info.get('regularMarketPrice') or info.get('currentPrice')

        # The working script only proceeds if price exists
        if price is not None:
            return {
                'price': price,
                'currency': info.get('currency'),
                'country': info.get('country'),
            }
        else:
            logger.debug(f"No valid price found for '{identifier}'")
            return None

    except ValueError as e:
        # ISIN validation errors from yfinance - expected for invalid ISINs
        if "Invalid ISIN" in str(e):
            logger.warning(
                f"yfinance rejected identifier '{identifier}': {e}. "
                f"This may be an invalid ISIN checksum or unrecognized identifier."
            )
        else:
            logger.warning(f"Validation error for '{identifier}': {e}")
        return None
    except (requests.exceptions.RequestException, ConnectionError, TimeoutError) as e:
        # Network errors - expected in homeserver environment
        logger.warning(f"Network error for '{identifier}': {e.__class__.__name__}: {e}")
        return None
    except Exception as e:
        # Truly unexpected errors - log with traceback for debugging
        logger.exception(f"Unexpected error in yfinance lookup for '{identifier}'")
        return None


def _fetch_yfinance_data(identifier: str) -> Optional[Dict[str, Any]]:
    """
    Legacy function - redirects to robust implementation.
    """
    return _fetch_yfinance_data_robust(identifier)

# --- Other Utility Functions (can be expanded) ---


@cache.memoize(timeout=900)  # Cache for 15 minutes
def get_yfinance_info(identifier: str) -> Dict[str, Any]:
    """
    Simple wrapper to get the full info dictionary from yfinance.

    Cached for 15 minutes to reduce API load.
    """
    logger.info(f"Fetching yfinance info (not cached) for: {identifier}")
    try:
        ticker = yf.Ticker(identifier)
        return ticker.info
    except Exception as e:
        logger.error(f"Could not get yfinance info for {identifier}: {e}")
        return {'error': str(e)}


def get_historical_prices(identifiers, years=5):
    """Fetches historical price data for a list of identifiers."""
    try:
        end_date = datetime.now()
        start_date = end_date.replace(year=end_date.year - years)

        data = yf.download(identifiers, start=start_date,
                           end=end_date, auto_adjust=True)['Close']
        return data.fillna(method='ffill')
    except Exception as e:
        logger.error(f"Error fetching historical prices: {e}")
        return None

# (Add other historical data functions as needed)
