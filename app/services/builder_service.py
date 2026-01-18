"""
Service for Builder-related business logic.

Provides investment target data from Builder configuration for cross-page integration.
Pure Python - no Flask dependencies.
"""

import json
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


class BuilderService:
    """Handles Builder data operations for cross-page integration."""

    def __init__(self, db):
        """
        Initialize with database connection.

        Args:
            db: Database connection object with execute() method
        """
        self.db = db

    def get_investment_targets(self, account_id: int) -> Optional[Dict[str, Any]]:
        """
        Retrieve parsed investment targets from Builder configuration.

        Returns:
            Dict with budget and portfolio targets, or None if not configured.
            Structure:
            {
                'budget': {
                    'totalNetWorth': float,
                    'emergencyFund': float,
                    'alreadyInvested': float,
                    'totalInvestableCapital': float,
                    'availableToInvest': float
                },
                'portfolioTargets': [
                    {
                        'portfolioId': int,
                        'portfolioName': str,
                        'allocationPercent': float,
                        'targetAmount': float
                    }
                ],
                'totals': {
                    'totalTargetAmount': float,
                    'totalAllocationPercent': float
                },
                'lastUpdated': str (ISO timestamp) or None
            }
        """
        # Fetch saved state
        budget_data = self._get_saved_state(account_id, 'budgetData')
        portfolios_data = self._get_saved_state(account_id, 'portfolios')

        if not budget_data or not portfolios_data:
            logger.debug(f"No Builder data found for account {account_id}")
            return None

        try:
            budget = json.loads(budget_data)
            portfolios = json.loads(portfolios_data)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse Builder data for account {account_id}: {e}")
            return None

        # Validate required fields
        total_investable = float(budget.get('totalInvestableCapital', 0) or 0)
        if total_investable <= 0:
            logger.debug(f"No valid totalInvestableCapital for account {account_id}")
            return None

        # Build portfolio targets
        portfolio_targets = []
        total_allocation = 0

        for p in portfolios:
            allocation = float(p.get('allocation', 0) or 0)
            target_amount = total_investable * (allocation / 100)

            portfolio_targets.append({
                'portfolioId': p.get('id'),
                'portfolioName': p.get('name'),
                'allocationPercent': round(allocation, 2),
                'targetAmount': round(target_amount, 2)
            })
            total_allocation += allocation

        return {
            'budget': {
                'totalNetWorth': float(budget.get('totalNetWorth', 0) or 0),
                'emergencyFund': float(budget.get('emergencyFund', 0) or 0),
                'alreadyInvested': float(budget.get('alreadyInvested', 0) or 0),
                'totalInvestableCapital': total_investable,
                'availableToInvest': float(budget.get('availableToInvest', 0) or 0)
            },
            'portfolioTargets': portfolio_targets,
            'totals': {
                'totalTargetAmount': round(total_investable, 2),
                'totalAllocationPercent': round(total_allocation, 2)
            },
            'lastUpdated': self._get_last_updated(account_id)
        }

    def get_portfolio_target(self, account_id: int, portfolio_id: int) -> Optional[Dict[str, Any]]:
        """
        Get investment target for a specific portfolio.

        Args:
            account_id: Account ID
            portfolio_id: Portfolio ID to look up

        Returns:
            Dict with portfolio target info, or None if not found.
        """
        targets = self.get_investment_targets(account_id)
        if not targets:
            return None

        for pt in targets['portfolioTargets']:
            if pt['portfolioId'] == portfolio_id:
                return pt

        return None

    def get_investment_progress(self, account_id: int, portfolio_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Calculate investment progress combining Builder targets with current portfolio values.

        Args:
            account_id: Account ID
            portfolio_id: Optional portfolio ID for portfolio-specific progress

        Returns:
            Dict with progress info including target, current, remaining, and percent complete.
        """
        targets = self.get_investment_targets(account_id)
        if not targets:
            return None

        if portfolio_id:
            # Portfolio-specific progress
            portfolio_target = self.get_portfolio_target(account_id, portfolio_id)
            if not portfolio_target:
                return None

            return {
                'hasBuilderConfig': True,
                'portfolioName': portfolio_target['portfolioName'],
                'allocationPercent': portfolio_target['allocationPercent'],
                'targetAmount': portfolio_target['targetAmount'],
                # Note: currentValue and remainingToInvest will be calculated by the route
                # since it has access to the actual portfolio values
            }
        else:
            # Global progress
            return {
                'hasBuilderConfig': True,
                'targetAmount': targets['totals']['totalTargetAmount'],
                'availableToInvest': targets['budget']['availableToInvest'],
                'totalAllocationPercent': targets['totals']['totalAllocationPercent'],
            }

    def _get_saved_state(self, account_id: int, variable_name: str) -> Optional[str]:
        """
        Fetch saved state variable from database.

        Args:
            account_id: Account ID
            variable_name: Name of the variable to fetch

        Returns:
            Variable value as string, or None if not found.
        """
        cursor = self.db.execute(
            """
            SELECT variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = 'build' AND variable_name = ?
            """,
            (account_id, variable_name)
        )
        row = cursor.fetchone()
        return row['variable_value'] if row else None

    def _get_last_updated(self, account_id: int) -> Optional[str]:
        """
        Get last update timestamp for Builder data.

        Args:
            account_id: Account ID

        Returns:
            ISO timestamp string, or None if not available.
        """
        cursor = self.db.execute(
            """
            SELECT MAX(updated_at) as last_updated
            FROM expanded_state
            WHERE account_id = ? AND page_name = 'build'
            """,
            (account_id,)
        )
        row = cursor.fetchone()
        return row['last_updated'] if row and row['last_updated'] else None
