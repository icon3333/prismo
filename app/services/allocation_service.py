"""
Business logic for portfolio allocation and rebalancing calculations.

Pure Python - no Flask dependencies.
Philosophy: Simple, clear allocation calculations with flexible modes.
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)


@dataclass
class AllocationRule:
    """Rules for portfolio allocation limits"""
    max_stock_percentage: float = 5.0
    max_category_percentage: float = 25.0
    max_country_percentage: float = 10.0


@dataclass
class RebalancingRecommendation:
    """Single rebalancing recommendation"""
    company_name: str
    identifier: str
    current_value: Decimal
    target_value: Decimal
    amount_to_buy: Decimal
    shares_to_buy: Decimal
    current_price: Decimal


class AllocationService:
    """
    Service for calculating portfolio allocations and rebalancing.

    All methods are pure functions - no database or session access.
    Takes data as input, returns calculations as output.
    """

    def __init__(self, rules: Optional[AllocationRule] = None):
        self.rules = rules or AllocationRule()

    def calculate_rebalancing(
        self,
        portfolio_data: List[Dict],
        target_allocations: Dict[str, float],
        investment_amount: Decimal,
        mode: str = "proportional"
    ) -> List[RebalancingRecommendation]:
        """
        Calculate rebalancing recommendations.

        Args:
            portfolio_data: List of current holdings
            target_allocations: Dict of {company_id: target_percentage}
            investment_amount: Amount to invest
            mode: "proportional", "target_weights", or "equal_weight"

        Returns:
            List of RebalancingRecommendation objects
        """
        logger.info(f"Calculating rebalancing: mode={mode}, amount={investment_amount}")

        # Pure calculation logic here
        # No database calls, no session access

        if mode == "proportional":
            return self._calculate_proportional(
                portfolio_data, target_allocations, investment_amount
            )
        elif mode == "target_weights":
            return self._calculate_target_weights(
                portfolio_data, target_allocations, investment_amount
            )
        elif mode == "equal_weight":
            return self._calculate_equal_weight(
                portfolio_data, investment_amount
            )
        else:
            raise ValueError(f"Unknown allocation mode: {mode}")

    def _calculate_proportional(
        self,
        portfolio_data: List[Dict],
        target_allocations: Dict[str, float],
        investment_amount: Decimal
    ) -> List[RebalancingRecommendation]:
        """Distribute investment proportionally to target allocations"""
        recommendations = []

        for company_id, target_pct in target_allocations.items():
            # Find company in portfolio
            company = next(
                (c for c in portfolio_data if c['id'] == company_id),
                None
            )

            if not company or not company.get('price_eur'):
                continue

            # Calculate allocation
            allocation_amount = investment_amount * Decimal(target_pct / 100)
            current_price = Decimal(str(company['price_eur']))
            shares_to_buy = allocation_amount / current_price

            recommendation = RebalancingRecommendation(
                company_name=company['name'],
                identifier=company['identifier'],
                current_value=Decimal(str(company.get('current_value', 0))),
                target_value=allocation_amount,
                amount_to_buy=allocation_amount,
                shares_to_buy=shares_to_buy,
                current_price=current_price
            )

            recommendations.append(recommendation)

        return recommendations

    def _calculate_target_weights(
        self,
        portfolio_data: List[Dict],
        target_allocations: Dict[str, float],
        investment_amount: Decimal
    ) -> List[RebalancingRecommendation]:
        """
        Calculate to reach specific target weights.

        This mode calculates how much to buy to bring the portfolio
        closer to target weights after adding the investment amount.
        """
        recommendations = []

        # Calculate current total value
        current_total_value = sum(
            Decimal(str(c.get('current_value', 0)))
            for c in portfolio_data
        )

        # New total value after investment
        new_total_value = current_total_value + investment_amount

        for company_id, target_pct in target_allocations.items():
            # Find company in portfolio
            company = next(
                (c for c in portfolio_data if c['id'] == company_id),
                None
            )

            if not company or not company.get('price_eur'):
                continue

            current_value = Decimal(str(company.get('current_value', 0)))
            target_value = new_total_value * Decimal(target_pct / 100)

            # Amount to buy to reach target
            amount_to_buy = max(Decimal('0'), target_value - current_value)

            if amount_to_buy > 0:
                current_price = Decimal(str(company['price_eur']))
                shares_to_buy = amount_to_buy / current_price

                recommendation = RebalancingRecommendation(
                    company_name=company['name'],
                    identifier=company['identifier'],
                    current_value=current_value,
                    target_value=target_value,
                    amount_to_buy=amount_to_buy,
                    shares_to_buy=shares_to_buy,
                    current_price=current_price
                )

                recommendations.append(recommendation)

        return recommendations

    def _calculate_equal_weight(
        self,
        portfolio_data: List[Dict],
        investment_amount: Decimal
    ) -> List[RebalancingRecommendation]:
        """Distribute investment equally across all holdings"""
        recommendations = []

        # Filter holdings with valid prices
        valid_holdings = [
            c for c in portfolio_data
            if c.get('price_eur') and Decimal(str(c['price_eur'])) > 0
        ]

        if not valid_holdings:
            return recommendations

        # Equal amount per holding
        amount_per_holding = investment_amount / len(valid_holdings)

        for company in valid_holdings:
            current_price = Decimal(str(company['price_eur']))
            shares_to_buy = amount_per_holding / current_price

            recommendation = RebalancingRecommendation(
                company_name=company['name'],
                identifier=company['identifier'],
                current_value=Decimal(str(company.get('current_value', 0))),
                target_value=Decimal(str(company.get('current_value', 0))) + amount_per_holding,
                amount_to_buy=amount_per_holding,
                shares_to_buy=shares_to_buy,
                current_price=current_price
            )

            recommendations.append(recommendation)

        return recommendations

    def validate_allocations(
        self,
        allocations: Dict[str, float]
    ) -> tuple[bool, Optional[str]]:
        """
        Validate that allocations meet constraints.

        Args:
            allocations: Dict of {company_id: percentage}

        Returns:
            (is_valid, error_message)
        """
        total = sum(allocations.values())

        if abs(total - 100.0) > 0.01:
            return False, f"Allocations must sum to 100% (got {total:.2f}%)"

        for company_id, pct in allocations.items():
            if pct > self.rules.max_stock_percentage:
                return False, f"Stock allocation {pct}% exceeds max {self.rules.max_stock_percentage}%"

        return True, None

    def normalize_allocations(
        self,
        allocations: Dict[str, float]
    ) -> Dict[str, float]:
        """
        Normalize allocations to sum to 100%.

        Args:
            allocations: Dict of {company_id: percentage}

        Returns:
            Normalized allocations
        """
        total = sum(allocations.values())

        if total == 0:
            return allocations

        return {
            company_id: (pct / total) * 100
            for company_id, pct in allocations.items()
        }
