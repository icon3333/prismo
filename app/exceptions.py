"""Custom exceptions for portfolio rebalancer application.

These exceptions provide better error handling and debugging by making it clear
what type of error occurred, rather than catching generic Exception everywhere.
"""


class PortfolioError(Exception):
    """Base exception for all portfolio operations."""
    pass


class PriceFetchError(PortfolioError):
    """Failed to fetch price data from external API (yfinance)."""
    pass


class CSVProcessingError(PortfolioError):
    """Failed to process or parse CSV file."""
    pass


class DatabaseError(PortfolioError):
    """Database operation failed."""
    pass


class ValidationError(PortfolioError):
    """Data validation failed (invalid input, missing required fields, etc.)."""
    pass


class IdentifierError(PortfolioError):
    """Identifier normalization or mapping failed."""
    pass
