"""
Decorators for Flask routes.

Provides reusable decorators for common route patterns.
Philosophy: DRY - Don't Repeat Yourself.
"""

from app.decorators.auth import require_auth

__all__ = ['require_auth']
