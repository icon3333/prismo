"""
Identifier Mapping Utilities

This module handles storing and retrieving user preferences for identifier mappings.
When users change identifiers in the UI, these mappings are stored and used during
future CSV uploads to automatically apply the user's preferred identifier instead
of the default normalized one.
"""

import logging
from typing import Optional
from app.db_manager import query_db, execute_db

logger = logging.getLogger(__name__)


def store_identifier_mapping(account_id: int, csv_identifier: str, preferred_identifier: str, company_name: Optional[str] = None) -> bool:
    """
    Store user's identifier preference mapping.
    
    Args:
        account_id: User's account ID
        csv_identifier: Original identifier from CSV (normalized)
        preferred_identifier: User's preferred identifier
        company_name: Optional company name for context
        
    Returns:
        Success status
    """
    try:
        if not csv_identifier or not preferred_identifier:
            logger.warning("Cannot store mapping with empty identifiers")
            return False
            
        # Check if mapping already exists
        existing = query_db('''
            SELECT id, preferred_identifier FROM identifier_mappings 
            WHERE account_id = ? AND csv_identifier = ?
        ''', [account_id, csv_identifier], one=True)
        
        if existing:
            # Update existing mapping
            if isinstance(existing, dict):
                current_preferred = existing.get('preferred_identifier')
                if current_preferred == preferred_identifier:
                    logger.info(f"Mapping already exists: {csv_identifier} -> {preferred_identifier}")
                    return True
                    
            rows_updated = execute_db('''
                UPDATE identifier_mappings 
                SET preferred_identifier = ?, company_name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE account_id = ? AND csv_identifier = ?
            ''', [preferred_identifier, company_name, account_id, csv_identifier])
            
            logger.info(f"Updated identifier mapping: {csv_identifier} -> {preferred_identifier} (company: {company_name})")
            return rows_updated > 0
        else:
            # Create new mapping
            execute_db('''
                INSERT INTO identifier_mappings 
                (account_id, csv_identifier, preferred_identifier, company_name)
                VALUES (?, ?, ?, ?)
            ''', [account_id, csv_identifier, preferred_identifier, company_name])
            
            logger.info(f"Created identifier mapping: {csv_identifier} -> {preferred_identifier} (company: {company_name})")
            return True
            
    except Exception as e:
        logger.error(f"Error storing identifier mapping: {e}")
        return False


def get_preferred_identifier(account_id: int, csv_identifier: str) -> Optional[str]:
    """
    Get user's preferred identifier for a CSV identifier.
    
    Args:
        account_id: User's account ID
        csv_identifier: Original identifier from CSV
        
    Returns:
        Preferred identifier if mapping exists, None otherwise
    """
    try:
        if not csv_identifier:
            return None
            
        mapping = query_db('''
            SELECT preferred_identifier FROM identifier_mappings 
            WHERE account_id = ? AND csv_identifier = ?
        ''', [account_id, csv_identifier], one=True)
        
        if mapping:
            if isinstance(mapping, dict):
                preferred = mapping.get('preferred_identifier')
                if preferred:
                    logger.info(f"Found identifier mapping: {csv_identifier} -> {preferred}")
                    return preferred
        
        return None
        
    except Exception as e:
        logger.error(f"Error getting preferred identifier: {e}")
        return None
