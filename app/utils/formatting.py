"""
Utility module for formatting numbers, currencies, percentages, and other data types.
This module provides a consistent interface for formatting values across the application.
"""

from typing import Union, Dict, Any, Optional
import pandas as pd


def format_number(
    value: Any,
    is_price: bool = False,
    as_integer: bool = False,
    decimals: Optional[int] = None
) -> str:
    """
    Central function for formatting numbers with appropriate separators and decimals.

    Args:
        value: Number to format (can be float, int, str, or None)
        is_price: If True, adjusts decimal points based on price magnitude
        as_integer: If True, formats as integer with thousand separators
        decimals: Override automatic decimal places (None for automatic)

    Returns:
        Formatted string representation of the number
    """
    # Handle None/NaN cases
    if pd.isna(value):
        return 'N/A'

    try:
        # Convert string inputs to float if needed
        if isinstance(value, str):
            value = float(value.replace(',', '').replace(
                '€', '').replace('%', '').strip())

        # Convert to float for consistency
        value = float(value)

        # Integer formatting
        if as_integer:
            return f"{int(value):,}"

        # Determine decimals for price values
        if is_price and decimals is None:
            if value < 1:
                decimals = 3
            elif value >= 100:
                decimals = 0
            elif value >= 10:
                decimals = 1
            else:
                decimals = 2

        # Use specified decimals or default
        decimals = 2 if decimals is None else decimals

        return f"{value:,.{decimals}f}"

    except (ValueError, TypeError):
        return '0'


def format_currency(value: Any, currency: str = "€") -> str:
    """
    Format a value as currency with symbol.
    Numbers >= 100 will be shown without decimals.

    Args:
        value: Amount to format
        currency: Currency symbol to use

    Returns:
        Formatted currency string
    """
    try:
        if pd.isna(value):
            return f"{currency}0"

        value = float(value)
        if value >= 100:
            return f'{currency}{value:,.0f}'
        else:
            return f'{currency}{value:,.2f}'
    except:
        return f"{currency}0"


def format_percentage(value: Any, decimals: int = 0, include_symbol: bool = True) -> str:
    """
    Format a value as a percentage.

    Args:
        value: Number to format as percentage
        decimals: Number of decimal places (defaults to 0)
        include_symbol: Whether to include the % symbol (defaults to True)

    Returns:
        Formatted percentage string
    """
    if pd.isna(value):
        return "0%" if include_symbol else "0"

    try:
        value = float(value)
        if value >= 100 or decimals == 0:
            result = f"{int(round(value))}"
        else:
            result = f"{value:.{decimals}f}"
        return f"{result}%" if include_symbol else result
    except (ValueError, TypeError):
        return "0%" if include_symbol else "0"


def format_percentage_with_sign(value: Any) -> str:
    """Format a number as a percentage with one decimal place and sign"""
    if pd.isna(value):
        return "+0.0%"

    try:
        value = float(value)
        return f"{value:+.1f}%"
    except (ValueError, TypeError):
        return "+0.0%"


def format_budget_number(value: Any) -> str:
    """Format budget numbers with thousand separators."""
    return format_number(value, as_integer=True)


def parse_number(value: Any) -> Optional[float]:
    """
    Central parsing function for converting formatted strings to numbers.

    Args:
        value: Value to parse (string, float, int, or None)

    Returns:
        Parsed float value or None if parsing fails
    """
    if pd.isna(value):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        try:
            # Remove formatting characters
            cleaned = value.replace('€', '').replace(
                ',', '').replace('%', '').strip()
            return float(cleaned)
        except ValueError:
            return None

    return None


def parse_input(value: str) -> Optional[float]:
    """
    Parse input string to float, handling various formats.
    Maintained for backwards compatibility.
    """
    return parse_number(value)


def parse_budget_input(value: str) -> float:
    """Parse budget input string to float."""
    result = parse_number(value)
    return float(result) if result is not None else 0.0


def parse_percentage_input(value: str, as_decimal: bool = False) -> Union[int, float]:
    """
    Parse percentage input string to number.

    Args:
        value: String to parse
        as_decimal: If True, returns decimal (0.03 for 3%), if False returns integer (3)

    Returns:
        Parsed number as int or float depending on as_decimal
    """
    result = parse_number(value)
    if result is None:
        return 0.0 if as_decimal else 0

    if as_decimal:
        return float(result) / 100
    return int(round(result))


def color_negative_red(value: float) -> str:
    """
    Generate color style for positive/negative values.

    Args:
        value: Number to check

    Returns:
        CSS color style string
    """
    if pd.isna(value):
        return ''
    return 'color: red' if value < 0 else 'color: green' if value > 0 else ''


def format_info_text(text: str) -> str:
    """
    Format informational text with consistent styling.
    Uses Material Design Blue (#2196F3) for a professional look.

    Args:
        text: Text to format

    Returns:
        HTML-formatted string with consistent styling
    """
    return f'<p style="color: #2196F3; font-style: italic; margin: 0; padding: 0;">{text}</p>'
