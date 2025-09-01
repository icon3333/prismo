import logging
import pandas as pd
import yfinance as yf
import datetime
from .yfinance_utils import get_fresh_session

logger = logging.getLogger(__name__)


def get_enhanced_historical_data(identifiers, years=5):
    """Fetch weekly historical prices for all identifiers."""
    if not identifiers:
        return pd.DataFrame()

    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=int(365 * years))

    try:
        logger.info(
            f"Requesting ~{years}y of data from {start_date} to {end_date} for {len(identifiers)} tickers.")
        session = get_fresh_session()
        try:
            if session is not None:
                data = yf.download(
                    tickers=list(set(identifiers)),
                    start=start_date,
                    end=end_date,
                    interval='1wk',
                    group_by='ticker',
                    progress=False,
                    threads=True,
                    auto_adjust=True,
                    session=session,
                )
            else:
                data = yf.download(
                    tickers=list(set(identifiers)),
                    start=start_date,
                    end=end_date,
                    interval='1wk',
                    group_by='ticker',
                    progress=False,
                    threads=True,
                    auto_adjust=True,
                )
        except Exception:
            data = yf.download(
                tickers=list(set(identifiers)),
                start=start_date,
                end=end_date,
                interval='1wk',
                group_by='ticker',
                progress=False,
                threads=True,
                auto_adjust=True,
            )
        return data
    except Exception as e:
        logger.error(f"Error fetching historical data: {str(e)}")
        return pd.DataFrame()


def get_historical_prices(identifiers, years=5):
    """Get historical price data for multiple identifiers."""
    end_date = datetime.datetime.now()
    start_date = end_date - datetime.timedelta(days=int(years * 365))
    period_str = f"{int(years * 52)}wk"
    logger.info(f"Using lookback period of {years} years ({period_str})")

    historical_data = pd.DataFrame()
    crypto_conversions = {}

    for identifier in identifiers:
        try:
            logger.info(f"Fetching historical prices for {identifier}...")
            session = get_fresh_session()
            try:
                if session is not None:
                    data = yf.download(
                        identifier,
                        period=period_str,
                        auto_adjust=True,
                        progress=False,
                        actions=False,
                        session=session,
                    )
                else:
                    data = yf.download(
                        identifier,
                        period=period_str,
                        auto_adjust=True,
                        progress=False,
                        actions=False,
                    )
            except Exception as e:
                logger.warning(
                    f"Download failed for {identifier} with period format: {e}")
                data = yf.download(
                    identifier,
                    start=start_date,
                    end=end_date,
                    auto_adjust=True,
                    progress=False,
                    actions=False,
                )

            if data.empty and not identifier.endswith('-USD'):
                crypto_identifier = f"{identifier}-USD"
                logger.info(f"Trying crypto identifier {crypto_identifier}")
                price_result = yf.download(
                    crypto_identifier,
                    period=period_str,
                    auto_adjust=True,
                    progress=False,
                    actions=False,
                )
                if not price_result.empty:
                    data = price_result
                    crypto_conversions[identifier] = crypto_identifier

            if not data.empty:
                data.index = pd.to_datetime(data.index)
                historical_data[identifier] = data['Close']
        except Exception as e:
            logger.error(f"Error fetching data for {identifier}: {str(e)}")
            continue

    return historical_data


def get_historical_returns(identifiers, years=5, freq='W'):
    """Get historical returns data for multiple identifiers."""
    prices = get_historical_prices(identifiers, years)
    if prices.empty:
        logger.warning("No historical price data found")
        return pd.DataFrame()
    if freq:
        prices = prices.resample(freq).last()
    returns = prices.pct_change().dropna()
    logger.info(f"Calculated returns with shape {returns.shape}")
    return returns
