"""
Simple Rule-Based Identifier Normalization for Crypto/Stock Detection

This module implements simple rule-based identifier normalization that automatically detects
and converts cryptocurrency symbols to their correct yfinance format (SYMBOL-USD)
while preserving stock tickers and ISINs in their original format.

Core concept: Use simple 5-rule system with fallback pattern instead of expensive dual-testing.
Fallback approach tries original format first, then crypto format if rules suggest it.
"""

import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def normalize_identifier(identifier: str) -> str:
    """
    Normalize identifier by cleaning up formatting only.

    Strategy 1: No format conversion - stores identifier exactly as entered.
    Cascade logic at fetch time determines correct format (stock vs crypto).

    This function only does basic cleanup:
    - Strip whitespace
    - Convert to uppercase

    No assumptions about whether it's crypto or stock.

    Args:
        identifier: Raw identifier from CSV/user input

    Returns:
        Cleaned identifier (trimmed, uppercase, no format changes)
    """
    if not identifier or not identifier.strip():
        logger.warning("Empty identifier provided to normalize_identifier")
        return identifier

    clean_identifier = identifier.strip().upper()
    logger.info(f"Cleaned identifier: '{identifier}' -> '{clean_identifier}'")

    return clean_identifier


def fetch_price_with_crypto_fallback(identifier: str) -> Dict[str, Any]:
    """
    Two-step cascade for price fetching with ISIN-aware logic.

    Process:
    1. Try original identifier (1 API call)
    2. If failed AND not an ISIN, try {identifier}-USD format (1 more API call)
    3. Return result with effective_identifier

    ISINs (12-char identifiers with 2-letter country code) skip the -USD suffix
    attempt since ISINs are never cryptocurrencies.

    Args:
        identifier: Identifier to fetch price for (cleaned but not converted)

    Returns:
        Price data dictionary with 'effective_identifier' showing which format worked
    """
    from .yfinance_utils import _fetch_yfinance_data_robust, _is_valid_isin_format

    logger.info(f"Two-step cascade for: '{identifier}'")

    # Check if this is an ISIN (12 chars, 2-letter country code)
    is_isin = _is_valid_isin_format(identifier)

    # Step 1: Try original identifier
    logger.debug(f"  Step 1: Trying original format '{identifier}'")
    result = _fetch_yfinance_data_robust(identifier)

    if result:
        logger.info(f"  ✓ Original format successful: {identifier}")
        return {**result, 'effective_identifier': identifier}

    # Step 2: Only try crypto format (-USD suffix) for non-ISINs
    if not is_isin:
        crypto_identifier = f"{identifier}-USD"
        logger.info(f"  Step 2: Original failed, trying crypto format: {identifier} → {crypto_identifier}")

        result = _fetch_yfinance_data_robust(crypto_identifier)

        if result:
            logger.info(f"  ✓ Crypto format successful: {crypto_identifier}")
            return {**result, 'effective_identifier': crypto_identifier}

        logger.warning(f"  ✗ Both formats failed: '{identifier}' and '{crypto_identifier}'")
    else:
        logger.warning(f"  ✗ ISIN lookup failed: '{identifier}' - yfinance may not support this ISIN directly")

    return {}
