import logging
import yfinance as yf
from typing import Dict, Any
from .yfinance_utils import get_fresh_session

logger = logging.getLogger(__name__)


def get_price_for_ticker(ticker: str) -> Dict[str, Any]:
    """Get the current price and currency for a ticker symbol."""
    if not ticker:
        return {"price": None, "currency": None, "error": "No ticker provided", "success": False}

    logger.info(f"Getting price for ticker: {ticker}")
    price = None
    currency = None
    error_messages = []

    session = get_fresh_session()
    try:
        try:
            ticker_obj = yf.Ticker(
                ticker, session=session) if session is not None else yf.Ticker(ticker)
        except Exception as session_error:
            logger.warning(
                f"Error using custom session for {ticker}: {str(session_error)}")
            ticker_obj = yf.Ticker(ticker)

        try:
            info_result = [None]
            info_error = [None]

            def get_info():
                try:
                    info_result[0] = ticker_obj.info
                except Exception as e:
                    info_error[0] = str(e)

            import threading
            info_thread = threading.Thread(target=get_info)
            info_thread.daemon = True
            info_thread.start()
            # Reduced timeout from 10s to 3s - yfinance typically responds in 0.5-2s
            # 3s timeout handles slow networks while avoiding excessive waits
            info_thread.join(timeout=3)

            if info_error[0] is None and info_result[0] is not None:
                price = info_result[0].get("currentPrice")
                currency = info_result[0].get("currency")
            else:
                error_messages.append(info_error[0] or "Info fetch failed")
        except Exception as e:
            error_messages.append(str(e))

        if price is None:
            try:
                hist = ticker_obj.history(period="1d")
                if not hist.empty:
                    price = hist["Close"].iloc[-1]
                    currency = hist.attrs.get("currency", "USD")
            except Exception as e:
                error_messages.append(str(e))

        if price is None:
            logger.warning(
                f"Could not retrieve price for ticker {ticker}: {'; '.join(error_messages)}")
            return {"price": None, "currency": None, "error": '; '.join(error_messages), "success": False}

        return {"price": price, "currency": currency, "success": True}
    except Exception as e:
        logger.error(f"Error getting price for {ticker}: {str(e)}")
        return {"price": None, "currency": None, "error": str(e), "success": False}


def get_crypto_price(crypto_ticker: str) -> Dict[str, Any]:
    """Get the current price for a cryptocurrency ticker."""
    if not crypto_ticker:
        return {"price": None, "currency": None, "error": "No ticker provided", "success": False}

    if not crypto_ticker.endswith("-USD"):
        crypto_identifier = f"{crypto_ticker}-USD"
    else:
        crypto_identifier = crypto_ticker

    logger.info(f"Getting crypto price for {crypto_identifier}")
    price_result = get_price_for_ticker(crypto_identifier)
    return price_result


def get_exchange_rate(from_currency: str, to_currency: str = "EUR") -> float:
    """Get exchange rate between two currencies using yfinance."""
    pair = f"{from_currency}{to_currency}=X"
    logger.info(f"Getting exchange rate for {pair}")
    result = get_price_for_ticker(pair)
    if result["success"]:
        return result["price"] or 1.0
    return 1.0
