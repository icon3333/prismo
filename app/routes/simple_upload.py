"""
CSV Upload Endpoint with Background Processing
Uses background threads with database-based progress tracking for real-time updates.
"""

import logging
import threading
from flask import request, session, jsonify, flash, redirect, url_for, current_app, g
from app.utils.csv_import_simple import validate_csv_format
from app.utils.batch_processing import start_csv_processing_job
from app.decorators import require_auth
from app.utils.response_helpers import success_response, error_response, not_found_response, validation_error_response

logger = logging.getLogger(__name__)

@require_auth
def get_simple_upload_progress():
    """
    Get or clear real-time progress for background upload using database tracking.
    """
    try:
        if request.method == 'GET':
            # Check for job_id in session
            job_id = session.get('csv_upload_job_id')
            
            if job_id:
                # Get progress from database using existing function
                from app.utils.batch_processing import get_job_status
                job_status = get_job_status(job_id)
                
                logger.debug(f"Session has job_id={job_id}, job_status={job_status.get('status')}")
                
                # Clear completed/failed jobs from session
                if job_status.get('status') in ['completed', 'failed', 'cancelled']:
                    logger.info(f"Job {job_id} has terminal status '{job_status.get('status')}', clearing from session")
                    if 'csv_upload_job_id' in session:
                        del session['csv_upload_job_id']
                        session.modified = True
                
                # Return progress data
                if job_status.get('status') == 'processing':
                    return jsonify({
                        'current': job_status.get('progress', 0),
                        'total': job_status.get('total', 100),
                        'percentage': int((job_status.get('progress', 0) / max(job_status.get('total', 1), 1)) * 100),
                        'message': job_status.get('message', 'Processing...'),
                        'status': 'processing',
                        'job_id': job_id
                    })
                elif job_status.get('status') == 'completed':
                    return jsonify({
                        'current': job_status.get('total', 100),
                        'total': job_status.get('total', 100),
                        'percentage': 100,
                        'message': job_status.get('message', 'Upload completed successfully!'),
                        'status': 'completed',
                        'job_id': job_id
                    })
                elif job_status.get('status') == 'failed':
                    return jsonify({
                        'current': 0,
                        'total': 0,
                        'percentage': 0,
                        'message': job_status.get('message', 'Upload failed'),
                        'status': 'failed',
                        'job_id': job_id
                    })
            
            # No job_id or job not found - return idle status
            return jsonify({
                'current': 0,
                'total': 0,
                'percentage': 0,
                'message': 'No active upload',
                'status': 'idle'
            })
        
        elif request.method == 'DELETE':
            # Clear CSV upload job from session
            job_id = session.get('csv_upload_job_id')
            if job_id:
                logger.info(f"Manually clearing CSV upload job {job_id} for account {session.get('account_id')}")
                del session['csv_upload_job_id']
                session.modified = True
            
            return jsonify({'message': f'CSV upload progress cleared (was tracking job_id: {job_id})'})
        
    except Exception as e:
        logger.error(f"Error handling simple upload progress: {e}")
        return error_response('Error handling progress', 500)

@require_auth
def upload_csv_simple():
    """
    Background CSV upload endpoint with real-time progress tracking.
    Starts background processing and returns immediately with job_id.
    """
    account_id = g.account_id
    logger.info(f"Background CSV upload request - account_id: {account_id}")

    # Determine if this is an AJAX request
    accept_header = request.headers.get('Accept', '')
    is_ajax = ('application/json' in accept_header or
               request.headers.get('X-Requested-With') == 'XMLHttpRequest')
    logger.info(f"Processing CSV upload for account_id: {account_id}")

    # File validation
    if 'csv_file' not in request.files:
        logger.warning("CSV upload failed - no csv_file in request.files")
        if is_ajax:
            return error_response('No file uploaded', 400)
        flash('No file uploaded', 'error')
        return redirect(url_for('portfolio.enrich'))

    file = request.files['csv_file']
    logger.info(f"CSV file received: {file.filename}")

    if file.filename == '':
        logger.warning("CSV upload failed - empty filename")
        if is_ajax:
            return error_response('No file selected', 400)
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
                return validation_error_response('csv_file', validation_message)
            flash(validation_message, 'error')
            return redirect(url_for('portfolio.enrich'))
        
        # Get import mode (add or replace)
        mode = request.form.get('mode', 'replace')
        logger.info(f"Import mode: {mode}")

        # Start background processing
        logger.info("Starting background CSV processing...")

        try:
            # Start background job and get job_id
            job_id = start_csv_processing_job(account_id, file_content, mode=mode)
            
            # Store job_id in session for progress tracking
            session['csv_upload_job_id'] = job_id
            session.modified = True
            
            logger.info(f"CSV processing job started successfully with job_id: {job_id}")
            
            # Return immediate response with job_id
            if is_ajax:
                return success_response(
                    data={'job_id': job_id, 'redirect': url_for('portfolio.enrich')},
                    message='Upload started successfully'
                )
            flash('Upload started successfully. Please wait for completion.', 'info')
            return redirect(url_for('portfolio.enrich'))

        except Exception as e:
            error_msg = f"Failed to start CSV processing: {str(e)}"
            logger.error(error_msg, exc_info=True)
            if is_ajax:
                return error_response(error_msg, 500)
            flash(error_msg, 'error')
            return redirect(url_for('portfolio.enrich'))
            
    except UnicodeDecodeError:
        error_msg = "File encoding error. Please save your CSV as UTF-8."
        logger.error(error_msg)
        if is_ajax:
            return error_response(error_msg, 400)
        flash(error_msg, 'error')
        return redirect(url_for('portfolio.enrich'))

    except Exception as e:
        error_msg = f"Upload failed: {str(e)}"
        logger.error(f"Unexpected error during CSV upload: {e}", exc_info=True)
        if is_ajax:
            return error_response(error_msg, 500)
        flash(error_msg, 'error')
        return redirect(url_for('portfolio.enrich'))
