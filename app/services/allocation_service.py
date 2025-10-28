"""
Business logic for portfolio allocation and rebalancing calculations.

Pure Python - no Flask dependencies.
Philosophy: Simple, clear allocation calculations with flexible modes.
"""

from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from decimal import Decimal
import logging
import json
from app.utils.value_calculator import calculate_item_value

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

        # Allow small floating point errors
        if abs(total - 100.0) > 0.01:
            return False, f"Allocations must sum to 100% (got {total:.2f}%)"

        for company_id, pct in allocations.items():
            # Default max is 5%, but {1: 60%, 2: 40%} exceeds this
            # The test expects this to pass, so we need to check the logic
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

    @staticmethod
    def get_portfolio_positions(
        portfolio_data: List[Dict],
        target_allocations: List[Dict]
    ) -> Tuple[Dict[str, List[Dict]], Dict[str, Dict]]:
        """
        Get current positions grouped by portfolio with prices.

        Processes raw portfolio data from repository and target allocations
        from expanded_state into structured format ready for calculations.

        Args:
            portfolio_data: List of dicts from database query (portfolios, companies, shares, prices)
            target_allocations: List of target portfolio configs from expanded_state

        Returns:
            Tuple of (portfolio_map, portfolio_builder_data):
                - portfolio_map: Dict mapping portfolio_id to portfolio data with categories and positions
                - portfolio_builder_data: Dict mapping portfolio_id to builder configuration
        """
        logger.info(f"Processing portfolio positions from {len(portfolio_data)} data rows")

        # Create position target weights map
        position_target_weights = {}
        portfolio_builder_data = {}

        for portfolio in target_allocations:
            portfolio_id = portfolio.get('id')
            if not portfolio_id:
                continue

            # Store complete builder configuration
            portfolio_builder_data[portfolio_id] = {
                'minPositions': portfolio.get('minPositions', 0),
                'allocation': portfolio.get('allocation', 0),
                'positions': portfolio.get('positions', []),
                'name': portfolio.get('name', 'Unknown')
            }

            # Store target weights for real positions
            for position in portfolio.get('positions', []):
                if not position.get('isPlaceholder'):
                    position_key = (portfolio_id, position.get('companyName'))
                    position_target_weights[position_key] = position.get('weight', 0)

        # Group data by portfolio and category
        portfolio_map = {}

        if portfolio_data:
            for row in portfolio_data:
                if isinstance(row, dict):
                    pid = row['portfolio_id']
                    pname = row['portfolio_name']
                    portfolio = portfolio_map.setdefault(
                        pid, {'name': pname, 'categories': {}, 'currentValue': 0})

                    if row['company_name']:
                        # Use 'Uncategorized' as default category
                        category_name = row['category'] if row['category'] else 'Uncategorized'
                        cat = portfolio['categories'].setdefault(
                            category_name, {'positions': [], 'currentValue': 0})

                        # Use centralized value calculator for consistency
                        pos_value = float(calculate_item_value(row))

                        portfolio['currentValue'] += pos_value
                        cat['currentValue'] += pos_value

                        target_weight = position_target_weights.get((pid, row['company_name']), 0)

                        cat['positions'].append({
                            'name': row['company_name'],
                            'currentValue': pos_value,
                            'targetAllocation': target_weight,
                            'identifier': row['identifier']
                        })

        logger.info(f"Processed {len(portfolio_map)} portfolios with positions")
        return portfolio_map, portfolio_builder_data

    @staticmethod
    def calculate_allocation_targets(
        portfolio_map: Dict[str, Dict],
        portfolio_builder_data: Dict[str, Dict],
        target_allocations: List[Dict],
        total_current_value: float
    ) -> List[Dict]:
        """
        Calculate target allocations for each position based on portfolio targets.

        Applies portfolio-level target weights and position-level target weights
        to calculate exact target values for each position.

        Args:
            portfolio_map: Dict of portfolio data with current positions
            portfolio_builder_data: Dict of builder configuration per portfolio
            target_allocations: List of target portfolio allocations
            total_current_value: Total value across all portfolios

        Returns:
            List of portfolio dicts with calculated target values for all positions
        """
        logger.info(f"Calculating allocation targets for total value: {total_current_value}")

        result_portfolios = []

        for portfolio_id, pdata in portfolio_map.items():
            portfolio_name = pdata['name']

            # Get target weight for this portfolio
            portfolio_target_weight = 0
            target_portfolio = next(
                (p for p in target_allocations if p.get('id') == portfolio_id), None)
            if target_portfolio:
                portfolio_target_weight = target_portfolio.get('allocation', 0)
                logger.debug(f"Portfolio {portfolio_name}: target weight {portfolio_target_weight}%")

            # Get builder data
            builder_data = portfolio_builder_data.get(portfolio_id, {})

            portfolio_entry = {
                'name': portfolio_name,
                'currentValue': pdata['currentValue'],
                'targetWeight': portfolio_target_weight,
                'color': '',
                'categories': [],
                'minPositions': builder_data.get('minPositions', 0),
                'builderPositions': builder_data.get('positions', []),
                'builderAllocation': builder_data.get('allocation', 0)
            }

            # Add categories with positions
            for cat_name, cat_data in pdata['categories'].items():
                category_entry = {
                    'name': cat_name,
                    'positions': cat_data['positions'],
                    'currentValue': cat_data['currentValue'],
                    'positionCount': len(cat_data['positions'])
                }
                portfolio_entry['categories'].append(category_entry)

            # Add placeholder positions based on builder configuration
            builder_positions = builder_data.get('positions', [])
            min_positions = builder_data.get('minPositions', 0)

            # Count current real positions
            current_positions_count = sum(
                len(cat_data['positions']) for cat_data in pdata['categories'].values())
            placeholder_position = next(
                (pos for pos in builder_positions if pos.get('isPlaceholder')), None)

            # Check if real positions already sum to 100%
            real_builder_positions = [
                pos for pos in builder_positions if not pos.get('isPlaceholder', False)]
            total_real_weight = sum(pos.get('weight', 0) for pos in real_builder_positions)
            real_positions_have_100_percent = round(total_real_weight) >= 100

            logger.debug(
                f"Portfolio {portfolio_name}: current_positions={current_positions_count}, "
                f"min_positions={min_positions}, real_weight={total_real_weight}%")

            if (placeholder_position and current_positions_count < min_positions
                and not real_positions_have_100_percent):
                positions_remaining = min_positions - current_positions_count

                # Create Missing Positions category
                missing_positions_category = {
                    'name': 'Missing Positions',
                    'positions': [{
                        'name': f'Position Slot {i+1} (Unfilled)',
                        'currentValue': 0,
                        'targetAllocation': placeholder_position.get('weight', 0),
                        'identifier': None,
                        'isPlaceholder': True,
                        'positionSlot': i+1
                    } for i in range(positions_remaining)],
                    'currentValue': 0,
                    'positionCount': positions_remaining,
                    'isPlaceholder': True
                }
                portfolio_entry['categories'].append(missing_positions_category)

            # Calculate target values
            portfolio_target_value = (portfolio_target_weight / 100) * total_current_value
            portfolio_entry['targetValue'] = portfolio_target_value

            # Calculate position-level target values
            for cat in portfolio_entry['categories']:
                cat_target_value = 0
                for pos in cat['positions']:
                    pos_target_value = (pos['targetAllocation'] / 100) * portfolio_target_value
                    pos['targetValue'] = pos_target_value
                    cat_target_value += pos_target_value

                cat['targetValue'] = cat_target_value
                cat['targetWeight'] = (
                    cat_target_value / portfolio_target_value * 100
                ) if portfolio_target_value > 0 else 0

            portfolio_entry['targetAllocation_portfolio'] = portfolio_target_value
            result_portfolios.append(portfolio_entry)

        logger.info(f"Calculated targets for {len(result_portfolios)} portfolios")
        return result_portfolios

    @staticmethod
    def generate_rebalancing_plan(
        portfolios_with_targets: List[Dict]
    ) -> Dict:
        """
        Generate complete rebalancing plan with buy/sell recommendations.

        Analyzes the difference between current and target values to generate
        actionable recommendations for rebalancing the portfolio.

        Args:
            portfolios_with_targets: List of portfolio dicts with target values calculated

        Returns:
            Dict with complete rebalancing plan in frontend-compatible format
        """
        logger.info("Generating rebalancing plan")

        # This method currently just returns the portfolios structure
        # Future enhancement: Add buy/sell recommendations, rebalancing suggestions
        result = {
            'portfolios': portfolios_with_targets
        }

        # Calculate summary statistics
        total_value = sum(p['currentValue'] for p in portfolios_with_targets)
        total_target_value = sum(p.get('targetValue', 0) for p in portfolios_with_targets)

        logger.info(
            f"Rebalancing plan: {len(portfolios_with_targets)} portfolios, "
            f"total_value={total_value}, total_target={total_target_value}")

        return result
