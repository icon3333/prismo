"""
Repository for account data access.

Centralizes all account-related database queries.
Philosophy: Single source of truth for account data access.
"""

from typing import Optional, Dict, Any, List
from app.db_manager import query_db, execute_db, get_db
import logging

logger = logging.getLogger(__name__)


class AccountRepository:
    """Data access layer for account operations"""

    @staticmethod
    def get_by_id(account_id: int) -> Optional[Dict[str, Any]]:
        """
        Get account by ID.

        Args:
            account_id: Account ID

        Returns:
            Account dict or None if not found
        """
        logger.debug(f"Fetching account by ID: {account_id}")
        return query_db(
            'SELECT * FROM accounts WHERE id = ?',
            [account_id],
            one=True
        )

    @staticmethod
    def get_by_username(username: str) -> Optional[Dict[str, Any]]:
        """
        Get account by username.

        Args:
            username: Account username

        Returns:
            Account dict or None if not found
        """
        logger.debug(f"Fetching account by username: {username}")
        return query_db(
            'SELECT * FROM accounts WHERE username = ?',
            [username],
            one=True
        )

    @staticmethod
    def get_by_email(email: str) -> Optional[Dict[str, Any]]:
        """
        Get account by email.

        Args:
            email: Account email

        Returns:
            Account dict or None if not found
        """
        logger.debug(f"Fetching account by email: {email}")
        return query_db(
            'SELECT * FROM accounts WHERE email = ?',
            [email],
            one=True
        )

    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        """
        Get all accounts.

        Returns:
            List of all account dicts
        """
        logger.debug("Fetching all accounts")
        accounts = query_db('SELECT * FROM accounts ORDER BY username')
        return accounts if accounts else []

    @staticmethod
    def create(username: str, email: str, password_hash: str) -> int:
        """
        Create a new account.

        Args:
            username: Account username
            email: Account email
            password_hash: Hashed password

        Returns:
            New account ID

        Raises:
            Exception if account creation fails
        """
        logger.info(f"Creating new account: {username}")

        result = execute_db(
            'INSERT INTO accounts (username, email, password_hash) VALUES (?, ?, ?)',
            [username, email, password_hash]
        )

        if result and 'lastrowid' in result:
            account_id = result['lastrowid']
            logger.info(f"Created account {username} with ID: {account_id}")
            return account_id

        raise Exception("Failed to create account")

    @staticmethod
    def update_username(account_id: int, new_username: str) -> bool:
        """
        Update account username.

        Args:
            account_id: Account ID
            new_username: New username

        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Updating username for account {account_id} to: {new_username}")

        result = execute_db(
            'UPDATE accounts SET username = ? WHERE id = ?',
            [new_username, account_id]
        )

        success = result is not None and result.get('rowcount', 0) > 0
        if success:
            logger.info(f"Successfully updated username for account {account_id}")
        else:
            logger.warning(f"Failed to update username for account {account_id}")

        return success

    @staticmethod
    def update_email(account_id: int, new_email: str) -> bool:
        """
        Update account email.

        Args:
            account_id: Account ID
            new_email: New email address

        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Updating email for account {account_id}")

        result = execute_db(
            'UPDATE accounts SET email = ? WHERE id = ?',
            [new_email, account_id]
        )

        success = result is not None and result.get('rowcount', 0) > 0
        if success:
            logger.info(f"Successfully updated email for account {account_id}")
        else:
            logger.warning(f"Failed to update email for account {account_id}")

        return success

    @staticmethod
    def update_password(account_id: int, password_hash: str) -> bool:
        """
        Update account password.

        Args:
            account_id: Account ID
            password_hash: New password hash

        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Updating password for account {account_id}")

        result = execute_db(
            'UPDATE accounts SET password_hash = ? WHERE id = ?',
            [password_hash, account_id]
        )

        success = result is not None and result.get('rowcount', 0) > 0
        if success:
            logger.info(f"Successfully updated password for account {account_id}")
        else:
            logger.warning(f"Failed to update password for account {account_id}")

        return success

    @staticmethod
    def delete(account_id: int) -> bool:
        """
        Delete an account and all associated data.

        This performs a cascading delete of all related data:
        - Portfolios
        - Companies
        - Company shares
        - Prices
        - Settings
        - Backups

        Args:
            account_id: Account ID to delete

        Returns:
            True if successful, False otherwise
        """
        logger.warning(f"Deleting account {account_id} and all associated data")

        db = get_db()
        cursor = db.cursor()

        try:
            # Delete in order to respect foreign key constraints
            # (assuming ON DELETE CASCADE is set up, but being explicit)

            # Delete company shares for companies owned by this account
            cursor.execute('''
                DELETE FROM company_shares
                WHERE company_id IN (
                    SELECT id FROM companies WHERE account_id = ?
                )
            ''', [account_id])

            # Delete companies
            cursor.execute('DELETE FROM companies WHERE account_id = ?', [account_id])

            # Delete portfolios
            cursor.execute('DELETE FROM portfolios WHERE account_id = ?', [account_id])

            # Delete saved settings
            cursor.execute('DELETE FROM saved_settings WHERE account_id = ?', [account_id])

            # Delete CSV processing jobs
            cursor.execute('DELETE FROM csv_processing_jobs WHERE account_id = ?', [account_id])

            # Delete the account itself
            cursor.execute('DELETE FROM accounts WHERE id = ?', [account_id])

            db.commit()
            logger.info(f"Successfully deleted account {account_id}")
            return True

        except Exception as e:
            logger.error(f"Error deleting account {account_id}: {e}")
            db.rollback()
            return False

    @staticmethod
    def exists(account_id: int) -> bool:
        """
        Check if an account exists.

        Args:
            account_id: Account ID to check

        Returns:
            True if account exists, False otherwise
        """
        result = query_db(
            'SELECT 1 FROM accounts WHERE id = ?',
            [account_id],
            one=True
        )
        return result is not None

    @staticmethod
    def username_exists(username: str, exclude_account_id: Optional[int] = None) -> bool:
        """
        Check if a username is already taken.

        Args:
            username: Username to check
            exclude_account_id: Optional account ID to exclude (for updates)

        Returns:
            True if username exists, False otherwise
        """
        if exclude_account_id:
            result = query_db(
                'SELECT 1 FROM accounts WHERE username = ? AND id != ?',
                [username, exclude_account_id],
                one=True
            )
        else:
            result = query_db(
                'SELECT 1 FROM accounts WHERE username = ?',
                [username],
                one=True
            )

        return result is not None

    @staticmethod
    def email_exists(email: str, exclude_account_id: Optional[int] = None) -> bool:
        """
        Check if an email is already registered.

        Args:
            email: Email to check
            exclude_account_id: Optional account ID to exclude (for updates)

        Returns:
            True if email exists, False otherwise
        """
        if exclude_account_id:
            result = query_db(
                'SELECT 1 FROM accounts WHERE email = ? AND id != ?',
                [email, exclude_account_id],
                one=True
            )
        else:
            result = query_db(
                'SELECT 1 FROM accounts WHERE email = ?',
                [email],
                one=True
            )

        return result is not None

    @staticmethod
    def get_account_stats(account_id: int) -> Dict[str, int]:
        """
        Get statistics for an account.

        Args:
            account_id: Account ID

        Returns:
            Dict with counts of portfolios, companies, total shares
        """
        logger.debug(f"Fetching statistics for account {account_id}")

        portfolios_count = query_db(
            'SELECT COUNT(*) as count FROM portfolios WHERE account_id = ?',
            [account_id],
            one=True
        )

        companies_count = query_db(
            'SELECT COUNT(*) as count FROM companies WHERE account_id = ?',
            [account_id],
            one=True
        )

        shares_sum = query_db(
            '''
            SELECT COALESCE(SUM(cs.shares), 0) as total
            FROM company_shares cs
            JOIN companies c ON cs.company_id = c.id
            WHERE c.account_id = ?
            ''',
            [account_id],
            one=True
        )

        return {
            'portfolios': portfolios_count['count'] if portfolios_count else 0,
            'companies': companies_count['count'] if companies_count else 0,
            'total_shares': shares_sum['total'] if shares_sum else 0
        }
