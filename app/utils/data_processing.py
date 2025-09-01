"""
Utility functions for data processing and cache management.
"""
from functools import wraps
from flask import g


def clear_data_caches():
    """
    Clear any cached data in the application context.
    This helps ensure fresh data is fetched when needed.
    """
    for attr in ('portfolio_data', 'cached_prices', 'cached_portfolios'):
        if hasattr(g, attr):
            delattr(g, attr)
