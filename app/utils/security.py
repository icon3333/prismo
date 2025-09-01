"""
Security utilities for the Flask application
"""
from functools import wraps
from flask import current_app


def rate_limit(limit_string):
    """
    Decorator to apply rate limiting to routes in production.
    Only applies rate limiting if the limiter is configured (production mode).
    
    Args:
        limit_string (str): Rate limit specification like "5 per minute"
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Apply rate limiting only if limiter is available (production)
            if hasattr(current_app, 'limiter'):
                # Apply the rate limit to this specific route
                limited_func = current_app.limiter.limit(limit_string)(f)
                return limited_func(*args, **kwargs)
            else:
                # No rate limiting in development
                return f(*args, **kwargs)
        return decorated_function
    return decorator 