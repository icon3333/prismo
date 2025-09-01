"""
Admin routes for identifier normalization management.

This module provides administrative endpoints for managing the
smart identifier normalization system, including cleanup operations
and testing functionality.
"""

from flask import Blueprint, request, jsonify, render_template, flash, redirect, url_for
from ..utils.identifier_normalization import (
    normalize_identifier,
    cleanup_crypto_duplicates,
    run_test_cases
)
import logging

logger = logging.getLogger(__name__)

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')


@admin_bp.route('/identifier-normalization')
def identifier_normalization():
    """Display the identifier normalization management page."""
    return render_template('admin/identifier_normalization.html')


@admin_bp.route('/api/test-normalization', methods=['POST'])
def test_normalization():
    """Test identifier normalization with provided identifier."""
    try:
        data = request.get_json()
        identifier = data.get('identifier', '').strip()
        
        if not identifier:
            return jsonify({
                'success': False,
                'error': 'No identifier provided'
            }), 400
        
        normalized = normalize_identifier(identifier)
        
        return jsonify({
            'success': True,
            'original': identifier,
            'normalized': normalized,
            'changed': identifier != normalized
        })
        
    except Exception as e:
        logger.error(f"Error testing normalization: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@admin_bp.route('/api/run-test-cases', methods=['POST'])
def api_run_test_cases():
    """Run the comprehensive test cases."""
    try:
        results = run_test_cases()
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        logger.error(f"Error running test cases: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@admin_bp.route('/api/cleanup-duplicates', methods=['POST'])
def api_cleanup_duplicates():
    """Run the crypto duplicates cleanup function."""
    try:
        # Confirm that user wants to proceed
        data = request.get_json()
        confirmed = data.get('confirmed', False)
        
        if not confirmed:
            return jsonify({
                'success': False,
                'error': 'Cleanup must be confirmed'
            }), 400
        
        logger.info("Starting crypto duplicates cleanup via admin API")
        results = cleanup_crypto_duplicates()
        
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@admin_bp.route('/api/normalize-identifier', methods=['POST'])
def api_normalize_identifier():
    """Normalize a single identifier via API."""
    try:
        data = request.get_json()
        identifiers = data.get('identifiers', [])
        
        if not identifiers:
            return jsonify({
                'success': False,
                'error': 'No identifiers provided'
            }), 400
        
        results = []
        for identifier in identifiers:
            normalized = normalize_identifier(identifier)
            results.append({
                'original': identifier,
                'normalized': normalized,
                'changed': identifier != normalized
            })
        
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        logger.error(f"Error normalizing identifiers: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500 