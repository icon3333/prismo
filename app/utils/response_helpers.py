"""
Response helpers for consistent API responses.

Provides standardized success and error response functions for all API endpoints.
Philosophy: Consistency and predictability in API responses.
"""
from flask import jsonify
from typing import Any, Dict, Optional, Union
import logging

logger = logging.getLogger(__name__)


def success_response(
    data: Any = None,
    message: Optional[str] = None,
    status: int = 200
) -> tuple:
    """
    Create a standardized success response.

    Args:
        data: The data payload to return (optional)
        message: Success message to include (optional)
        status: HTTP status code (default: 200)

    Returns:
        Tuple of (response_dict, status_code) suitable for Flask return

    Example:
        # Simple success
        return success_response()

        # Success with data
        return success_response(data={'items': items})

        # Success with message
        return success_response(message='Portfolio updated successfully')

        # Success with data and custom status
        return success_response(data={'id': new_id}, message='Created', status=201)
    """
    response: Dict[str, Any] = {'success': True}

    if message is not None:
        response['message'] = message

    if data is not None:
        response['data'] = data

    logger.debug(f"Success response: {status} - {message or 'OK'}")
    return jsonify(response), status


def error_response(
    message: str,
    status: int = 400,
    details: Optional[Union[str, Dict, list]] = None,
    error_code: Optional[str] = None
) -> tuple:
    """
    Create a standardized error response.

    Args:
        message: User-friendly error message (required)
        status: HTTP status code (default: 400 Bad Request)
        details: Additional error details for debugging (optional)
        error_code: Machine-readable error code (optional)

    Returns:
        Tuple of (response_dict, status_code) suitable for Flask return

    Common status codes:
        400 - Bad Request (validation errors, invalid input)
        401 - Unauthorized (authentication required)
        403 - Forbidden (authenticated but not authorized)
        404 - Not Found
        409 - Conflict (data integrity, duplicate key)
        422 - Unprocessable Entity (semantic errors)
        500 - Internal Server Error
        503 - Service Unavailable (external API failure)

    Example:
        # Simple error
        return error_response('Invalid input', 400)

        # Error with details
        return error_response(
            'Validation failed',
            status=400,
            details={'field': 'isin', 'error': 'Invalid format'}
        )

        # Error with code
        return error_response(
            'Stock not found',
            status=404,
            error_code='STOCK_NOT_FOUND'
        )
    """
    response: Dict[str, Any] = {
        'error': message,
        'success': False
    }

    if details is not None:
        response['details'] = details

    if error_code is not None:
        response['error_code'] = error_code

    logger.warning(f"Error response: {status} - {message}")
    if details:
        logger.debug(f"Error details: {details}")

    return jsonify(response), status


def validation_error_response(
    field: str,
    message: str,
    value: Any = None
) -> tuple:
    """
    Create a standardized validation error response.

    Convenience wrapper for common validation errors.

    Args:
        field: The field that failed validation
        message: Description of the validation error
        value: The invalid value (optional, for debugging)

    Returns:
        Tuple of (response_dict, status_code) with status 400

    Example:
        return validation_error_response('isin', 'ISIN must be 12 characters', isin)
    """
    details = {'field': field, 'message': message}
    if value is not None:
        details['value'] = value

    return error_response(
        message=f'Validation error: {field}',
        status=400,
        details=details,
        error_code='VALIDATION_ERROR'
    )


def not_found_response(
    resource: str,
    identifier: Optional[Union[str, int]] = None
) -> tuple:
    """
    Create a standardized "not found" error response.

    Convenience wrapper for 404 errors.

    Args:
        resource: Type of resource that wasn't found (e.g., 'Portfolio', 'Company')
        identifier: ID or identifier of the missing resource (optional)

    Returns:
        Tuple of (response_dict, status_code) with status 404

    Example:
        return not_found_response('Portfolio', portfolio_id)
        return not_found_response('Company')
    """
    if identifier is not None:
        message = f'{resource} not found: {identifier}'
        details = {'resource': resource, 'identifier': identifier}
    else:
        message = f'{resource} not found'
        details = {'resource': resource}

    return error_response(
        message=message,
        status=404,
        details=details,
        error_code='NOT_FOUND'
    )


def conflict_response(
    message: str,
    details: Optional[Dict] = None
) -> tuple:
    """
    Create a standardized conflict error response.

    Used for data integrity issues, duplicate keys, etc.

    Args:
        message: Description of the conflict
        details: Additional details about the conflict (optional)

    Returns:
        Tuple of (response_dict, status_code) with status 409

    Example:
        return conflict_response(
            'Portfolio name already exists',
            details={'name': portfolio_name}
        )
    """
    return error_response(
        message=message,
        status=409,
        details=details,
        error_code='CONFLICT'
    )


def service_unavailable_response(
    service: str,
    message: Optional[str] = None
) -> tuple:
    """
    Create a standardized service unavailable error response.

    Used when external services (yfinance, APIs) fail.

    Args:
        service: Name of the unavailable service
        message: Additional details (optional)

    Returns:
        Tuple of (response_dict, status_code) with status 503

    Example:
        return service_unavailable_response('Yahoo Finance', 'API timeout')
    """
    if message:
        full_message = f'{service} is temporarily unavailable: {message}'
    else:
        full_message = f'{service} is temporarily unavailable'

    return error_response(
        message=full_message,
        status=503,
        details={'service': service},
        error_code='SERVICE_UNAVAILABLE'
    )
