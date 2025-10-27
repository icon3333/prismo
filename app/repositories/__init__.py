"""
Repository layer for data access.

Repositories handle all database operations.
Philosophy: Single source of truth for data access patterns.
"""

from app.repositories.portfolio_repository import PortfolioRepository

__all__ = ['PortfolioRepository']
