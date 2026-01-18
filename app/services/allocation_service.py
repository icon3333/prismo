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


def _apply_type_constraints_recursive(
    positions: List[Dict],
    portfolio_target_value: float,
    max_stock_pct: float,
    max_etf_pct: float,
    portfolio_name: str,
    iteration: int = 0,
    max_iterations: int = 100
) -> List[Dict]:
    """
    Apply type constraints with recursive redistribution.

    Algorithm:
    1. Calculate each position's target percentage relative to portfolio
    2. Check if it exceeds the cap for its investment_type
    3. If capped, set to cap and redistribute excess to uncapped positions
    4. Repeat until convergence or all positions capped

    Args:
        positions: List of position dicts with targetValue and investment_type
        portfolio_target_value: Total target value for the portfolio
        max_stock_pct: Max percentage for Stock positions
        max_etf_pct: Max percentage for ETF positions
        portfolio_name: Portfolio name (for logging)
        iteration: Current iteration count (for recursion tracking)
        max_iterations: Maximum recursion depth

    Returns:
        List of positions with capping metadata
    """
    if iteration >= max_iterations:
        logger.error(f"Max iterations ({max_iterations}) reached for portfolio {portfolio_name}")
        return positions

    # Check for zero or negative portfolio value to prevent division by zero
    if portfolio_target_value <= 0:
        logger.warning(f"Portfolio {portfolio_name} has zero or negative target value ({portfolio_target_value}). Cannot apply type constraints.")
        # Return positions as-is with zero constrained values
        for pos in positions:
            pos['unconstrained_target_value'] = pos.get('targetValue', 0)
            pos['constrained_target_value'] = 0
            pos['is_capped'] = True
            pos['applicable_rule'] = 'zero_portfolio_value'
        return positions

    if iteration == 0:
        logger.debug(f"Starting type constraint application for portfolio {portfolio_name} with {len(positions)} positions")

    # Initialize metadata on first iteration
    if iteration == 0:
        for pos in positions:
            pos['unconstrained_target_value'] = pos.get('targetValue', 0)
            pos['constrained_target_value'] = pos.get('targetValue', 0)
            pos['is_capped'] = False
            pos['applicable_rule'] = None

    # Separate capped and uncapped positions
    capped_positions = [pos for pos in positions if pos.get('is_capped', False)]
    uncapped_positions = [pos for pos in positions if not pos.get('is_capped', False)]

    if not uncapped_positions:
        # All positions are capped - we're done
        logger.debug(f"All {len(positions)} positions are capped in portfolio {portfolio_name}")
        return positions

    # Calculate total value from capped positions
    capped_value = sum(pos['constrained_target_value'] for pos in capped_positions)
    available_value = portfolio_target_value - capped_value

    if available_value <= 0:
        logger.warning(f"No available value to distribute in portfolio {portfolio_name}")
        return positions

    # Track if any position got capped in this iteration
    any_capped_this_iteration = False

    # Calculate target percentages for uncapped positions
    for pos in uncapped_positions:
        # Calculate percentage relative to portfolio
        target_pct = (pos['constrained_target_value'] / portfolio_target_value) * 100

        # Get cap based on investment_type
        investment_type = pos.get('investment_type')
        if investment_type == 'Stock':
            cap_pct = max_stock_pct
            cap_rule = 'maxPerStock'
        elif investment_type == 'ETF':
            cap_pct = max_etf_pct
            cap_rule = 'maxPerETF'
        else:
            # NULL or unknown type - skip this position
            logger.warning(f"Position {pos['name']} has unknown investment_type: {investment_type}")
            pos['is_capped'] = True
            pos['constrained_target_value'] = 0
            pos['applicable_rule'] = 'unknown_type'
            any_capped_this_iteration = True
            continue

        # Check if exceeds cap
        if target_pct > cap_pct:
            # Cap this position
            capped_value = (cap_pct / 100) * portfolio_target_value
            excess = pos['constrained_target_value'] - capped_value

            pos['is_capped'] = True
            pos['constrained_target_value'] = capped_value
            pos['applicable_rule'] = cap_rule

            logger.debug(
                f"Capped {pos['name']} ({investment_type}) at {cap_pct}% "
                f"(was {target_pct:.2f}%), excess: {excess:.2f}")

            any_capped_this_iteration = True

    # If any position was capped, redistribute excess to remaining uncapped positions
    if any_capped_this_iteration:
        # Recalculate available value
        new_capped_positions = [pos for pos in positions if pos.get('is_capped', False)]
        new_uncapped_positions = [pos for pos in positions if not pos.get('is_capped', False)]

        if new_uncapped_positions:
            new_capped_value = sum(pos['constrained_target_value'] for pos in new_capped_positions)
            new_available_value = portfolio_target_value - new_capped_value

            if new_available_value > 0:
                # Calculate total weight of uncapped positions (from original targets)
                total_uncapped_weight = sum(
                    pos['unconstrained_target_value'] for pos in new_uncapped_positions)

                if total_uncapped_weight > 0:
                    # Redistribute proportionally to original weights
                    for pos in new_uncapped_positions:
                        weight_ratio = pos['unconstrained_target_value'] / total_uncapped_weight
                        pos['constrained_target_value'] = weight_ratio * new_available_value
                else:
                    # Equal distribution if no weights
                    equal_share = new_available_value / len(new_uncapped_positions)
                    for pos in new_uncapped_positions:
                        pos['constrained_target_value'] = equal_share

        # Recurse to check if newly redistributed positions now exceed caps
        return _apply_type_constraints_recursive(
            positions=positions,
            portfolio_target_value=portfolio_target_value,
            max_stock_pct=max_stock_pct,
            max_etf_pct=max_etf_pct,
            portfolio_name=portfolio_name,
            iteration=iteration + 1,
            max_iterations=max_iterations
        )

    # No positions capped this iteration - we've converged
    logger.debug(
        f"Converged after {iteration + 1} iterations for portfolio {portfolio_name}. "
        f"Capped: {len(capped_positions)}, Uncapped: {len(uncapped_positions)}")

    return positions


@dataclass
class AllocationRule:
    """Rules for portfolio allocation limits"""
    max_stock_percentage: float = 5.0
    max_etf_percentage: float = 10.0
    max_sector_percentage: float = 25.0
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
        target_allocations: List[Dict],
        rules: Dict = None
    ) -> Tuple[Dict[str, List[Dict]], Dict[str, Dict]]:
        """
        Get current positions grouped by portfolio with prices.

        Processes raw portfolio data from repository and target allocations
        from expanded_state into structured format ready for calculations.

        Args:
            portfolio_data: List of dicts from database query (portfolios, companies, shares, prices)
            target_allocations: List of target portfolio configs from expanded_state
            rules: Dict with maxPerStock, maxPerETF, etc. (optional)

        Returns:
            Tuple of (portfolio_map, portfolio_builder_data):
                - portfolio_map: Dict mapping portfolio_id to portfolio data with categories and positions
                - portfolio_builder_data: Dict mapping portfolio_id to builder configuration
        """
        logger.info(f"Processing portfolio positions from {len(portfolio_data)} data rows")

        # Extract default weights from rules
        default_stock_weight = float(rules.get('maxPerStock', 2.0)) if rules else 2.0
        default_etf_weight = float(rules.get('maxPerETF', 5.0)) if rules else 5.0

        # Build mapping of company names to investment types from portfolio_data
        company_investment_types = {}
        for row in portfolio_data:
            if isinstance(row, dict) and row.get('company_name'):
                company_investment_types[row['company_name']] = row.get('investment_type')

        # Helper function to get default weight based on investment type
        # NOTE: When no explicit position weights are set in the Build page,
        # we use the maxPerStock/maxPerETF rules as the TARGET allocation.
        # This means: "Give each Stock/ETF this percentage of the portfolio"
        # The same rules also serve as CAPS (enforced by type constraints later)
        def get_default_weight(company_name: str) -> float:
            investment_type = company_investment_types.get(company_name)
            if investment_type == 'Stock':
                return default_stock_weight
            elif investment_type == 'ETF':
                return default_etf_weight
            else:
                # For other types (Crypto, etc.), return 0 (no default)
                return 0.0

        # Create position target weights map
        position_target_weights = {}
        portfolio_builder_data = {}

        for portfolio in target_allocations:
            portfolio_name = portfolio.get('name')
            if not portfolio_name:
                continue

            # Store complete builder configuration - keyed by NAME for reliable matching
            # (Portfolio IDs in saved state can become stale; names are unique per account)
            portfolio_builder_data[portfolio_name] = {
                'minPositions': portfolio.get('minPositions', 0),
                'allocation': portfolio.get('allocation', 0),
                'positions': portfolio.get('positions', []),
                'name': portfolio_name
            }

            # Check if portfolio has ONLY placeholders (no explicit positions)
            # This indicates user wants equal distribution using placeholder weight
            real_positions = [p for p in portfolio.get('positions', []) if not p.get('isPlaceholder')]
            placeholder_positions = [p for p in portfolio.get('positions', []) if p.get('isPlaceholder')]
            has_only_placeholders = len(real_positions) == 0 and len(placeholder_positions) > 0

            # Extract placeholder weight if it exists
            placeholder_weight = None
            if has_only_placeholders and placeholder_positions:
                placeholder_weight = placeholder_positions[0].get('weight')

            # Store target weights for real positions
            # Priority: explicit weight from Build page > placeholder weight > type-based default
            # Key by (portfolio_name, company_name) for reliable matching
            for position in portfolio.get('positions', []):
                if not position.get('isPlaceholder'):
                    company_name = position.get('companyName')
                    position_key = (portfolio_name, company_name)

                    # Use explicit weight if provided
                    explicit_weight = position.get('weight')
                    if explicit_weight is not None and explicit_weight > 0:
                        position_target_weights[position_key] = float(explicit_weight)
                    else:
                        default_weight = get_default_weight(company_name)
                        position_target_weights[position_key] = default_weight

            # If portfolio has only placeholders, mark it for equal distribution
            if has_only_placeholders and placeholder_weight and portfolio_name in portfolio_builder_data:
                portfolio_builder_data[portfolio_name]['use_placeholder_weight'] = True
                portfolio_builder_data[portfolio_name]['placeholder_weight'] = placeholder_weight

        # Group data by portfolio and sector
        portfolio_map = {}

        # NOTE: We no longer pre-initialize portfolio_map from target_allocations
        # This caused duplicate entries when portfolio IDs changed (recreated portfolios)
        # Instead, we only populate from actual database data and look up targets by NAME

        # Process actual positions from database
        if portfolio_data:
            for row in portfolio_data:
                if isinstance(row, dict):
                    pid = row['portfolio_id']
                    pname = row['portfolio_name']

                    # Ensure portfolio exists in map (may already be initialized above)
                    portfolio = portfolio_map.setdefault(
                        pid, {'name': pname, 'sectors': {}, 'currentValue': 0})

                    if row['company_name']:
                        # Use 'Uncategorized' as default sector
                        sector_name = row['sector'] if row['sector'] else 'Uncategorized'
                        cat = portfolio['sectors'].setdefault(
                            sector_name, {'positions': [], 'currentValue': 0})

                        # Use centralized value calculator for consistency
                        pos_value = float(calculate_item_value(row))

                        portfolio['currentValue'] += pos_value
                        cat['currentValue'] += pos_value

                        # Look up by portfolio NAME (not ID) for reliable matching
                        lookup_key = (pname, row['company_name'])
                        target_weight = position_target_weights.get(lookup_key, 0)

                        # Check if this portfolio uses placeholder-based equal distribution
                        builder_config = portfolio_builder_data.get(pname, {})
                        use_placeholder_weight = builder_config.get('use_placeholder_weight', False)
                        placeholder_weight_value = builder_config.get('placeholder_weight', None)

                        # If no target weight from Build page, determine default
                        if target_weight == 0:
                            # Priority: placeholder weight > type-based default
                            if use_placeholder_weight and placeholder_weight_value:
                                target_weight = float(placeholder_weight_value)
                            elif row.get('investment_type') in ['Stock', 'ETF']:
                                if row.get('investment_type') == 'Stock':
                                    target_weight = default_stock_weight
                                elif row.get('investment_type') == 'ETF':
                                    target_weight = default_etf_weight

                        position_data = {
                            'name': row['company_name'],
                            'currentValue': pos_value,
                            'targetAllocation': target_weight,
                            'identifier': row['identifier'],
                            'investment_type': row.get('investment_type')
                        }
                        cat['positions'].append(position_data)

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

            # Get target weight for this portfolio - match by NAME for reliable matching
            portfolio_target_weight = 0
            target_portfolio = next(
                (p for p in target_allocations if p.get('name') == portfolio_name), None)
            if target_portfolio:
                portfolio_target_weight = target_portfolio.get('allocation', 0)

            # Get builder data - keyed by portfolio NAME for reliable matching
            builder_data = portfolio_builder_data.get(portfolio_name, {})

            portfolio_entry = {
                'name': portfolio_name,
                'currentValue': pdata['currentValue'],
                'targetWeight': portfolio_target_weight,
                'color': '',
                'sectors': [],
                'minPositions': builder_data.get('minPositions', 0),
                'builderPositions': builder_data.get('positions', []),
                'builderAllocation': builder_data.get('allocation', 0)
            }

            # Add sectors with positions
            for sector_name, sector_data in pdata['sectors'].items():
                sector_entry = {
                    'name': sector_name,
                    'positions': sector_data['positions'],
                    'currentValue': sector_data['currentValue'],
                    'positionCount': len(sector_data['positions'])
                }
                portfolio_entry['sectors'].append(sector_entry)

            # Add placeholder positions based on builder configuration
            builder_positions = builder_data.get('positions', [])
            min_positions = builder_data.get('minPositions', 0)

            # Count current real positions
            current_positions_count = sum(
                len(sector_data['positions']) for sector_data in pdata['sectors'].values())
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

                # Create Missing Positions sector
                missing_positions_sector = {
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
                portfolio_entry['sectors'].append(missing_positions_sector)

            # Calculate target values
            portfolio_target_value = (portfolio_target_weight / 100) * total_current_value
            portfolio_entry['targetValue'] = portfolio_target_value

            # Calculate position-level target values
            for sector in portfolio_entry['sectors']:
                sector_target_value = 0
                for pos in sector['positions']:
                    pos_target_value = (pos['targetAllocation'] / 100) * portfolio_target_value
                    pos['targetValue'] = pos_target_value
                    sector_target_value += pos_target_value

                sector['targetValue'] = sector_target_value
                sector['targetWeight'] = (
                    sector_target_value / portfolio_target_value * 100
                ) if portfolio_target_value > 0 else 0

            portfolio_entry['targetAllocation_portfolio'] = portfolio_target_value
            result_portfolios.append(portfolio_entry)

        logger.info(f"Calculated targets for {len(result_portfolios)} portfolios")
        return result_portfolios

    @staticmethod
    def calculate_allocation_targets_with_type_constraints(
        portfolio_map: Dict[str, Dict],
        portfolio_builder_data: Dict[str, Dict],
        target_allocations: List[Dict],
        total_current_value: float,
        rules: Optional[Dict] = None
    ) -> List[Dict]:
        """
        Calculate allocation targets with Stock/ETF investment type constraints.

        Applies different caps based on investment_type:
        - Stock positions: Limited by maxPerStock
        - ETF positions: Limited by maxPerETF
        - NULL investment_type: Position skipped (not included in calculations)

        Uses recursive redistribution when positions hit caps.

        Args:
            portfolio_map: Dict of portfolio data with current positions
            portfolio_builder_data: Dict of builder configuration per portfolio
            target_allocations: List of target portfolio allocations
            total_current_value: Total value across all portfolios
            rules: Dict with maxPerStock, maxPerETF, etc. (optional)

        Returns:
            List of portfolio dicts with type-constrained target values and capping metadata
        """
        logger.info(f"Calculating type-constrained allocation targets for total value: {total_current_value}")

        # Parse rules - use consistent defaults matching get_portfolio_positions
        max_stock_pct = float(rules.get('maxPerStock', 2.0)) if rules else 2.0
        max_etf_pct = float(rules.get('maxPerETF', 5.0)) if rules else 5.0

        # First calculate unconstrained targets (same as regular allocation)
        portfolios = AllocationService.calculate_allocation_targets(
            portfolio_map=portfolio_map,
            portfolio_builder_data=portfolio_builder_data,
            target_allocations=target_allocations,
            total_current_value=total_current_value
        )

        # Now apply type constraints with recursive redistribution
        for portfolio in portfolios:
            portfolio_target_value = portfolio.get('targetValue', 0)

            if portfolio_target_value == 0:
                continue

            # Collect all positions (skip placeholders and NULL investment types)
            all_positions = []
            for sector in portfolio['sectors']:
                if sector.get('isPlaceholder'):
                    continue
                for position in sector['positions']:
                    if not position.get('isPlaceholder'):
                        all_positions.append(position)

            # Filter out positions with NULL investment_type
            valid_positions = [
                pos for pos in all_positions
                if pos.get('identifier') and pos.get('investment_type') is not None
            ]

            # Skip positions without investment_type (per user requirement)
            skipped_positions = [
                pos for pos in all_positions
                if pos.get('identifier') and pos.get('investment_type') is None
            ]

            if skipped_positions:
                logger.info(
                    f"Skipping {len(skipped_positions)} positions without investment_type in portfolio {portfolio['name']}")

            if not valid_positions:
                logger.warning(f"No valid positions with investment_type in portfolio {portfolio['name']}")
                continue

            # Apply iterative capping with redistribution
            all_positions_data = _apply_type_constraints_recursive(
                positions=valid_positions,
                portfolio_target_value=portfolio_target_value,
                max_stock_pct=max_stock_pct,
                max_etf_pct=max_etf_pct,
                portfolio_name=portfolio['name']
            )

            # Update positions with capping metadata
            position_lookup = {pos['name']: pos for pos in all_positions_data}

            for sector in portfolio['sectors']:
                if sector.get('isPlaceholder'):
                    continue
                for position in sector['positions']:
                    pos_name = position['name']
                    if pos_name in position_lookup:
                        augmented = position_lookup[pos_name]
                        position['is_capped'] = augmented.get('is_capped', False)
                        position['unconstrained_target_value'] = augmented.get('unconstrained_target_value', 0)
                        position['constrained_target_value'] = augmented.get('constrained_target_value', 0)
                        position['applicable_rule'] = augmented.get('applicable_rule', None)
                        position['targetValue'] = augmented['constrained_target_value']

            # Recalculate sector target values based on constrained position values
            for sector in portfolio['sectors']:
                if not sector.get('isPlaceholder'):
                    sector_target_value = sum(pos.get('targetValue', 0) for pos in sector['positions'])
                    sector['targetValue'] = sector_target_value
                    sector['targetWeight'] = (
                        sector_target_value / portfolio_target_value * 100
                    ) if portfolio_target_value > 0 else 0

        logger.info(f"Calculated type-constrained targets for {len(portfolios)} portfolios")
        return portfolios

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
