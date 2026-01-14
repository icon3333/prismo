"""
Business logic for portfolio operations.

Pure Python - no Flask dependencies.
Philosophy: Simple, testable calculations for portfolio analysis.
"""

from typing import List, Dict, Optional
from decimal import Decimal
import logging
from app.utils.value_calculator import calculate_item_value, calculate_portfolio_total

logger = logging.getLogger(__name__)


class PortfolioService:
    """
    Service for portfolio calculations and aggregations.

    All methods are pure functions - testable without database.
    """

    @staticmethod
    def calculate_portfolio_value(holdings: List[Dict]) -> Decimal:
        """
        Calculate total portfolio value from holdings.

        Uses centralized value calculator to ensure consistency.

        Args:
            holdings: List of holdings with shares and price_eur

        Returns:
            Total portfolio value in EUR
        """
        return calculate_portfolio_total(holdings)

    @staticmethod
    def calculate_asset_allocation(holdings: List[Dict]) -> Dict[str, Decimal]:
        """
        Calculate asset allocation by category.

        Args:
            holdings: List of holdings with category, shares, and price_eur

        Returns:
            Dict of {category: percentage}
        """
        total_value = PortfolioService.calculate_portfolio_value(holdings)

        # Handle both int 0 and Decimal('0') explicitly
        if not total_value or total_value == 0 or total_value == Decimal('0'):
            return {}

        category_values = {}

        for holding in holdings:
            category = holding.get('category', 'Unknown')
            shares = Decimal(str(holding.get('shares', 0)))
            price = Decimal(str(holding.get('price_eur', 0)))
            value = shares * price

            category_values[category] = category_values.get(category, Decimal('0')) + value

        # Convert to percentages
        category_percentages = {
            category: (value / total_value * 100)
            for category, value in category_values.items()
        }

        return category_percentages

    @staticmethod
    def calculate_geographic_allocation(holdings: List[Dict]) -> Dict[str, Decimal]:
        """
        Calculate allocation by country.

        Args:
            holdings: List of holdings with country, shares, and price_eur

        Returns:
            Dict of {country: percentage}
        """
        total_value = PortfolioService.calculate_portfolio_value(holdings)

        # Handle both int 0 and Decimal('0') explicitly
        if not total_value or total_value == 0 or total_value == Decimal('0'):
            return {}

        country_values = {}

        for holding in holdings:
            country = holding.get('country', 'Unknown')
            shares = Decimal(str(holding.get('shares', 0)))
            price = Decimal(str(holding.get('price_eur', 0)))
            value = shares * price

            country_values[country] = country_values.get(country, Decimal('0')) + value

        # Convert to percentages
        country_percentages = {
            country: (value / total_value * 100)
            for country, value in country_values.items()
        }

        return country_percentages

    @staticmethod
    def identify_underweight_positions(
        current_allocations: Dict[str, Decimal],
        target_allocations: Dict[str, Decimal],
        threshold: Decimal = Decimal('2.0')
    ) -> List[str]:
        """
        Identify positions that are underweight vs targets.

        Args:
            current_allocations: Current allocation percentages
            target_allocations: Target allocation percentages
            threshold: Minimum deviation to flag (default 2%)

        Returns:
            List of company IDs that are underweight
        """
        underweight = []

        for company_id, target_pct in target_allocations.items():
            current_pct = current_allocations.get(company_id, Decimal('0'))
            deviation = target_pct - current_pct

            if deviation >= threshold:
                underweight.append(company_id)

        return underweight

    @staticmethod
    def calculate_holding_value(shares: Decimal, price: Decimal) -> Decimal:
        """
        Calculate value of a single holding.

        Args:
            shares: Number of shares
            price: Price per share

        Returns:
            Total value
        """
        return shares * price

    @staticmethod
    def calculate_position_size(
        holding_value: Decimal,
        portfolio_value: Decimal
    ) -> Decimal:
        """
        Calculate position size as percentage of portfolio.

        Args:
            holding_value: Value of the holding
            portfolio_value: Total portfolio value

        Returns:
            Position size as percentage (0-100)
        """
        if portfolio_value == 0:
            return Decimal('0')

        return (holding_value / portfolio_value) * 100

    @staticmethod
    def aggregate_by_field(
        holdings: List[Dict],
        field_name: str
    ) -> Dict[str, Dict[str, Decimal]]:
        """
        Aggregate holdings by a specific field.

        Args:
            holdings: List of holdings
            field_name: Field to aggregate by (e.g., 'category', 'country')

        Returns:
            Dict of {field_value: {'value': total_value, 'percentage': pct}}
        """
        total_value = PortfolioService.calculate_portfolio_value(holdings)

        # Handle both int 0 and Decimal('0') explicitly
        if not total_value or total_value == 0 or total_value == Decimal('0'):
            return {}

        field_values = {}

        for holding in holdings:
            field_value = holding.get(field_name, 'Unknown')

            # Use centralized value calculator for consistency
            value = calculate_item_value(holding)

            if field_value not in field_values:
                field_values[field_value] = Decimal('0')

            field_values[field_value] += value

        # Convert to dict with value and percentage
        result = {}
        for field_value, value in field_values.items():
            result[field_value] = {
                'value': value,
                'percentage': (value / total_value * 100)
            }

        return result
