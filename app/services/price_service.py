"""
Business logic for price operations and calculations.

Pure Python - no Flask dependencies.
Philosophy: Simple, clear price calculations and conversions.
"""

from typing import Dict, Optional
from decimal import Decimal
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class PriceService:
    """
    Service for price-related calculations.

    Handles currency conversion, price validation, etc.
    """

    @staticmethod
    def convert_to_eur(
        amount: Decimal,
        from_currency: str,
        exchange_rates: Dict[str, Decimal]
    ) -> Decimal:
        """
        Convert amount to EUR using provided rates.

        Args:
            amount: Amount to convert
            from_currency: Source currency (USD, EUR, etc.)
            exchange_rates: Dict of {currency: rate_to_eur}

        Returns:
            Amount in EUR
        """
        if from_currency == 'EUR':
            return amount

        rate = exchange_rates.get(from_currency, Decimal('1.0'))
        return amount * rate

    @staticmethod
    def validate_price_data(price_data: Dict) -> tuple[bool, Optional[str]]:
        """
        Validate price data structure and values.

        Args:
            price_data: Price data dict from yfinance

        Returns:
            (is_valid, error_message)
        """
        required_fields = ['regularMarketPrice', 'currency']

        for field in required_fields:
            if field not in price_data:
                return False, f"Missing required field: {field}"

        price = price_data.get('regularMarketPrice')
        if price is None or price <= 0:
            return False, f"Invalid price: {price}"

        return True, None

    @staticmethod
    def calculate_price_change(
        current_price: Decimal,
        previous_price: Decimal
    ) -> tuple[Decimal, Decimal]:
        """
        Calculate price change amount and percentage.

        Args:
            current_price: Current price
            previous_price: Previous price

        Returns:
            (change_amount, change_percentage)
        """
        if previous_price == 0:
            return Decimal('0'), Decimal('0')

        change_amount = current_price - previous_price
        change_percentage = (change_amount / previous_price) * 100

        return change_amount, change_percentage

    @staticmethod
    def calculate_average_price(prices: list[Decimal]) -> Decimal:
        """
        Calculate average price from a list of prices.

        Args:
            prices: List of prices

        Returns:
            Average price
        """
        if not prices:
            return Decimal('0')

        return sum(prices) / len(prices)

    @staticmethod
    def calculate_weighted_average_price(
        prices_and_weights: list[tuple[Decimal, Decimal]]
    ) -> Decimal:
        """
        Calculate weighted average price.

        Args:
            prices_and_weights: List of (price, weight) tuples

        Returns:
            Weighted average price
        """
        if not prices_and_weights:
            return Decimal('0')

        total_weight = sum(weight for _, weight in prices_and_weights)

        if total_weight == 0:
            return Decimal('0')

        weighted_sum = sum(
            price * weight
            for price, weight in prices_and_weights
        )

        return weighted_sum / total_weight

    @staticmethod
    def format_price(
        price: Decimal,
        currency: str = 'EUR',
        decimal_places: int = 2
    ) -> str:
        """
        Format price for display.

        Args:
            price: Price to format
            currency: Currency code
            decimal_places: Number of decimal places

        Returns:
            Formatted price string
        """
        formatted = f"{price:.{decimal_places}f}"

        currency_symbols = {
            'EUR': '€',
            'USD': '$',
            'GBP': '£',
            'CHF': 'CHF',
            'JPY': '¥'
        }

        symbol = currency_symbols.get(currency, currency)

        return f"{symbol}{formatted}"

    @staticmethod
    def is_stale_price(
        last_updated: datetime,
        max_age_hours: int = 24
    ) -> bool:
        """
        Check if price is stale based on age.

        Args:
            last_updated: When the price was last updated
            max_age_hours: Maximum age in hours before considered stale

        Returns:
            True if price is stale
        """
        # Handle timezone-aware vs naive datetime comparison
        now = datetime.now(timezone.utc) if last_updated.tzinfo else datetime.now()

        # If last_updated is timezone-aware, convert now to UTC for comparison
        if last_updated.tzinfo and now.tzinfo is None:
            now = datetime.now(timezone.utc)
        elif last_updated.tzinfo is None and now.tzinfo:
            now = now.replace(tzinfo=None)

        age = now - last_updated
        age_hours = age.total_seconds() / 3600

        return age_hours > max_age_hours
