# app/database/__init__.py
# Database module initialization
from app.database.db_manager import (
    get_db,
    get_background_db,  # Add this new function
    close_db,
    init_db,
    backup_database,
    query_db,
    execute_db
)

__all__ = [
    'get_db',
    'get_background_db',  # Add this to exports
    'close_db',
    'init_db',
    'backup_database',
    'query_db',
    'execute_db'
]
