"""
Input validation utilities.

Centralized validation logic with clear error messages.
Philosophy: Simple, clear, and reusable validation functions.
"""

from typing import Any, Optional, List
from decimal import Decimal, InvalidOperation
import re
import logging

logger = logging.getLogger(__name__)


class ValidationResult:
    """Result of a validation check"""

    def __init__(self, is_valid: bool, error: Optional[str] = None):
        self.is_valid = is_valid
        self.error = error

    def __bool__(self):
        return self.is_valid


def validate_number(
    value: Any,
    field_name: str,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    allow_zero: bool = True
) -> ValidationResult:
    """
    Validate that value is a valid number.

    Args:
        value: Value to validate
        field_name: Field name for error messages
        min_value: Minimum allowed value (inclusive)
        max_value: Maximum allowed value (inclusive)
        allow_zero: Whether zero is allowed

    Returns:
        ValidationResult
    """
    # Check if it's a number
    try:
        num = float(value)
    except (ValueError, TypeError):
        return ValidationResult(False, f"{field_name} must be a number")

    # Check zero
    if not allow_zero and num == 0:
        return ValidationResult(False, f"{field_name} cannot be zero")

    # Check min
    if min_value is not None and num < min_value:
        return ValidationResult(
            False,
            f"{field_name} must be at least {min_value}"
        )

    # Check max
    if max_value is not None and num > max_value:
        return ValidationResult(
            False,
            f"{field_name} must be at most {max_value}"
        )

    return ValidationResult(True)


def validate_string(
    value: Any,
    field_name: str,
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
    pattern: Optional[str] = None,
    required: bool = True
) -> ValidationResult:
    """
    Validate string value.

    Args:
        value: Value to validate
        field_name: Field name for error messages
        min_length: Minimum string length
        max_length: Maximum string length
        pattern: Regex pattern to match
        required: Whether field is required

    Returns:
        ValidationResult
    """
    # Check required
    if not value and required:
        return ValidationResult(False, f"{field_name} is required")

    if not value and not required:
        return ValidationResult(True)

    # Convert to string
    str_value = str(value)

    # Check min length
    if min_length is not None and len(str_value) < min_length:
        return ValidationResult(
            False,
            f"{field_name} must be at least {min_length} characters"
        )

    # Check max length
    if max_length is not None and len(str_value) > max_length:
        return ValidationResult(
            False,
            f"{field_name} must be at most {max_length} characters"
        )

    # Check pattern
    if pattern and not re.match(pattern, str_value):
        return ValidationResult(
            False,
            f"{field_name} format is invalid"
        )

    return ValidationResult(True)


def validate_choice(
    value: Any,
    field_name: str,
    choices: List[Any]
) -> ValidationResult:
    """
    Validate value is in allowed choices.

    Args:
        value: Value to validate
        field_name: Field name for error messages
        choices: List of allowed values

    Returns:
        ValidationResult
    """
    if value not in choices:
        choices_str = ', '.join(str(c) for c in choices)
        return ValidationResult(
            False,
            f"{field_name} must be one of: {choices_str}"
        )

    return ValidationResult(True)


def validate_decimal(
    value: Any,
    field_name: str,
    max_decimal_places: int = 2
) -> ValidationResult:
    """
    Validate decimal value.

    Args:
        value: Value to validate
        field_name: Field name for error messages
        max_decimal_places: Maximum decimal places allowed

    Returns:
        ValidationResult
    """
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return ValidationResult(False, f"{field_name} must be a valid decimal")

    # Check decimal places
    decimal_tuple = decimal_value.as_tuple()
    if decimal_tuple.exponent < -max_decimal_places:
        return ValidationResult(
            False,
            f"{field_name} can have at most {max_decimal_places} decimal places"
        )

    return ValidationResult(True)


def validate_isin(isin: str) -> ValidationResult:
    """
    Validate ISIN format.

    ISIN format: 2 letter country code + 9 alphanumeric + 1 check digit
    Example: US0378331005

    Args:
        isin: ISIN to validate

    Returns:
        ValidationResult
    """
    if not isin:
        return ValidationResult(False, "ISIN is required")

    isin = isin.strip().upper()

    # Check length
    if len(isin) != 12:
        return ValidationResult(False, "ISIN must be 12 characters")

    # Check format
    if not re.match(r'^[A-Z]{2}[A-Z0-9]{9}[0-9]$', isin):
        return ValidationResult(
            False,
            "ISIN format invalid (expected: 2 letters + 9 alphanumeric + 1 digit)"
        )

    return ValidationResult(True)


def validate_currency(currency: str) -> ValidationResult:
    """
    Validate currency code.

    Args:
        currency: Currency code (USD, EUR, etc.)

    Returns:
        ValidationResult
    """
    valid_currencies = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD']

    if not currency:
        return ValidationResult(False, "Currency is required")

    currency = currency.strip().upper()

    if currency not in valid_currencies:
        return ValidationResult(
            False,
            f"Currency must be one of: {', '.join(valid_currencies)}"
        )

    return ValidationResult(True)


# Composite validators for common use cases

def validate_investment_amount(amount: Any) -> ValidationResult:
    """Validate investment amount"""
    result = validate_number(
        amount,
        "Investment amount",
        min_value=0.01,
        max_value=1_000_000_000,
        allow_zero=False
    )

    if not result:
        return result

    return validate_decimal(amount, "Investment amount", max_decimal_places=2)


def validate_allocation_mode(mode: str) -> ValidationResult:
    """Validate allocation calculation mode"""
    return validate_choice(
        mode,
        "Allocation mode",
        choices=['proportional', 'target_weights', 'equal_weight']
    )


def validate_shares_amount(shares: Any) -> ValidationResult:
    """Validate number of shares"""
    return validate_number(
        shares,
        "Shares",
        min_value=0,
        allow_zero=True
    )


def validate_percentage(value: Any, field_name: str = "Percentage") -> ValidationResult:
    """Validate percentage value (0-100)"""
    result = validate_number(
        value,
        field_name,
        min_value=0,
        max_value=100,
        allow_zero=True
    )

    if not result:
        return result

    return validate_decimal(value, field_name, max_decimal_places=2)
