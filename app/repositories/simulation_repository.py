"""
Repository for simulation data access.

Centralizes all simulation-related database queries for the allocation simulator.
Philosophy: Single source of truth for data access, optimized queries.
"""

from typing import List, Dict, Optional
from app.db_manager import query_db, execute_db, get_db
import json
import logging

logger = logging.getLogger(__name__)


class SimulationRepository:
    """Data access layer for saved simulations"""

    @staticmethod
    def get_all(account_id: int) -> List[Dict]:
        """
        Get all simulations for an account.

        Args:
            account_id: Account ID

        Returns:
            List of simulations (without full items data for list view)
        """
        query = '''
            SELECT
                s.id,
                s.name,
                s.scope,
                s.portfolio_id,
                p.name as portfolio_name,
                s.created_at,
                s.updated_at
            FROM simulations s
            LEFT JOIN portfolios p ON s.portfolio_id = p.id
            WHERE s.account_id = ?
            ORDER BY s.updated_at DESC
        '''

        results = query_db(query, [account_id])
        return results if results else []

    @staticmethod
    def get_by_id(simulation_id: int, account_id: int) -> Optional[Dict]:
        """
        Get a simulation by ID with full items data.

        Args:
            simulation_id: Simulation ID
            account_id: Account ID (for security)

        Returns:
            Simulation dict with parsed items or None
        """
        query = '''
            SELECT
                s.id,
                s.name,
                s.scope,
                s.portfolio_id,
                p.name as portfolio_name,
                s.items,
                s.created_at,
                s.updated_at
            FROM simulations s
            LEFT JOIN portfolios p ON s.portfolio_id = p.id
            WHERE s.id = ? AND s.account_id = ?
        '''

        result = query_db(query, [simulation_id, account_id], one=True)

        if result:
            # Parse items JSON
            try:
                result['items'] = json.loads(result['items']) if result['items'] else []
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse items for simulation {simulation_id}")
                result['items'] = []

        return result

    @staticmethod
    def create(
        account_id: int,
        name: str,
        scope: str,
        items: List[Dict],
        portfolio_id: Optional[int] = None
    ) -> int:
        """
        Create a new simulation.

        Args:
            account_id: Account ID
            name: Simulation name
            scope: 'global' or 'portfolio'
            items: List of simulation items
            portfolio_id: Portfolio ID (if scope='portfolio')

        Returns:
            New simulation ID
        """
        items_json = json.dumps(items)

        db = get_db()
        cursor = db.execute(
            '''INSERT INTO simulations
               (account_id, name, scope, portfolio_id, items)
               VALUES (?, ?, ?, ?, ?)''',
            [account_id, name, scope, portfolio_id, items_json]
        )
        simulation_id = cursor.lastrowid
        db.commit()

        logger.info(f"Created simulation '{name}' (id={simulation_id}) for account {account_id}")
        return simulation_id

    @staticmethod
    def update(
        simulation_id: int,
        account_id: int,
        name: Optional[str] = None,
        scope: Optional[str] = None,
        items: Optional[List[Dict]] = None,
        portfolio_id: Optional[int] = None
    ) -> bool:
        """
        Update an existing simulation.

        Args:
            simulation_id: Simulation ID
            account_id: Account ID (for security)
            name: New name (optional)
            scope: New scope (optional)
            items: New items list (optional)
            portfolio_id: New portfolio ID (optional)

        Returns:
            True if successful
        """
        # Build dynamic update query
        updates = []
        params = []

        if name is not None:
            updates.append('name = ?')
            params.append(name)

        if scope is not None:
            updates.append('scope = ?')
            params.append(scope)

        if items is not None:
            updates.append('items = ?')
            params.append(json.dumps(items))

        if portfolio_id is not None:
            updates.append('portfolio_id = ?')
            params.append(portfolio_id)

        if not updates:
            return False

        # Always update timestamp
        updates.append('updated_at = CURRENT_TIMESTAMP')

        # Add WHERE params
        params.extend([simulation_id, account_id])

        query = f'''
            UPDATE simulations
            SET {', '.join(updates)}
            WHERE id = ? AND account_id = ?
        '''

        rowcount = execute_db(query, params)
        success = rowcount is not None and rowcount > 0

        if success:
            logger.info(f"Updated simulation {simulation_id}")

        return success

    @staticmethod
    def delete(simulation_id: int, account_id: int) -> bool:
        """
        Delete a simulation.

        Args:
            simulation_id: Simulation ID
            account_id: Account ID (for security)

        Returns:
            True if successful
        """
        rowcount = execute_db(
            'DELETE FROM simulations WHERE id = ? AND account_id = ?',
            [simulation_id, account_id]
        )

        success = rowcount is not None and rowcount > 0

        if success:
            logger.info(f"Deleted simulation {simulation_id}")

        return success

    @staticmethod
    def exists(name: str, account_id: int, exclude_id: Optional[int] = None) -> bool:
        """
        Check if a simulation with the given name already exists.

        Args:
            name: Simulation name
            account_id: Account ID
            exclude_id: Optional ID to exclude (for updates)

        Returns:
            True if exists
        """
        if exclude_id:
            result = query_db(
                '''SELECT 1 FROM simulations
                   WHERE account_id = ? AND LOWER(name) = LOWER(?) AND id != ?''',
                [account_id, name, exclude_id], one=True
            )
        else:
            result = query_db(
                '''SELECT 1 FROM simulations
                   WHERE account_id = ? AND LOWER(name) = LOWER(?)''',
                [account_id, name], one=True
            )

        return result is not None
