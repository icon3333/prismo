"""
CSV Parser Module
Handles CSV file parsing with validation and column mapping.
Supports both Parqet and IBKR Flex Query CSV formats with auto-detection.
"""

import pandas as pd
import io
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Module-level constants for transaction type normalization
# Using frozenset for O(1) lookup instead of list O(n) - 10-20% faster for large CSVs
_BUY_TYPES = frozenset(['buy', 'purchase', 'bought', 'acquire', 'deposit'])
_SELL_TYPES = frozenset(['sell', 'sold', 'dispose', 'withdrawal'])
_TRANSFERIN_TYPES = frozenset(['transferin', 'transfer in', 'transfer-in', 'move in', 'movein', 'deposit'])
_TRANSFEROUT_TYPES = frozenset(['transferout', 'transfer out', 'transfer-out', 'move out', 'moveout', 'withdrawal'])
_DIVIDEND_TYPES = frozenset(['dividend', 'div', 'dividends', 'income', 'interest'])


def parse_csv_file(file_content: str) -> pd.DataFrame:
    """
    Parse CSV file with validation, delimiter detection, and column mapping.

    Args:
        file_content: Raw CSV file content as string

    Returns:
        pd.DataFrame: Parsed and validated DataFrame with standardized columns

    Raises:
        ValueError: If required columns are missing or CSV is invalid
    """
    logger.info(f"Starting CSV parsing, content length: {len(file_content)} characters")

    # Parse CSV with common delimiters
    df = pd.read_csv(
        io.StringIO(file_content),
        delimiter=';',
        decimal=',',
        thousands='.'
    )
    df.columns = df.columns.str.lower()

    logger.info(f"Parsed CSV with {len(df)} rows and columns: {list(df.columns)}")

    # Define essential and optional columns with alternatives
    essential_columns = {
        "identifier": ["identifier", "isin", "symbol"],
        "holdingname": ["holdingname", "name", "securityname"],
        "shares": ["shares", "quantity", "units"],
        "price": ["price", "unitprice", "priceperunit"],
        "type": ["type", "transactiontype"],
    }
    optional_columns = {
        "broker": ["broker", "brokername"],
        "assettype": ["assettype", "securitytype"],
        "wkn": ["wkn"],
        "currency": ["currency"],
        "date": ["date", "transactiondate", "datetime"],
        "fee": ["fee", "commission", "costs"],
        "tax": ["tax", "taxes"],
    }

    # Map columns to standardized names
    column_mapping = {}
    missing_columns = []

    for required_col, alternatives in essential_columns.items():
        found = False
        for alt in alternatives:
            if any(col for col in df.columns if alt in col):
                matching_col = next(col for col in df.columns if alt in col)
                column_mapping[required_col] = matching_col
                found = True
                break
        if not found:
            missing_columns.append(required_col)

    if missing_columns:
        error_msg = f"Missing required columns: {', '.join(missing_columns)}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Map optional columns
    for opt_col, alternatives in optional_columns.items():
        for alt in alternatives:
            matching_cols = [col for col in df.columns if alt in col]
            if matching_cols and opt_col not in column_mapping:
                column_mapping[opt_col] = matching_cols[0]
                break

    # Rename columns: column_mapping is {standardized: csv_column}, but
    # df.rename expects {old_name: new_name}, so we invert the mapping
    reverse_mapping = {v: k for k, v in column_mapping.items() if v != k}
    if reverse_mapping:
        logger.info(f"Renaming CSV columns: {reverse_mapping}")
    df = df.rename(columns=reverse_mapping)

    # Add missing optional columns with defaults
    if 'currency' not in df.columns:
        df['currency'] = 'EUR'
    if 'fee' not in df.columns:
        df['fee'] = 0
    if 'tax' not in df.columns:
        df['tax'] = 0
    if 'date' not in df.columns:
        df['date'] = pd.Timestamp.now()

    # Clean and validate data
    df = _clean_and_validate_data(df)

    logger.info(f"CSV parsing completed: {len(df)} valid rows")
    return df


def _clean_and_validate_data(df: pd.DataFrame) -> pd.DataFrame:
    """Clean and validate DataFrame data."""

    # Clean string fields
    df['identifier'] = df['identifier'].apply(
        lambda x: str(x).strip() if pd.notna(x) else ''
    )
    df['holdingname'] = df['holdingname'].apply(
        lambda x: str(x).strip() if pd.notna(x) else ''
    )

    # Normalize transaction types
    df['type'] = df['type'].apply(_normalize_transaction_type)

    # Filter out empty identifiers
    df = df[df['identifier'].str.len() > 0].copy()
    if len(df) == 0:
        raise ValueError("No valid entries found in CSV file")

    # Convert numeric columns with field names for better error messages
    df['shares'] = df['shares'].apply(lambda x: _convert_numeric(x, 'shares'))
    df['price'] = df['price'].apply(lambda x: _convert_numeric(x, 'price'))
    df['fee'] = df['fee'].apply(lambda x: _convert_numeric(x, 'fee'))
    df['tax'] = df['tax'].apply(lambda x: _convert_numeric(x, 'tax'))

    # Log how many rows have conversion failures
    shares_null = df['shares'].isna().sum()
    price_null = df['price'].isna().sum()
    if shares_null > 0 or price_null > 0:
        logger.warning(
            f"CSV contains invalid numeric values: "
            f"{shares_null} invalid shares, {price_null} invalid prices. "
            f"These rows will be skipped."
        )

    # Drop rows with invalid numeric data
    df = df.dropna(subset=['shares', 'price'])
    if df.empty:
        raise ValueError("No valid entries found after converting numeric values")

    # Parse and sort by date
    df = _parse_dates(df)

    return df


def _normalize_transaction_type(t):
    """Normalize transaction type to standard format using O(1) frozenset lookups."""
    if pd.isna(t):
        return 'buy'
    t = str(t).strip().lower()
    if t in _BUY_TYPES:
        return 'buy'
    elif t in _SELL_TYPES:
        return 'sell'
    elif t in _TRANSFERIN_TYPES:
        return 'transferin'
    elif t in _TRANSFEROUT_TYPES:
        return 'transferout'
    elif t in _DIVIDEND_TYPES:
        return 'dividend'
    else:
        logger.warning(f"Unknown transaction type '{t}', defaulting to 'buy'")
        return 'buy'


def _convert_numeric(val, field_name: str = None):
    """
    Convert value to numeric, handling various formats.

    Args:
        val: Value to convert
        field_name: Optional field name for better error logging

    Returns:
        float: Converted value, or None if conversion fails (to allow proper filtering)
    """
    if pd.isna(val):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        val_str = str(val).strip().replace(',', '.')
        # Handle empty strings after stripping
        if not val_str:
            return 0.0
        return float(val_str)
    except (ValueError, TypeError) as e:
        # Log the conversion failure instead of silently returning 0
        logger.warning(
            f"Failed to convert '{val}' to numeric"
            f"{f' for field {field_name}' if field_name else ''}: {e}"
        )
        # Return None to signal conversion failure - allows proper filtering downstream
        return None


def _fix_numeric_date_column(series):
    """
    Fix date column corrupted by thousands='.' in read_csv.

    pd.read_csv(thousands='.') interprets '15.05.2023' as int 15052023.
    This reconstructs the DD.MM.YYYY string by zero-padding to 8 digits.
    """
    def convert(x):
        try:
            s = str(int(x)).zfill(8)  # DDMMYYYY
            return f"{s[:2]}.{s[2:4]}.{s[4:]}"
        except (ValueError, TypeError):
            return str(x)
    return series.apply(convert)


def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Parse dates from various formats and sort chronologically."""
    # Deduplicate columns (can happen when substring column matching renames e.g. 'datetime' → 'date'
    # while a 'date' column already exists)
    df = df.loc[:, ~df.columns.duplicated()]

    # Fix: thousands='.' in read_csv converts dates like '15.05.2023' to int 15052023
    if 'date' in df.columns and df['date'].dtype in ['int64', 'float64']:
        logger.info("Fixing numeric date column (corrupted by thousands='.' setting)")
        df['date'] = _fix_numeric_date_column(df['date'])

    # Same fix for datetime column (same thousands='.' corruption)
    if 'datetime' in df.columns and df['datetime'].dtype in ['int64', 'float64']:
        logger.info("Fixing numeric datetime column (corrupted by thousands='.' setting)")
        df['datetime'] = _fix_numeric_date_column(df['datetime'])

    try:
        if 'datetime' in df.columns:
            df['parsed_date'] = pd.to_datetime(df['datetime'], utc=True, dayfirst=True, errors='coerce')
            mask = df['parsed_date'].isna()
            if mask.any():
                df.loc[mask, 'parsed_date'] = pd.to_datetime(
                    df.loc[mask, 'datetime'], format='%d.%m.%Y', errors='coerce'
                )
                still_mask = df['parsed_date'].isna()
                if still_mask.any():
                    df.loc[still_mask, 'parsed_date'] = pd.to_datetime(
                        df.loc[still_mask, 'datetime'], dayfirst=True, errors='coerce'
                    )
        else:
            df['parsed_date'] = pd.to_datetime(
                df['date'], format='%d.%m.%Y', errors='coerce'
            )
            mask = df['parsed_date'].isna()
            if mask.any():
                df.loc[mask, 'parsed_date'] = pd.to_datetime(
                    df.loc[mask, 'date'], dayfirst=True, errors='coerce'
                )
    except Exception as e:
        logger.warning(f"Error during date parsing: {str(e)}. Falling back to default parsing.")
        df['parsed_date'] = pd.to_datetime(df['date'], dayfirst=True, errors='coerce')

    # Strip timezone info to keep everything tz-naive (avoids TypeError on comparison)
    # utc=True parsing produces tz-aware timestamps, but date-only parsing produces tz-naive
    if hasattr(df['parsed_date'].dtype, 'tz') and df['parsed_date'].dtype.tz is not None:
        df['parsed_date'] = df['parsed_date'].dt.tz_localize(None)

    nat_count = df['parsed_date'].isna().sum()
    if nat_count > 0:
        logger.warning(f"{nat_count} dates could not be parsed and will be set to current time")
    df['parsed_date'] = df['parsed_date'].fillna(pd.Timestamp.now())

    # Sort by date
    df = df.sort_values('parsed_date', ascending=True)

    # Summary logging only (per-row logging was a major performance bottleneck)
    logger.info(f"Sorted {len(df)} transactions, date range: {df['parsed_date'].min()} to {df['parsed_date'].max()}")

    # DEBUG-level for first few rows only (if needed for debugging)
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"First 3 transactions: {df[['parsed_date', 'type', 'holdingname', 'shares']].head(3).to_dict('records')}")

    return df


# --- IBKR Flex Query Support ---

# IBKR asset categories to keep (equities and ETFs)
_IBKR_EQUITY_TYPES = frozenset(['stk', 'stock', 'stocks', 'etf', 'fund'])


def detect_csv_format(file_content: str) -> str:
    """
    Auto-detect CSV format based on structure and column names.

    Returns:
        'parqet' or 'ibkr'
    """
    first_lines = file_content[:2000].lower()

    # IBKR indicators: comma-delimited, has IBKR-specific columns
    # Actual IBKR Flex Query column names (lowercased): currencyprimary, assetclass, quantity, costbasismoney
    ibkr_columns = ['symbol', 'quantity', 'assetclass', 'costbasismoney', 'currencyprimary', 'fxratetobase', 'positionvalue']
    ibkr_matches = sum(1 for col in ibkr_columns if col in first_lines)

    # Parqet indicators: semicolon-delimited, has Parqet-specific columns
    parqet_columns = ['holdingname', 'type', 'holding']
    parqet_matches = sum(1 for col in parqet_columns if col in first_lines)

    # Delimiter detection
    first_line = first_lines.split('\n')[0]
    is_semicolon = ';' in first_line

    if ibkr_matches >= 2 and not is_semicolon:
        logger.info(f"Detected IBKR CSV format (matched {ibkr_matches} IBKR columns)")
        return 'ibkr'
    elif parqet_matches >= 2 or is_semicolon:
        logger.info(f"Detected Parqet CSV format (matched {parqet_matches} Parqet columns, semicolon={is_semicolon})")
        return 'parqet'
    else:
        logger.warning("Could not determine CSV format, defaulting to Parqet")
        return 'parqet'


def parse_ibkr_csv(file_content: str) -> pd.DataFrame:
    """
    Parse IBKR Flex Query Open Positions CSV.

    IBKR CSVs are comma-delimited snapshots: each row is a current position.
    No buy/sell transactions - just final position state.

    Args:
        file_content: Raw CSV file content as string

    Returns:
        pd.DataFrame: Parsed DataFrame with standardized columns

    Raises:
        ValueError: If required columns are missing or CSV is invalid
    """
    logger.info(f"Starting IBKR CSV parsing, content length: {len(file_content)} characters")

    df = pd.read_csv(io.StringIO(file_content))
    df.columns = df.columns.str.lower().str.strip()

    logger.info(f"Parsed IBKR CSV with {len(df)} rows and columns: {list(df.columns)}")

    # Normalize IBKR-specific column names to consistent internal names
    # IBKR uses different names than expected: CurrencyPrimary→currency, AssetClass→assetcategory
    ibkr_column_aliases = {
        'currencyprimary': 'currency',
        'assetclass': 'assetcategory',
    }
    df = df.rename(columns={k: v for k, v in ibkr_column_aliases.items() if k in df.columns})

    # Map IBKR columns to standardized names
    column_mapping = {}
    required_found = []

    # Identifier: prefer ISIN, fall back to Symbol per-row when ISIN is empty
    if 'isin' in df.columns and df['isin'].notna().any():
        # Use ISIN as primary, but fill gaps with Symbol
        if 'symbol' in df.columns:
            df['isin'] = df['isin'].fillna(df['symbol'])
        column_mapping['identifier'] = 'isin'
        required_found.append('identifier')
    elif 'symbol' in df.columns:
        column_mapping['identifier'] = 'symbol'
        required_found.append('identifier')

    # Description → holdingname
    if 'description' in df.columns:
        column_mapping['holdingname'] = 'description'
        required_found.append('holdingname')

    # Position → shares
    if 'position' in df.columns:
        column_mapping['shares'] = 'position'
        required_found.append('shares')
    elif 'quantity' in df.columns:
        column_mapping['shares'] = 'quantity'
        required_found.append('shares')

    missing = {'identifier', 'holdingname', 'shares'} - set(required_found)
    if missing:
        error_msg = f"Missing required IBKR columns: {', '.join(missing)}. Found: {list(df.columns)}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Optional columns
    if 'costbasismoney' in df.columns:
        column_mapping['total_invested'] = 'costbasismoney'
    # Price fallback chain: markprice → costbasisprice → derive from positionvalue/quantity
    if 'markprice' in df.columns:
        column_mapping['price'] = 'markprice'
    elif 'costbasisprice' in df.columns:
        column_mapping['price'] = 'costbasisprice'
    if 'currency' not in column_mapping and 'currency' in df.columns:
        column_mapping['currency'] = 'currency'
    if 'assetcategory' in df.columns:
        column_mapping['assetcategory'] = 'assetcategory'
    if 'opendatetime' in df.columns:
        column_mapping['opendatetime'] = 'opendatetime'
    if 'fxratetobase' in df.columns:
        column_mapping['fxratetobase'] = 'fxratetobase'
    if 'positionvalue' in df.columns:
        column_mapping['positionvalue'] = 'positionvalue'
    if 'side' in df.columns:
        column_mapping['side'] = 'side'

    # Rename columns
    reverse_mapping = {v: k for k, v in column_mapping.items() if v != k}
    if reverse_mapping:
        logger.info(f"Renaming IBKR columns: {reverse_mapping}")
    df = df.rename(columns=reverse_mapping)

    # Filter out non-equity types
    if 'assetcategory' in df.columns:
        original_count = len(df)
        df['assetcategory'] = df['assetcategory'].apply(
            lambda x: str(x).strip().lower() if pd.notna(x) else ''
        )
        df = df[df['assetcategory'].isin(_IBKR_EQUITY_TYPES) | (df['assetcategory'] == '')].copy()
        filtered = original_count - len(df)
        if filtered > 0:
            logger.info(f"Filtered out {filtered} non-equity rows (options, futures, cash, etc.)")

    # Filter out SHORT positions
    if 'side' in df.columns:
        original_count = len(df)
        df = df[df['side'].apply(lambda x: str(x).strip().upper() != 'SHORT' if pd.notna(x) else True)].copy()
        filtered = original_count - len(df)
        if filtered > 0:
            logger.info(f"Filtered out {filtered} SHORT positions")

    # Filter out summary/total rows
    df = df[df['identifier'].apply(lambda x: pd.notna(x) and str(x).strip() != '' and str(x).strip().lower() != 'total')].copy()

    # Clean string fields
    df['identifier'] = df['identifier'].apply(lambda x: str(x).strip() if pd.notna(x) else '')
    df['holdingname'] = df['holdingname'].apply(lambda x: str(x).strip() if pd.notna(x) else '')

    # Filter out empty identifiers
    df = df[df['identifier'].str.len() > 0].copy()
    if len(df) == 0:
        raise ValueError("No valid positions found in IBKR CSV file")

    # Convert numeric columns
    df['shares'] = df['shares'].apply(lambda x: _convert_numeric(x, 'shares'))
    df = df.dropna(subset=['shares'])

    # Filter out zero/negative positions
    df = df[df['shares'] > 0].copy()
    if len(df) == 0:
        raise ValueError("No positions with positive shares found in IBKR CSV")

    if 'total_invested' in df.columns:
        df['total_invested'] = df['total_invested'].apply(lambda x: _convert_numeric(x, 'total_invested'))
    else:
        df['total_invested'] = 0.0

    if 'price' in df.columns:
        df['price'] = df['price'].apply(lambda x: _convert_numeric(x, 'price'))
    elif 'positionvalue' in df.columns:
        # Derive price from positionvalue / shares as last resort
        df['positionvalue'] = df['positionvalue'].apply(lambda x: _convert_numeric(x, 'positionvalue'))
        df['price'] = df.apply(
            lambda row: round(row['positionvalue'] / row['shares'], 4) if row['shares'] > 0 else 0.0,
            axis=1
        )
        logger.info("Derived price from PositionValue / Quantity (no MarkPrice column)")
    else:
        df['price'] = 0.0

    if 'currency' not in df.columns:
        df['currency'] = 'USD'

    # Parse first_bought_date from openDateTime
    if 'opendatetime' in df.columns:
        df['first_bought_date'] = df['opendatetime'].apply(_parse_ibkr_datetime)
    else:
        df['first_bought_date'] = None

    # Map investment_type from assetcategory
    if 'assetcategory' in df.columns:
        df['investment_type'] = df['assetcategory'].apply(_map_ibkr_asset_type)
    else:
        df['investment_type'] = None

    logger.info(f"IBKR CSV parsing completed: {len(df)} valid positions")
    return df


def _parse_ibkr_datetime(val) -> object:
    """Parse IBKR datetime formats (yyyyMMdd or yyyyMMdd;HHmmss)."""
    if pd.isna(val) or not str(val).strip():
        return None
    val_str = str(val).strip()
    for fmt in ('%Y%m%d;%H%M%S', '%Y%m%d', '%Y-%m-%d', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(val_str, fmt)
        except ValueError:
            continue
    logger.warning(f"Could not parse IBKR datetime: {val_str}")
    return None


def _map_ibkr_asset_type(category) -> str:
    """Map IBKR AssetCategory to investment_type."""
    if pd.isna(category):
        return None
    cat = str(category).strip().lower()
    if cat in ('etf', 'fund'):
        return 'ETF'
    elif cat in ('stk', 'stock', 'stocks'):
        return 'Stock'
    return None
