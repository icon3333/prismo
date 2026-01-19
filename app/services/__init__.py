"""
Service layer for business logic.

Services contain pure business logic without Flask dependencies.
This makes them testable and reusable.
"""

from app.services.allocation_service import AllocationService

__all__ = ['AllocationService']
