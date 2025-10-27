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

    logger.info(f"📥 get_isin_data called for: {identifier}")

    try:
        # Use the new fallback pattern
        data = fetch_price_with_crypto_fallback(identifier)

        if not data:
            error_msg = f"Cascade returned empty data for identifier {identifier}"
            logger.error(f"❌ {error_msg}")
            return {'success': False, 'error': error_msg}

        logger.debug(f"Cascade returned data keys: {list(data.keys())}")

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

    except Exception as e:
        error_msg = f"Exception in get_isin_data for {identifier}: {str(e)}"
        logger.exception(error_msg)
        return {'success': False, 'error': error_msg}


def _fetch_yfinance_data_robust(identifier: str) -> Optional[Dict[str, Any]]:
    """
    Simplified yfinance data fetching matching the working Colab script pattern.

    Matches behavior from working script:
    - Direct access to ticker.info (no aggressive exception handling)
    - Multiple price field fallbacks (regularMarketPrice, currentPrice, previousClose)
    - Clear logging showing which field was used
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
        # Create ticker object (matches working script)
        ticker = yf.Ticker(identifier)

        # Access info directly like working script - no inner try/except
        # Let exceptions propagate to outer handler
        info = ticker.info

        # Validate we got meaningful data
        if not info or not isinstance(info, dict):
            logger.debug(f"Empty or invalid info for '{identifier}'")
            return None

        logger.debug(f"Got info for {identifier} with {len(info)} fields")

        # Try multiple price fields (matches working script availability)
        # Working script shows currentPrice and previousClose are available
        regularMarketPrice = info.get('regularMarketPrice')
        currentPrice = info.get('currentPrice')
        previousClose = info.get('previousClose')

        # Cascade through available price fields
        price = regularMarketPrice or currentPrice or previousClose

        # Log which field was used (helpful for debugging)
        if price is not None:
            if regularMarketPrice:
                source = 'regularMarketPrice'
            elif currentPrice:
                source = 'currentPrice'
            else:
                source = 'previousClose'

            logger.info(f"✓ Found price for {identifier}: {price} (from {source})")

            return {
                'price': price,
                'currency': info.get('currency'),
                'country': info.get('country'),
            }
        else:
            logger.debug(
                f"No price available for '{identifier}' - "
                f"regularMarketPrice={regularMarketPrice}, "
                f"currentPrice={currentPrice}, "
                f"previousClose={previousClose}"
            )
            return None

    except ValueError as e:
        # ISIN validation errors from yfinance
        if "Invalid ISIN" in str(e):
            logger.warning(f"yfinance rejected identifier '{identifier}': {e}")
        else:
            logger.warning(f"Validation error for '{identifier}': {e}")
        return None
    except (requests.exceptions.RequestException, ConnectionError, TimeoutError) as e:
        # Network errors - expected in homeserver environment
        logger.warning(f"Network error for '{identifier}': {e.__class__.__name__}: {e}")
        return None
    except Exception as e:
        # Unexpected errors - log with traceback for debugging
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


# --- Cache Management Utilities ---

def clear_identifier_cache(identifier: str = None):
    """
    Clear cached price data for specific identifier or entire cache.

    Useful for testing and debugging when an identifier's cached failure
    prevents retrying after code fixes.

    Args:
        identifier: If provided, clear cache for this identifier only.
                   If None, clear entire cache.

    Example:
        clear_identifier_cache("TNK")  # Clear TNK's cache
        clear_identifier_cache()       # Clear all price caches
    """
    if identifier:
        # Clear specific identifier from both caches
        cache.delete_memoized(get_isin_data, identifier)
        cache.delete_memoized(get_yfinance_info, identifier)
        logger.info(f"✓ Cleared cache for identifier: {identifier}")
    else:
        # Clear entire cache (use sparingly)
        cache.clear()
        logger.info(f"✓ Cleared entire price cache")
