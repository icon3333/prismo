"""
CSV Parser Module
Handles CSV file parsing with validation and column mapping.
"""

import pandas as pd
import io
import logging

logger = logging.getLogger(__name__)


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

    # Rename columns
    df = df.rename(columns=column_mapping)

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
    df = df[df['identifier'].str.len() > 0]
    if len(df) == 0:
        raise ValueError("No valid entries found in CSV file")

    # Convert numeric columns
    df['shares'] = df['shares'].apply(_convert_numeric)
    df['price'] = df['price'].apply(_convert_numeric)
    df['fee'] = df['fee'].apply(_convert_numeric)
    df['tax'] = df['tax'].apply(_convert_numeric)

    # Drop rows with invalid numeric data
    df = df.dropna(subset=['shares', 'price'])
    if df.empty:
        raise ValueError("No valid entries found after converting numeric values")

    # Parse and sort by date
    df = _parse_dates(df)

    return df


def _normalize_transaction_type(t):
    """Normalize transaction type to standard format."""
    if pd.isna(t):
        return 'buy'
    t = str(t).strip().lower()
    if t in ['buy', 'purchase', 'bought', 'acquire', 'deposit']:
        return 'buy'
    elif t in ['sell', 'sold', 'dispose', 'withdrawal']:
        return 'sell'
    elif t in ['transferin', 'transfer in', 'transfer-in', 'move in', 'movein', 'deposit']:
        return 'transferin'
    elif t in ['transferout', 'transfer out', 'transfer-out', 'move out', 'moveout', 'withdrawal']:
        return 'transferout'
    elif t in ['dividend', 'div', 'dividends', 'income', 'interest']:
        return 'dividend'
    else:
        logger.warning(f"Unknown transaction type '{t}', defaulting to 'buy'")
        return 'buy'


def _convert_numeric(val):
    """Convert value to numeric, handling various formats."""
    if pd.isna(val):
        return 0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        val_str = str(val).strip().replace(',', '.')
        return float(val_str)
    except (ValueError, TypeError):
        return 0


def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Parse dates from various formats and sort chronologically."""
    try:
        if 'datetime' in df.columns:
            df['parsed_date'] = pd.to_datetime(df['datetime'], errors='coerce')
            mask = df['parsed_date'].isna()
            if mask.any():
                df.loc[mask, 'parsed_date'] = pd.to_datetime(
                    df.loc[mask, 'date'], format='%d.%m.%Y', errors='coerce'
                )
                still_mask = df['parsed_date'].isna()
                if still_mask.any():
                    df.loc[still_mask, 'parsed_date'] = pd.to_datetime(
                        df.loc[still_mask, 'date'], dayfirst=True, errors='coerce'
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

    nat_count = df['parsed_date'].isna().sum()
    if nat_count > 0:
        logger.warning(f"{nat_count} dates could not be parsed and will be set to current time")
    df['parsed_date'] = df['parsed_date'].fillna(pd.Timestamp.now())

    # Sort by date
    df = df.sort_values('parsed_date', ascending=True)

    logger.info("Transaction order after sorting:")
    for idx, row in df.iterrows():
        logger.info(
            f"Processing order: {row['parsed_date']} - {row['type']} - "
            f"{row['holdingname']} - {row['shares']} shares"
        )

    return df
