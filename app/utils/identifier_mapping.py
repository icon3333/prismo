"""
Identifier Mapping Utilities

This module handles storing and retrieving user preferences for identifier mappings.
When users change identifiers in the UI, these mappings are stored and used during
future CSV uploads to automatically apply the user's preferred identifier instead
of the default normalized one.
"""

import logging
from typing import Optional, Dict, List
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


def get_all_mappings(account_id: int) -> List[Dict]:
    """
    Get all identifier mappings for an account.
    
    Args:
        account_id: User's account ID
        
    Returns:
        List of mapping dictionaries
    """
    try:
        mappings = query_db('''
            SELECT csv_identifier, preferred_identifier, company_name, 
                   created_at, updated_at
            FROM identifier_mappings 
            WHERE account_id = ?
            ORDER BY updated_at DESC
        ''', [account_id])
        
        return mappings if mappings else []
        
    except Exception as e:
        logger.error(f"Error getting all mappings: {e}")
        return []


def delete_identifier_mapping(account_id: int, csv_identifier: str) -> bool:
    """
    Delete an identifier mapping.
    
    Args:
        account_id: User's account ID
        csv_identifier: CSV identifier to remove mapping for
        
    Returns:
        Success status
    """
    try:
        rows_deleted = execute_db('''
            DELETE FROM identifier_mappings 
            WHERE account_id = ? AND csv_identifier = ?
        ''', [account_id, csv_identifier])
        
        if rows_deleted > 0:
            logger.info(f"Deleted identifier mapping for: {csv_identifier}")
            return True
        else:
            logger.warning(f"No mapping found to delete for: {csv_identifier}")
            return False
            
    except Exception as e:
        logger.error(f"Error deleting identifier mapping: {e}")
        return False


def find_csv_identifier_by_company(account_id: int, company_name: str, current_identifier: str) -> Optional[str]:
    """
    Find the original CSV identifier for a company by looking at existing mappings.
    This is used when we need to detect what the original CSV identifier was.
    
    Args:
        account_id: User's account ID  
        company_name: Company name
        current_identifier: Current identifier in database
        
    Returns:
        Original CSV identifier if found, None otherwise
    """
    try:
        # First try to find by preferred identifier
        mapping = query_db('''
            SELECT csv_identifier FROM identifier_mappings 
            WHERE account_id = ? AND preferred_identifier = ?
        ''', [account_id, current_identifier], one=True)
        
        if mapping and isinstance(mapping, dict):
            csv_id = mapping.get('csv_identifier')
            if csv_id:
                return csv_id
                
        # If not found, try to find by company name
        mapping = query_db('''
            SELECT csv_identifier FROM identifier_mappings 
            WHERE account_id = ? AND company_name = ?
        ''', [account_id, company_name], one=True)
        
        if mapping and isinstance(mapping, dict):
            csv_id = mapping.get('csv_identifier')
            if csv_id:
                return csv_id
                
        return None
        
    except Exception as e:
        logger.error(f"Error finding CSV identifier: {e}")
        return None 