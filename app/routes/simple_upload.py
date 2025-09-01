"""
Simplified CSV Upload Endpoint
Direct processing without background threads or complex progress tracking.
"""

import logging
import threading
from flask import request, session, jsonify, flash, redirect, url_for, current_app
from app.utils.csv_import_simple import import_csv_simple, validate_csv_format

logger = logging.getLogger(__name__)

def get_simple_upload_progress():
    """
    Get or clear real-time progress for simple upload.
    """
    try:
        if request.method == 'GET':
            progress = session.get('simple_upload_progress', {
                'current': 0,
                'total': 0,
                'percentage': 0,
                'message': 'No active upload',
                'status': 'idle'
            })
            
            return jsonify(progress)
        
        elif request.method == 'DELETE':
            # Clear progress from session
            if 'simple_upload_progress' in session:
                del session['simple_upload_progress']
                session.modified = True
                logger.info("Cleared simple upload progress from session")
            
            return jsonify({'message': 'Simple upload progress cleared'})
        
    except Exception as e:
        logger.error(f"Error handling simple upload progress: {e}")
        return jsonify({
            'current': 0,
            'total': 0,
            'percentage': 0,
            'message': 'Error handling progress',
            'status': 'error'
        }), 500

def upload_csv_simple():
    """
    Ultra-simple CSV upload endpoint.
    Direct processing, immediate response, no background complexity.
    """
    logger.info(f"Simple CSV upload request - account_id: {session.get('account_id')}")
    
    # Determine if this is an AJAX request
    accept_header = request.headers.get('Accept', '')
    is_ajax = ('application/json' in accept_header or 
               request.headers.get('X-Requested-With') == 'XMLHttpRequest')
    
    # Authentication check
    if 'account_id' not in session:
        logger.warning("CSV upload failed - no account_id in session")
        if is_ajax:
            return jsonify({'success': False, 'message': 'Please select an account first'}), 401
        flash('Please select an account first', 'warning')
        return redirect(url_for('portfolio.enrich'))

    account_id = session['account_id']
    logger.info(f"Processing CSV upload for account_id: {account_id}")

    # File validation
    if 'csv_file' not in request.files:
        logger.warning("CSV upload failed - no csv_file in request.files")
        if is_ajax:
            return jsonify({'success': False, 'message': 'No file uploaded'}), 400
        flash('No file uploaded', 'error')
        return redirect(url_for('portfolio.enrich'))

    file = request.files['csv_file']
    logger.info(f"CSV file received: {file.filename}")

    if file.filename == '':
        logger.warning("CSV upload failed - empty filename")
        if is_ajax:
            return jsonify({'success': False, 'message': 'No file selected'}), 400
        flash('No file selected', 'error')
        return redirect(url_for('portfolio.enrich'))

    try:
        # Read file content
        file_content = file.read().decode('utf-8-sig')  # Handle BOM
        logger.info(f"CSV file content length: {len(file_content)} characters")
        
        # Quick validation
        valid, validation_message = validate_csv_format(file_content)
        if not valid:
            logger.warning(f"CSV validation failed: {validation_message}")
            if is_ajax:
                return jsonify({'success': False, 'message': validation_message}), 400
            flash(validation_message, 'error')
            return redirect(url_for('portfolio.enrich'))
        
        # Process CSV with timeout protection - use chunked processing
        logger.info("Starting chunked CSV processing...")
        
        try:
            # Run import with a reasonable timeout approach
            success, message = import_csv_simple(account_id, file_content)
            
            # Return immediate response
            if success:
                logger.info(f"CSV upload successful: {message}")
                if is_ajax:
                    return jsonify({
                        'success': True, 
                        'message': message,
                        'redirect': url_for('portfolio.enrich')
                    })
                flash(message, 'success')
                return redirect(url_for('portfolio.enrich'))
            else:
                logger.error(f"CSV upload failed: {message}")
                if is_ajax:
                    return jsonify({'success': False, 'message': message}), 400
                flash(message, 'error')
                return redirect(url_for('portfolio.enrich'))
                
        except Exception as e:
            error_msg = f"CSV processing failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            if is_ajax:
                return jsonify({'success': False, 'message': error_msg}), 500
            flash(error_msg, 'error')
            return redirect(url_for('portfolio.enrich'))
            
    except UnicodeDecodeError:
        error_msg = "File encoding error. Please save your CSV as UTF-8."
        logger.error(error_msg)
        if is_ajax:
            return jsonify({'success': False, 'message': error_msg}), 400
        flash(error_msg, 'error')
        return redirect(url_for('portfolio.enrich'))
        
    except Exception as e:
        error_msg = f"Upload failed: {str(e)}"
        logger.error(f"Unexpected error during CSV upload: {e}", exc_info=True)
        if is_ajax:
            return jsonify({'success': False, 'message': error_msg}), 500
        flash(error_msg, 'error')
        return redirect(url_for('portfolio.enrich'))
