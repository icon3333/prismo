"""Custom exceptions for Prismo.

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


class DataIntegrityError(PortfolioError):
    """
    Database constraint violation or data integrity issue.

    Examples:
    - Duplicate keys
    - Foreign key violations
    - Unique constraint violations
    - Invalid references
    """
    pass


class ExternalAPIError(PortfolioError):
    """
    External API or service failed.

    Examples:
    - yfinance API timeout
    - Currency conversion API down
    - Network errors
    - Rate limiting
    """
    pass


class AuthenticationError(PortfolioError):
    """
    Authentication required or failed.

    Examples:
    - No account_id in session
    - Invalid credentials
    - Account not found
    """
    pass


class NotFoundError(PortfolioError):
    """
    Requested resource not found.

    Examples:
    - Portfolio not found
    - Company not found
    - Account not found
    """
    def __init__(self, resource: str, identifier=None):
        self.resource = resource
        self.identifier = identifier
        if identifier:
            message = f"{resource} not found: {identifier}"
        else:
            message = f"{resource} not found"
        super().__init__(message)
