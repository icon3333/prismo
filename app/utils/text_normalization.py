"""
Text normalization utilities for consistent field storage.

Normalizes sector and country to Title Case, trims thesis whitespace.
Prevents duplicate groupings in charts (e.g., "chile" vs "Chile").
"""


def normalize_sector(value):
    """Normalize sector to Title Case. Returns '' for empty/None."""
    if not value:
        return ''
    return value.strip().title()


def normalize_country(value):
    """Normalize country to Title Case. Returns '' for empty/None."""
    if not value:
        return ''
    return value.strip().title()


def normalize_thesis(value):
    """Normalize thesis to Title Case. Returns '' for empty/None."""
    if not value:
        return ''
    return value.strip().title()
