"""
Cache configuration module.

Separating cache instance from main.py prevents circular import issues.
Philosophy: Simple, single-purpose module for shared cache instance.
"""

from flask_caching import Cache

# Initialize cache instance (will be configured in main.py)
cache = Cache()
