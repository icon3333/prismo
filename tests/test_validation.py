"""
Tests for input validation module.

Tests the validation.py module with various valid and invalid inputs.
"""

import pytest
from decimal import Decimal
from app.validation import (
    validate_number,
    validate_string,
    validate_choice,
    validate_decimal,
    validate_isin,
    validate_currency,
    validate_investment_amount,
    validate_allocation_mode,
    validate_shares_amount,
    validate_percentage
)


class TestNumberValidation:
    """Tests for validate_number function"""

    def test_valid_number(self):
        """Test number validation with valid input"""
        result = validate_number(100, "Amount", min_value=0, max_value=1000)
        assert result.is_valid is True
        assert result.error is None

    def test_number_too_small(self):
        """Test number validation fails for value below minimum"""
        result = validate_number(-5, "Amount", min_value=0)
        assert result.is_valid is False
        assert "at least 0" in result.error

    def test_number_too_large(self):
        """Test number validation fails for value above maximum"""
        result = validate_number(1500, "Amount", max_value=1000)
        assert result.is_valid is False
        assert "at most 1000" in result.error

    def test_not_a_number(self):
        """Test number validation fails for non-numeric input"""
        result = validate_number("abc", "Amount")
        assert result.is_valid is False
        assert "must be a number" in result.error

    def test_zero_not_allowed(self):
        """Test number validation with zero not allowed"""
        result = validate_number(0, "Amount", allow_zero=False)
        assert result.is_valid is False
        assert "cannot be zero" in result.error


class TestStringValidation:
    """Tests for validate_string function"""

    def test_valid_string(self):
        """Test string validation with valid input"""
        result = validate_string("Hello", "Name", min_length=2, max_length=10)
        assert result.is_valid is True

    def test_string_too_short(self):
        """Test string validation fails for string below minimum length"""
        result = validate_string("A", "Name", min_length=2)
        assert result.is_valid is False
        assert "at least 2 characters" in result.error

    def test_string_too_long(self):
        """Test string validation fails for string above maximum length"""
        result = validate_string("VeryLongString", "Name", max_length=5)
        assert result.is_valid is False
        assert "at most 5 characters" in result.error

    def test_required_string_missing(self):
        """Test string validation fails for missing required value"""
        result = validate_string("", "Name", required=True)
        assert result.is_valid is False
        assert "is required" in result.error

    def test_optional_string_missing(self):
        """Test string validation passes for missing optional value"""
        result = validate_string("", "Name", required=False)
        assert result.is_valid is True


class TestChoiceValidation:
    """Tests for validate_choice function"""

    def test_valid_choice(self):
        """Test choice validation with valid selection"""
        result = validate_choice("apple", "Fruit", choices=["apple", "banana", "orange"])
        assert result.is_valid is True

    def test_invalid_choice(self):
        """Test choice validation fails for invalid selection"""
        result = validate_choice("grape", "Fruit", choices=["apple", "banana", "orange"])
        assert result.is_valid is False
        assert "must be one of" in result.error


class TestDecimalValidation:
    """Tests for validate_decimal function"""

    def test_valid_decimal(self):
        """Test decimal validation with valid input"""
        result = validate_decimal(10.50, "Price", max_decimal_places=2)
        assert result.is_valid is True

    def test_too_many_decimal_places(self):
        """Test decimal validation fails for too many decimal places"""
        result = validate_decimal(10.123, "Price", max_decimal_places=2)
        assert result.is_valid is False
        assert "at most 2 decimal places" in result.error

    def test_invalid_decimal(self):
        """Test decimal validation fails for non-decimal input"""
        result = validate_decimal("not a number", "Price")
        assert result.is_valid is False
        assert "must be a valid decimal" in result.error


class TestISINValidation:
    """Tests for validate_isin function"""

    def test_valid_isin(self):
        """Test ISIN validation with valid format"""
        result = validate_isin("US0378331005")  # Apple
        assert result.is_valid is True

    def test_isin_too_short(self):
        """Test ISIN validation fails for short input"""
        result = validate_isin("US037833")
        assert result.is_valid is False
        assert "12 characters" in result.error

    def test_isin_invalid_format(self):
        """Test ISIN validation fails for invalid format"""
        result = validate_isin("1234567890AB")
        assert result.is_valid is False
        assert "format invalid" in result.error

    def test_isin_empty(self):
        """Test ISIN validation fails for empty input"""
        result = validate_isin("")
        assert result.is_valid is False
        assert "required" in result.error


class TestCurrencyValidation:
    """Tests for validate_currency function"""

    def test_valid_currency(self):
        """Test currency validation with valid code"""
        result = validate_currency("USD")
        assert result.is_valid is True

    def test_valid_currency_lowercase(self):
        """Test currency validation with lowercase input"""
        result = validate_currency("eur")
        assert result.is_valid is True

    def test_invalid_currency(self):
        """Test currency validation fails for invalid code"""
        result = validate_currency("XYZ")
        assert result.is_valid is False
        assert "must be one of" in result.error


class TestCompositeValidators:
    """Tests for composite validation functions"""

    def test_validate_investment_amount_valid(self):
        """Test investment amount validation with valid input"""
        result = validate_investment_amount(1000.50)
        assert result.is_valid is True

    def test_validate_investment_amount_zero(self):
        """Test investment amount validation fails for zero"""
        result = validate_investment_amount(0)
        assert result.is_valid is False

    def test_validate_investment_amount_negative(self):
        """Test investment amount validation fails for negative"""
        result = validate_investment_amount(-100)
        assert result.is_valid is False

    def test_validate_allocation_mode_valid(self):
        """Test allocation mode validation with valid mode"""
        result = validate_allocation_mode("proportional")
        assert result.is_valid is True

    def test_validate_allocation_mode_invalid(self):
        """Test allocation mode validation fails for invalid mode"""
        result = validate_allocation_mode("invalid_mode")
        assert result.is_valid is False

    def test_validate_shares_amount_valid(self):
        """Test shares amount validation with valid input"""
        result = validate_shares_amount(100)
        assert result.is_valid is True

    def test_validate_shares_amount_zero(self):
        """Test shares amount validation allows zero"""
        result = validate_shares_amount(0)
        assert result.is_valid is True

    def test_validate_percentage_valid(self):
        """Test percentage validation with valid input"""
        result = validate_percentage(50.5)
        assert result.is_valid is True

    def test_validate_percentage_too_high(self):
        """Test percentage validation fails for value over 100"""
        result = validate_percentage(150)
        assert result.is_valid is False
        assert "at most 100" in result.error
