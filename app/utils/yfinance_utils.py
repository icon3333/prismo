import logging
import requests
from datetime import datetime
from typing import Dict, Any, Optional
import warnings
from app.exceptions import PriceFetchError
from app.cache import cache

# Lazy import yfinance to speed up module loading (yfinance takes 3-5 seconds to import)
_yf = None

def _get_yfinance():
    """Lazy load yfinance module to speed up application startup."""
    global _yf
    if _yf is None:
        import yfinance as yf
        _yf = yf
        # Suppress specific yfinance warnings when module is first loaded
        warnings.filterwarnings("ignore", message="^[Tt]he 'period'")
    return _yf

logger = logging.getLogger(__name__)

# Cache timeout constants (in seconds)
CACHE_TIMEOUT_STOCK_PRICES = 900      # 15 minutes - balance between freshness and API usage
CACHE_TIMEOUT_FAILED_LOOKUP = 300     # 5 minutes - prevent retry storms for invalid tickers

# --- Helper Functions ---


# How fresh a stored rate must be to skip the network entirely. Matches the
# 24h startup refresh cycle, so in normal operation requests never hit yfinance.
FRESH_RATE_MAX_AGE_HOURS = 24


def fetch_exchange_rate_from_network(from_currency: str, to_currency: str = "EUR") -> Optional[float]:
    """
    Fetch an exchange rate from yfinance. Returns None on any failure —
    callers decide the fallback (get_exchange_rate uses the newest stored
    DB rate; startup refresh skips the currency).
    """
    if from_currency == to_currency:
        return 1.0

    # yfinance uses 'GBp' for pence, which needs to be converted to 'GBP'
    if from_currency == 'GBp':
        from_currency = 'GBP'
        base_rate = 0.01
        if from_currency == to_currency:
            return base_rate
    else:
        base_rate = 1.0

    logger.info(f"Fetching exchange rate from network: {from_currency} → {to_currency}")
    try:
        ticker = f"{from_currency}{to_currency}=X"
        yf = _get_yfinance()
        rate = yf.Ticker(ticker).history(period='1d')['Close'].iloc[0]
        if rate and rate > 0:
            return float(rate) * base_rate
        logger.warning(f"Could not retrieve exchange rate for {from_currency}-{to_currency}")
        return None
    except (KeyError, IndexError, ValueError) as e:
        # Expected errors - missing data, empty dataframe, invalid values
        logger.warning(
            f"Exchange rate data issue: {from_currency}→{to_currency}: {e.__class__.__name__}: {e}",
            extra={'currency_from': from_currency, 'currency_to': to_currency}
        )
        return None
    except Exception:
        # Unexpected errors - log with full traceback
        logger.exception(
            f"Unexpected error fetching exchange rate: {from_currency}→{to_currency}"
        )
        return None


def get_exchange_rate(from_currency: str, to_currency: str = "EUR") -> Optional[float]:
    """
    Get the exchange rate between two currencies, DB-first.

    Lookup order:
    1. Fresh DB rate (updated within FRESH_RATE_MAX_AGE_HOURS) — no network.
       Startup refreshes rates daily, so this is the hot path.
    2. yfinance fetch; successful fetches are persisted to the DB. Failures
       are negative-cached briefly to avoid retry storms — never long enough
       to block a good rate, since a fresh DB rate short-circuits above.
    3. Most recent stored rate regardless of age, with a staleness warning.

    Returns None only when no rate was ever stored AND the network fails.
    Never silently falls back to 1.0 — valuing a USD/GBP holding 1:1 to EUR
    is worse than reporting no value at all.
    """
    if from_currency == to_currency:
        return 1.0

    # yfinance uses 'GBp' for pence; rates are stored per whole-GBP pair
    if from_currency == 'GBp':
        from_currency = 'GBP'
        base_rate = 0.01
        if from_currency == to_currency:
            return base_rate
    else:
        base_rate = 1.0

    from app.repositories.exchange_rate_repository import ExchangeRateRepository

    rate = ExchangeRateRepository.get_fresh_rate(
        from_currency, to_currency, max_age_hours=FRESH_RATE_MAX_AGE_HOURS)
    if rate is not None:
        return rate * base_rate

    fail_key = f"fx_fail_{from_currency}_{to_currency}"
    if not cache.get(fail_key):
        fetched = fetch_exchange_rate_from_network(from_currency, to_currency)
        if fetched is not None:
            ExchangeRateRepository.upsert_rate(from_currency, fetched, to_currency)
            # value_calculator caches DB rates module-wide; force a re-read
            from app.utils.value_calculator import clear_exchange_rate_cache
            clear_exchange_rate_cache()
            return fetched * base_rate
        cache.set(fail_key, True, timeout=CACHE_TIMEOUT_FAILED_LOOKUP)

    stale_rate = ExchangeRateRepository.get_rate(from_currency, to_currency)
    if stale_rate is not None:
        logger.warning(
            f"Using stale exchange rate {from_currency}→{to_currency} = {stale_rate} "
            f"(network unavailable, rate older than {FRESH_RATE_MAX_AGE_HOURS}h)")
        return stale_rate * base_rate

    logger.error(
        f"No exchange rate available for {from_currency}→{to_currency}: "
        f"never stored and network fetch failed")
    return None

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


def get_isin_data(identifier: str) -> Dict[str, Any]:
    """
    Get stock/crypto data using fallback pattern instead of pre-normalization.

    Uses the new fallback approach: try original identifier first, then crypto format
    if rules suggest it. This replaces the expensive dual-testing during normalization.

    Uses manual caching that ONLY caches successful responses. Failed lookups are not
    cached, allowing immediate retries after fixing issues.
    """
    from .identifier_normalization import fetch_price_with_crypto_fallback

    # Check cache first
    cache_key = f"isin_data_{identifier}"
    cached = cache.get(cache_key)
    if cached:
        logger.debug(f"Cache HIT for {identifier}")
        return cached

    # Check negative cache (short TTL to prevent retry storms for invalid tickers)
    neg_cache_key = f"isin_fail_{identifier}"
    cached_fail = cache.get(neg_cache_key)
    if cached_fail:
        logger.debug(f"Negative cache HIT for {identifier}")
        return cached_fail

    logger.info(f"📥 get_isin_data called for: {identifier} (cache miss)")

    try:
        # Use the new fallback pattern
        data = fetch_price_with_crypto_fallback(identifier)

        if not data:
            error_msg = f"Cascade returned empty data for identifier {identifier}"
            logger.error(f"❌ {error_msg}")
            fail_result = {'success': False, 'error': error_msg}
            cache.set(neg_cache_key, fail_result, timeout=CACHE_TIMEOUT_FAILED_LOOKUP)
            return fail_result

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
            if exchange_rate is None:
                # No rate ever stored and network down: surface an unconverted
                # price (priceEUR=None) instead of a silently wrong 1:1 value
                data['priceEUR'] = None
                logger.warning(
                    f"No {currency}→EUR rate available; cannot convert price for {identifier}")
            else:
                data['priceEUR'] = price * exchange_rate
                logger.info(
                    f"Converted {price:.2f} {currency} to {data['priceEUR']:.2f} EUR (rate: {exchange_rate})")
        elif price is not None:
            data['priceEUR'] = price  # Already in EUR

        result = {
            'success': True,
            'data': {
                'currentPrice': data.get('price'),
                'priceEUR': data.get('priceEUR'),
                'currency': currency,
                'country': data.get('country')
            },
            'modified_identifier': effective_identifier
        }

        # Only cache successful responses (15 minutes). A result whose EUR
        # conversion failed is not cached, so the next call converts as soon
        # as an exchange rate becomes available.
        if price is not None and result['data']['priceEUR'] is None:
            logger.debug(f"Not caching {identifier}: EUR conversion unavailable")
        else:
            cache.set(cache_key, result, timeout=CACHE_TIMEOUT_STOCK_PRICES)
            logger.debug(f"Cached successful result for {identifier}")

        return result

    except Exception as e:
        error_msg = f"Exception in get_isin_data for {identifier}: {str(e)}"
        logger.exception(error_msg)
        fail_result = {'success': False, 'error': error_msg}
        cache.set(neg_cache_key, fail_result, timeout=CACHE_TIMEOUT_FAILED_LOOKUP)
        return fail_result


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
        yf = _get_yfinance()
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


# --- Other Utility Functions (can be expanded) ---


def get_yfinance_info(identifier: str) -> Dict[str, Any]:
    """
    Simple wrapper to get the full info dictionary from yfinance.

    Successful lookups are cached for 15 minutes; failures only for 5, so a
    transient error doesn't block a working lookup for the full window.
    """
    cache_key = f"yf_info_{identifier}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    logger.info(f"Fetching yfinance info (not cached) for: {identifier}")
    try:
        yf = _get_yfinance()
        info = yf.Ticker(identifier).info or {}
        cache.set(cache_key, info, timeout=CACHE_TIMEOUT_STOCK_PRICES)
        return info
    except Exception as e:
        logger.error(f"Could not get yfinance info for {identifier}: {e}")
        fail_result = {'error': str(e)}
        cache.set(cache_key, fail_result, timeout=CACHE_TIMEOUT_FAILED_LOOKUP)
        return fail_result


def auto_categorize_investment_type(identifier: str) -> Optional[str]:
    """
    Automatically determine investment type (Stock or ETF) with 99% confidence.

    Returns None if cannot determine with high confidence (field left empty for user to categorize).

    Uses yfinance quoteType field which is highly reliable for most securities:
    - "EQUITY" → Stock
    - "ETF" → ETF
    - "CRYPTOCURRENCY" → Crypto
    - Other/Missing → None (requires manual categorization)

    Args:
        identifier: The security identifier (ISIN, ticker, or crypto symbol)

    Returns:
        "Stock", "ETF", or None if cannot determine with 99% confidence
    """
    try:
        # Fetch yfinance info (cached) - rely on API for accurate categorization
        # Don't use heuristics as they can misclassify ETF tickers like VOO, SPY
        info = get_yfinance_info(identifier)

        if not info or 'error' in info:
            logger.debug(f"Could not fetch info for {identifier} - cannot auto-categorize")
            return None

        # Extract quoteType field
        quote_type = info.get('quoteType')

        if not quote_type:
            logger.debug(f"No quoteType field for {identifier} - cannot auto-categorize")
            return None

        # Map quoteType to investment type
        type_mapping = {
            'EQUITY': 'Stock',
            'ETF': 'ETF',
            'CRYPTOCURRENCY': 'Crypto',
        }

        investment_type = type_mapping.get(quote_type)

        if investment_type:
            logger.info(f"Auto-categorized {identifier} as {investment_type} (quoteType: {quote_type})")
            return investment_type
        else:
            logger.debug(f"Unknown quoteType '{quote_type}' for {identifier} - cannot auto-categorize")
            return None

    except Exception as e:
        logger.warning(f"Error during auto-categorization for {identifier}: {e}")
        return None


CACHE_TIMEOUT_HISTORICAL = 3600  # 1 hour - historical data doesn't change frequently

HISTORICAL_INTERVAL_MAP = {
    '1y': '1wk',
    '3y': '1wk',
    '5y': '1mo',
    '10y': '1mo',
    'max': '1mo',
}

VALID_PERIODS = set(HISTORICAL_INTERVAL_MAP.keys())


def _get_interval_for_date_range(start_date_str):
    """Pick a smart interval based on the span from start_date to today."""
    from datetime import datetime
    try:
        start = datetime.strptime(start_date_str, '%Y-%m-%d')
        span_days = (datetime.now() - start).days
        if span_days < 90:
            return '1d'
        elif span_days < 3 * 365:
            return '1wk'
        else:
            return '1mo'
    except (ValueError, TypeError):
        return '1mo'


@cache.memoize(timeout=CACHE_TIMEOUT_HISTORICAL)
def get_historical_prices(identifiers, period='1y', start_date=None):
    """
    Fetch historical close prices for a list of identifiers.

    Args:
        identifiers: List of yfinance-compatible ticker strings.
        period: One of '1y', '3y', '5y', '10y', 'max'.
        start_date: Optional YYYY-MM-DD string. When provided, overrides period
                    and fetches data from this date onwards.

    Returns:
        dict with 'series' (ticker → [{date, close}, ...]) and 'errors' list.
    """
    tickers = list(set(identifiers)) if isinstance(identifiers, list) else [identifiers]
    tickers = [t for t in tickers if t]  # Filter empty strings

    result = {'series': {}, 'errors': []}

    if not tickers:
        return result

    # Determine download kwargs based on start_date vs period
    if start_date:
        interval = _get_interval_for_date_range(start_date)
        download_kwargs = {'start': start_date, 'interval': interval}
    else:
        if period not in VALID_PERIODS:
            period = '1y'
        interval = HISTORICAL_INTERVAL_MAP[period]
        download_kwargs = {'period': period, 'interval': interval}

    try:
        yf = _get_yfinance()
        # yf.download returns different shapes for single vs multiple tickers
        df = yf.download(
            tickers,
            **download_kwargs,
            auto_adjust=True,
            progress=False,
            threads=True,
        )

        if df is None or df.empty:
            result['errors'].append('No data returned from yfinance')
            return result

        # Extract Close prices
        if 'Close' in df.columns or (hasattr(df.columns, 'get_level_values') and 'Close' in df.columns.get_level_values(0)):
            close_df = df['Close']
        else:
            close_df = df

        # Forward-fill missing values
        close_df = close_df.ffill()

        # Single ticker: close_df is a Series, not a DataFrame
        if len(tickers) == 1:
            ticker = tickers[0]
            if hasattr(close_df, 'to_frame'):
                close_df = close_df.to_frame(name=ticker)

        # Build series dict
        for ticker in tickers:
            try:
                if ticker in close_df.columns:
                    col = close_df[ticker].dropna()
                    if col.empty:
                        result['errors'].append(f'No data for {ticker}')
                        continue
                    result['series'][ticker] = [
                        {'date': idx.strftime('%Y-%m-%d'), 'close': round(float(val), 2)}
                        for idx, val in col.items()
                    ]
                else:
                    result['errors'].append(f'No column for {ticker}')
            except Exception as e:
                logger.warning(f'Error processing {ticker}: {e}')
                result['errors'].append(f'{ticker}: {str(e)}')

    except Exception as e:
        logger.error(f"Error fetching historical prices: {e}")
        result['errors'].append(str(e))

    return result

# (Add other historical data functions as needed)


# --- Cache Management Utilities ---

def clear_price_cache(identifier: str = None):
    """
    Clear price cache - single identifier or all price-related caches.

    This is the primary function to call before bulk price updates to ensure
    fresh data is fetched from yfinance.

    Args:
        identifier: If provided, clear cache for this identifier only.
                   If None, clear all price-related caches.

    Example:
        clear_price_cache("AAPL")  # Clear AAPL's cache
        clear_price_cache()        # Clear all price caches
    """
    if identifier:
        # Clear specific identifier - price data, negative cache, and info cache
        cache.delete(f"isin_data_{identifier}")
        cache.delete(f"isin_fail_{identifier}")
        cache.delete(f"yf_info_{identifier}")
        logger.info(f"✓ Cleared price cache for: {identifier}")
    else:
        # Clear entire cache (SimpleCache doesn't support pattern delete)
        cache.clear()
        logger.info(f"✓ Cleared entire price cache")


