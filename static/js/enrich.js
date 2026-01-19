/**
 * Portfolio Enrichment Page JavaScript
 * Handles file uploads, portfolio management, and data visualization
 */

// Debug mode - set to true for development, false for production
const DEBUG = false;

// Helper function for conditional debug logging
function debugLog(...args) {
    if (DEBUG) console.log(...args);
}

// Centralized Progress Manager - handles all progress tracking
const ProgressManager = {
    elements: {
        // Price fetch elements
        priceProgressElement: null,
        priceProgressPercentage: null,
        priceProgressBar: null,
        priceProgressText: null,
        // CSV upload elements
        csvUploadIndicator: null,
        uploadPercentage: null,
        uploadProgressBar: null,
        uploadStatusMessage: null
    },

    currentJob: {
        type: null, // 'simple_csv_upload', 'price_fetch'
        interval: null,
        startTime: null
    },

    init() {
        debugLog('ProgressManager: Initializing...');
        
        // Initialize price fetch elements
        this.elements.priceProgressElement = document.getElementById('price-fetch-progress');
        this.elements.priceProgressPercentage = document.getElementById('progress-percentage');
        this.elements.priceProgressBar = document.getElementById('progress-bar');
        this.elements.priceProgressText = document.getElementById('progress-text');

        // Initialize CSV upload elements
        this.elements.csvUploadIndicator = document.getElementById('csv-upload-indicator');
        this.elements.uploadPercentage = document.getElementById('upload-percentage');
        this.elements.uploadProgressBar = document.getElementById('upload-progress-bar');
        this.elements.uploadStatusMessage = document.getElementById('upload-status-message');

        debugLog('ProgressManager: Elements found:', {
            priceProgressElement: !!this.elements.priceProgressElement,
            priceProgressPercentage: !!this.elements.priceProgressPercentage,
            priceProgressBar: !!this.elements.priceProgressBar,
            priceProgressText: !!this.elements.priceProgressText,
            csvUploadIndicator: !!this.elements.csvUploadIndicator,
            uploadPercentage: !!this.elements.uploadPercentage,
            uploadProgressBar: !!this.elements.uploadProgressBar,
            uploadStatusMessage: !!this.elements.uploadStatusMessage
        });
        
        // Debug: Log actual element visibility
        if (this.elements.priceProgressElement) {
            debugLog('Progress element display style:', this.elements.priceProgressElement.style.display);
            debugLog('Progress element computed style:', window.getComputedStyle(this.elements.priceProgressElement).display);
        }

        if (!this.elements.priceProgressElement && !this.elements.csvUploadIndicator) {
            console.warn('No progress or indicator elements found - some features may be disabled');
            return false;
        }

        this.hide();
        
        // Check for ongoing upload progress on page load
        this.checkForOngoingUploads();
        
        return true;
    },

    async checkForOngoingUploads() {
        // For simplified upload system, we don't need to check for ongoing uploads
        // since processing happens synchronously and completes immediately
        debugLog('Simplified upload system - no background uploads to check');
        
        // Clear any stale progress data from old system
        try {
            await fetch('/portfolio/api/simple_upload_progress', { 
                method: 'DELETE',
                credentials: 'include'
            });
            debugLog('Cleared any stale progress data from previous system');
        } catch (error) {
            debugLog('No stale progress data to clear');
        }
    },

    show(jobType = 'price_fetch') {
        this.currentJob.type = jobType;
        this.currentJob.startTime = Date.now();

        debugLog(`ProgressManager: Showing progress for ${jobType}`);

        if (jobType === 'simple_csv_upload' && this.elements.csvUploadIndicator) {
            debugLog('ProgressManager: Displaying CSV upload indicator');
            this.elements.csvUploadIndicator.style.display = 'block';
        } else if ((jobType === 'price_fetch' || jobType === 'selected_price_fetch') && this.elements.priceProgressElement) {
            debugLog('ProgressManager: Displaying price fetch progress element');
            this.elements.priceProgressElement.style.display = 'block';
            this.elements.priceProgressElement.style.visibility = 'visible';
            this.elements.priceProgressElement.style.opacity = '1';
            this.elements.priceProgressElement.dataset.processing = 'true';
            debugLog('ProgressManager: Progress element visibility set:', {
                display: this.elements.priceProgressElement.style.display,
                visibility: this.elements.priceProgressElement.style.visibility,
                opacity: this.elements.priceProgressElement.style.opacity
            });
        } else {
            console.warn(`ProgressManager: Unhandled job type '${jobType}' or missing elements`);
        }

        this.setProgress(0, 'Initializing...', 0, 0);
    },

    hide() {
        if (this.elements.csvUploadIndicator) {
            this.elements.csvUploadIndicator.style.display = 'none';
        }
        if (this.elements.priceProgressElement) {
            this.elements.priceProgressElement.style.display = 'none';
            delete this.elements.priceProgressElement.dataset.processing;
        }
        this.stopTracking();
    },

    setProgress(percentage, message = null, current = 0, total = 0) {
        const jobType = this.currentJob.type;

        debugLog(`ProgressManager: Setting progress ${percentage}% for ${jobType}${message ? ` - ${message}` : ''} (${current}/${total})`);

        if (jobType === 'simple_csv_upload') {
            // Handle simple CSV upload progress
            if (this.elements.uploadPercentage) {
                this.elements.uploadPercentage.textContent = `${Math.round(percentage)}%`;
            } else {
                console.warn('ProgressManager: uploadPercentage element not found for CSV progress');
            }
            
            // Update progress bar [[memory:6980966]]
            if (this.elements.uploadProgressBar) {
                this.elements.uploadProgressBar.value = percentage;
                // Add smooth transition effect
                this.elements.uploadProgressBar.style.transition = 'value 0.3s ease';
            } else {
                console.warn('ProgressManager: uploadProgressBar element not found for CSV progress');
            }
            
            // Update status message if provided
            if (message && this.elements.uploadStatusMessage) {
                // Format message for better display
                if (message.includes('✓')) {
                    // Success message - show completed item
                    this.elements.uploadStatusMessage.textContent = message;
                    this.elements.uploadStatusMessage.className = 'is-size-7 has-text-success mb-0';
                } else if (message.includes('failed') || message.includes('error')) {
                    // Error message
                    this.elements.uploadStatusMessage.textContent = message;
                    this.elements.uploadStatusMessage.className = 'is-size-7 has-text-danger mb-0';
                } else if (message.includes('completed') || message.includes('success')) {
                    // Completion message
                    this.elements.uploadStatusMessage.textContent = message;
                    this.elements.uploadStatusMessage.className = 'is-size-7 has-text-success mb-0';
                } else {
                    // Normal processing message
                    this.elements.uploadStatusMessage.textContent = message;
                    this.elements.uploadStatusMessage.className = 'is-size-7 has-text-grey mb-0';
                }
            }
            
            return;
        } else if (jobType === 'price_fetch' || jobType === 'selected_price_fetch') {
            // Handle price fetch progress (both all and selected)
            debugLog('ProgressManager: Updating price progress UI elements', {
                hasProgressElement: !!this.elements.priceProgressElement,
                hasProgressBar: !!this.elements.priceProgressBar,
                hasProgressText: !!this.elements.priceProgressText,
                percentage, current, total
            });
            
            if (this.elements.priceProgressPercentage) {
                this.elements.priceProgressPercentage.textContent = `${Math.round(percentage)}%`;
            } else {
                console.warn('ProgressManager: priceProgressPercentage element not found for price progress');
            }
            if (this.elements.priceProgressBar) {
                this.elements.priceProgressBar.value = percentage;
                // Add smooth transition effect
                this.elements.priceProgressBar.style.transition = 'value 0.3s ease';
                debugLog('ProgressManager: Updated progress bar to', percentage + '%');
            } else {
                console.warn('ProgressManager: priceProgressBar element not found for price progress');
            }
            
            // Update company count text
            if (this.elements.priceProgressText) {
                this.elements.priceProgressText.textContent = `${current} / ${total} companies updated`;
                debugLog('ProgressManager: Updated progress text to', `${current} / ${total} companies updated`);
            } else {
                console.warn('ProgressManager: priceProgressText element not found for progress text');
            }
        } else {
            console.warn(`ProgressManager: Unknown job type: ${jobType}`);
        }
    },

    startTracking(jobType = 'price_fetch', checkInterval = 500) {
        this.stopTracking(); // Clear any existing interval
        this.show(jobType);

        if (jobType === 'simple_csv_upload') {
            // Start polling for simple CSV upload progress
            this.startCsvUploadProgress(checkInterval);
        } else if (jobType === 'price_fetch') {
            this.startPriceFetchProgress(checkInterval);
        }
    },

    stopTracking() {
        if (this.currentJob.interval) {
            clearInterval(this.currentJob.interval);
            this.currentJob.interval = null;
        }
        this.currentJob.type = null;
        this.currentJob.startTime = null;
    },

    startPriceFetchProgress(checkInterval = 500) {
        this.currentJob.interval = setInterval(() => {
            this.checkPriceFetchProgress();
        }, checkInterval);

        // Run once immediately
        this.checkPriceFetchProgress();
    },

    startCsvUploadProgress(checkInterval = 250) {
        // Use shorter interval for more responsive progress updates
        this.currentJob.interval = setInterval(() => {
            this.checkCsvProgress();
        }, checkInterval);

        // Run once immediately
        this.checkCsvProgress();
    },

    async checkPriceFetchProgress() {
        try {
            const response = await fetch('/portfolio/api/price_fetch_progress');
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            debugLog("Price fetch progress:", data);

            const percentage = data.percentage || 0;
            const current = data.current || 0;
            const total = data.total || 0;
            this.setProgress(percentage, null, current, total);

            // Check completion
            if (data.status === 'completed' || percentage >= 100) {
                this.complete();
            }
        } catch (error) {
            console.error('Error checking price fetch progress:', error);
            this.setProgress(0, null, 0, 0);
        }
    },

    async checkCsvProgress() {
        try {
            // Use the appropriate endpoint based on upload type
            const endpoint = '/portfolio/api/simple_upload_progress';
            
            const response = await fetch(endpoint, {
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            debugLog("CSV upload progress:", data);
            debugLog(`DEBUG: Received status='${data.status}', message='${data.message}', job_id='${data.job_id}'`);

                            // Check for stuck jobs - if a job has been running for more than 5 minutes without progress, consider it stuck
            if (data.status === 'processing' && this.currentJob.startTime) {
                const timeElapsed = Date.now() - this.currentJob.startTime;
                const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
                
                if (timeElapsed > fiveMinutes && data.percentage === 0) {
                    console.warn('Job appears to be stuck - no progress after 5 minutes, will stop tracking...');
                    this.error('Upload appears to be stuck. Please try again.');
                    
                    // Simple uploads don't have cancellation endpoints, just stop tracking
                    this.stopTracking();
                    return;
                }
            }

            const percentage = data.percentage || 0;
            const message = data.message || 'Processing...';
            this.setProgress(percentage, message);

            // Check completion
            if (data.status === 'completed') {
                this.setProgress(100, 'Upload completed successfully!');
                this.stopTracking();
                
                // Show success notification
                if (typeof showNotification === 'function') {
                    showNotification('CSV upload completed successfully!', 'is-success');
                }
                
                setTimeout(() => {
                    this.hide();
                    // Clear the progress from session
                    fetch('/portfolio/api/simple_upload_progress', { 
                        method: 'DELETE',
                        credentials: 'include'
                    }).catch(() => { });
                    
                    // Instead of reloading, refresh data via API calls - prevents browser refresh
                    if (typeof window.portfolioTableApp !== 'undefined' && window.portfolioTableApp.loadData) {
                        debugLog('Refreshing portfolio data after successful upload...');
                        window.portfolioTableApp.loadData();
                    } else {
                        debugLog('Portfolio app not found, falling back to page reload');
                        window.location.reload();
                    }
                    
                    // Reset the upload form
                    const form = document.querySelector('form[action*="upload"]');
                    if (form && typeof FileUploadHandler !== 'undefined' && FileUploadHandler.resetForm) {
                        debugLog('Form reset completed');
                        FileUploadHandler.resetForm(form);
                    }
                }, 2000);
                
            } else if (data.status === 'failed' || data.status === 'cancelled') {
                this.error(data.message || `Upload ${data.status}`);
                this.stopTracking();
                
                debugLog(`CSV upload ${data.status}: ${data.message}`);
                
                setTimeout(() => {
                    this.hide();
                    // Clear the progress from session
                    fetch('/portfolio/api/simple_upload_progress', { 
                        method: 'DELETE',
                        credentials: 'include'
                    }).catch(() => { });
                }, 3000);
                
            } else if (data.status === 'idle') {
                debugLog(`Upload status changed to idle: ${data.message}`);
                
                // Check if this was a terminal status message
                if (data.message && (data.message.includes('failed') || data.message.includes('cancelled'))) {
                    this.error(data.message);
                    this.stopTracking();
                    setTimeout(() => this.hide(), 3000);
                    return;
                }
                
                // No active upload found - check how long we've been polling
                const pollingDuration = Date.now() - this.currentJob.startTime;
                debugLog(`No active upload found - polling duration: ${pollingDuration}ms`);
                
                // Increased timeout to 30 seconds and added more sophisticated checking
                if (pollingDuration > 30000) {
                    debugLog('Checking if upload might have completed despite progress tracking issues...');
                    
                    // Before giving up, try to reload the page to check if data was actually updated
                    try {
                        const dataResponse = await fetch('/portfolio/api/portfolio_data', { cache: 'no-store' });
                        if (dataResponse.ok) {
                            const portfolioData = await dataResponse.json();
                            
                            // If we have data, the upload likely succeeded despite progress tracking issues
                            if (Array.isArray(portfolioData) && portfolioData.length > 0) {
                                debugLog('Upload appears to have succeeded despite progress tracking issues');
                                this.setProgress(100, 'Upload completed (detected from data)!');
                                
                                if (typeof showNotification === 'function') {
                                    showNotification('CSV upload completed successfully!', 'is-success');
                                }
                                
                                setTimeout(() => {
                                    this.hide();
                                    window.location.reload();
                                }, 2000);
                                return;
                            }
                        }
                    } catch (checkError) {
                        console.warn('Could not verify upload completion:', checkError);
                    }
                    
                    debugLog('Stopping polling - no progress found after 30 seconds');
                    this.error('Upload may have failed to start or completed without proper progress tracking. Please check if your data was updated, or try again.');
                    this.stopTracking();
                }
            } else if (data.status === 'processing' || percentage > 0) {
                // We have active progress, reset any timeout concerns
                // This ensures we don't timeout while actually processing
                debugLog(`Upload is actively processing: ${percentage}% - ${message}`);
            }
            
        } catch (error) {
            console.error('Error checking CSV upload progress:', error);
            
            // Don't immediately fail on network errors - the upload might still be processing
            const pollingDuration = Date.now() - this.currentJob.startTime;
            
            // Only give up on network errors after a reasonable time
            if (pollingDuration > 45000) {
                console.warn('Network errors persisting for 45+ seconds, giving up');
                this.error('Unable to track upload progress. Please check if your data was updated, or try again.');
                this.stopTracking();
            } else {
                console.warn('Network error while checking progress - will keep trying');
            }
        }
    },

    complete(finalPercentage = 100) {
        debugLog('ProgressManager: Completing progress tracking');
        this.setProgress(finalPercentage, 'Complete');

        // Ensure minimum display time so users can see completion
        setTimeout(() => {
            this.hide();
        }, 1500); // Increased to 1.5 seconds for better visibility
    },

    error(message = 'Operation failed') {
        console.error('Progress error:', message);
        
        const jobType = this.currentJob.type;
        
        // Safely set error message based on job type
        if (jobType === 'simple_csv_upload' && this.elements.uploadPercentage) {
            this.elements.uploadPercentage.textContent = 'Error';
        } else if ((jobType === 'price_fetch' || jobType === 'selected_price_fetch')) {
            if (this.elements.priceProgressPercentage) {
                this.elements.priceProgressPercentage.textContent = 'Error';
            }
            if (this.elements.priceProgressText) {
                this.elements.priceProgressText.textContent = 'Update failed';
            }
        } else {
            console.warn('ProgressManager: Could not display error message - no suitable element found');
        }
        
        // Show user-friendly notification if available
        if (typeof showNotification === 'function') {
            showNotification(message, 'is-danger');
        }
        
        setTimeout(() => {
            this.hide();
        }, 3000); // Show error longer for user to read
    }
};

// DOM Elements and Utility Functions
const UpdateAllDataHandler = {
    async run() {
        const updateAllDataBtn = document.getElementById('update-all-data-btn');

        if (!updateAllDataBtn) {
            console.error('Update all data button not found');
            return;
        }

        try {
            // Disable the button to prevent multiple clicks
            updateAllDataBtn.disabled = true;
            updateAllDataBtn.classList.add('is-loading');

            // Make the API call
            const response = await fetch('/portfolio/api/update_all_prices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (response.ok) {
                // Show success notification
                if (typeof showNotification === 'function') {
                    showNotification(result.message || 'Started updating all prices and metadata', 'is-success');
                } else {
                    debugLog('Success:', result.message || 'Started updating all prices and metadata');
                }

                // Start progress tracking using ProgressManager (same pattern as CSV upload)
                debugLog('Starting progress tracking for price fetch...');
                ProgressManager.startTracking('price_fetch', 500);

                // Set up completion handler - check for completion status
                const completionCheckInterval = setInterval(async () => {
                    try {
                        const progressResponse = await fetch('/portfolio/api/price_fetch_progress');
                        if (progressResponse.ok) {
                            const progressData = await progressResponse.json();

                            if (progressData.status === 'completed' || progressData.percentage >= 100) {
                                clearInterval(completionCheckInterval);
                                ProgressManager.stopTracking();
                                ProgressManager.complete();

                                // Show completion notification
                                if (typeof showNotification === 'function') {
                                    showNotification('Price update complete! Updated all companies successfully.', 'is-success');
                                }

                                // Reload the data
                                setTimeout(async () => {
                                    if (window.portfolioTableApp && typeof window.portfolioTableApp.loadData === 'function') {
                                        await window.portfolioTableApp.loadData();
                                        debugLog('Portfolio data reloaded after price update completion');
                                    } else {
                                        console.warn('portfolioTableApp.loadData is not available, reloading page instead');
                                        window.location.reload();
                                    }
                                }, 1000);
                            }
                        }
                    } catch (error) {
                        console.error('Error checking completion status:', error);
                    }
                }, 1000);
            } else {
                ProgressManager.error();
                throw new Error(result.message || 'Failed to start price update');
            }
        } catch (error) {
            console.error('Error updating all prices:', error);
            ProgressManager.error(error.message || 'Error updating prices');
            if (typeof showNotification === 'function') {
                showNotification(error.message || 'Error updating prices', 'is-danger');
            }
        } finally {
            // Re-enable the button
            updateAllDataBtn.disabled = false;
            updateAllDataBtn.classList.remove('is-loading');
        }
    }
};

const UpdateSelectedHandler = {
    async run(selectedCompanyIds) {
        debugLog('UpdateSelectedHandler: Starting with company IDs:', selectedCompanyIds);

        if (!selectedCompanyIds || selectedCompanyIds.length === 0) {
            console.error('No companies selected for update');
            return;
        }

        try {
            debugLog('Starting selected price update for companies:', selectedCompanyIds);

            // Make the API call
            const response = await fetch('/portfolio/api/update_selected_prices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ company_ids: selectedCompanyIds })
            });

            const result = await response.json();

            if (response.ok) {
                // Show success notification
                if (typeof showNotification === 'function') {
                    showNotification(result.message || 'Started updating selected companies', 'is-success');
                } else {
                    debugLog('Success:', result.message || 'Started updating selected companies');
                }

                // Start progress tracking using ProgressManager (same pattern as CSV upload)
                debugLog('Starting progress tracking for selected price fetch...');
                ProgressManager.startTracking('selected_price_fetch', 500);

                // Set up completion handler - check for completion status
                const completionCheckInterval = setInterval(async () => {
                    try {
                        const progressResponse = await fetch('/portfolio/api/price_fetch_progress');
                        if (progressResponse.ok) {
                            const progressData = await progressResponse.json();

                            if (progressData.status === 'completed' || progressData.percentage >= 100) {
                                clearInterval(completionCheckInterval);
                                ProgressManager.stopTracking();
                                ProgressManager.complete();

                                // Show completion notification
                                if (typeof showNotification === 'function') {
                                    showNotification(`Selected companies update complete! Updated ${progressData.current || 0} companies successfully.`, 'is-success');
                                }

                                // Reload the data
                                setTimeout(async () => {
                                    if (window.portfolioTableApp && typeof window.portfolioTableApp.loadData === 'function') {
                                        await window.portfolioTableApp.loadData();
                                        debugLog('Portfolio data reloaded after selected update completion');
                                    } else {
                                        console.warn('portfolioTableApp.loadData is not available, reloading page instead');
                                        window.location.reload();
                                    }
                                }, 1000);
                            }
                        }
                    } catch (error) {
                        console.error('Error checking completion status:', error);
                    }
                }, 1000);
            } else {
                ProgressManager.error();
                throw new Error(result.error || 'Failed to start selected price update');
            }
        } catch (error) {
            console.error('Error updating selected prices:', error);
            ProgressManager.error(error.message || 'Error updating selected prices');
            if (typeof showNotification === 'function') {
                showNotification(error.message || 'Error updating selected prices', 'is-danger');
            }
        }
    }
};

const FileUploadHandler = {
    init() {
        const fileInput = document.querySelector('.file-input');
        const fileLabel = document.querySelector('.file-name');
        const uploadForm = document.querySelector('form[action*="upload"]');
        const uploadCard = document.getElementById('upload-card');

        debugLog('FileUploadHandler: Debugging elements found:');
        debugLog('  fileInput:', fileInput);
        debugLog('  fileLabel:', fileLabel);
        debugLog('  uploadForm:', uploadForm);
        debugLog('  uploadCard:', uploadCard);

        if (!fileInput || !fileLabel || !uploadForm || !uploadCard) {
            console.error('Required file upload elements not found');
            console.error('Missing elements:', {
                fileInput: !fileInput,
                fileLabel: !fileLabel,
                uploadForm: !uploadForm,
                uploadCard: !uploadCard
            });
            return;
        }

        debugLog('FileUploadHandler: Initializing CSV upload handler');
        debugLog('Upload form action:', uploadForm.action);
        debugLog('Upload form method:', uploadForm.method);

        // File selection handler
        fileInput.addEventListener('change', function () {
            debugLog('File input change event triggered');
            debugLog('Files length:', fileInput.files.length);

            if (fileInput.files.length > 0) {
                const fileName = fileInput.files[0].name;
                const fileSize = fileInput.files[0].size;
                fileLabel.textContent = fileName;
                debugLog(`File selected: ${fileName}, size: ${fileSize} bytes`);

                // Prevent multiple submissions by checking if already processing
                if (uploadCard.classList.contains('is-processing')) {
                    debugLog('Upload already in progress, ignoring duplicate event');
                    return;
                }

                // Add a class to the card to indicate processing
                uploadCard.classList.add('is-processing');
                debugLog('Added is-processing class to upload card');

                // Upload file using reliable AJAX method
                FileUploadHandler.submitFile(fileInput.files[0], uploadForm);
            } else {
                fileLabel.textContent = 'No file selected';
                debugLog('No file selected');
            }
        });

        // Hide indicator on page load in case of back navigation
        window.addEventListener('pageshow', function (event) {
            // If the page is reloaded from cache, hide the indicator
            if (event.persisted) {
                ProgressManager.hide();
                uploadCard.classList.remove('is-processing');
            }
        });

        // Cancel button handler
        const cancelBtn = document.getElementById('cancel-upload-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', async function() {
                debugLog('Cancel button clicked');
                
                // Disable the button to prevent multiple clicks
                cancelBtn.disabled = true;
                cancelBtn.classList.add('is-loading');
                
                try {
                    const response = await fetch('/portfolio/api/simple_upload_progress', {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok && result.success) {
                        debugLog('Upload cancelled successfully');
                        
                        // Show cancellation message
                        ProgressManager.error('Upload cancelled by user');
                        
                        // Reset UI state immediately
                        uploadCard.classList.remove('is-processing');
                        
                        // Hide the cancel button immediately since upload is cancelled
                        const csvUploadIndicator = document.getElementById('csv-upload-indicator');
                        if (csvUploadIndicator) {
                            csvUploadIndicator.style.display = 'none';
                        }
                        
                        // Also disable the cancel button to prevent further clicks
                        cancelBtn.disabled = true;
                        cancelBtn.style.display = 'none';
                        
                        // Show notification
                        if (typeof showNotification === 'function') {
                            showNotification('Upload cancelled successfully', 'is-warning');
                        }
                        
                    } else {
                        console.error('Failed to cancel upload:', result.message);
                        
                        // Show error notification
                        if (typeof showNotification === 'function') {
                            showNotification(result.message || 'Failed to cancel upload', 'is-danger');
                        }
                    }
                    
                } catch (error) {
                    console.error('Error cancelling upload:', error);
                    
                    // Show error notification
                    if (typeof showNotification === 'function') {
                        showNotification('Error cancelling upload', 'is-danger');
                    }
                    
                } finally {
                    // Re-enable the button
                    cancelBtn.disabled = false;
                    cancelBtn.classList.remove('is-loading');
                }
            });
        } else {
            console.warn('Cancel upload button not found');
        }
    },

    async submitFile(file, form) {
        debugLog('Starting CSV file upload:', {
            fileName: file.name,
            fileSize: file.size,
            actionUrl: form.action
        });
        
        // Fix for local development: ensure we use relative URLs
        let uploadUrl = form.action;
        if (uploadUrl.includes('rebalancer.nniiccoo.com')) {
            // Replace production URL with relative path for local development
            uploadUrl = '/portfolio/upload';
            debugLog('Fixed upload URL for local development:', uploadUrl);
        }
        
        try {
            const formData = new FormData();
            formData.append('csv_file', file);

            debugLog('Uploading file via AJAX...');
            
            // Show simple loading indicator
            ProgressManager.show('simple_csv_upload');
            ProgressManager.setProgress(0, 'Starting upload...');
            
            // Use longer timeout for file uploads (120 seconds for large files)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.error('Upload timeout after 120 seconds');
            }, 120000);
            
            // Start the upload request (this will run in parallel with progress polling)
            const uploadPromise = fetch(uploadUrl, {
                method: 'POST',
                body: formData,
                credentials: 'include',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            // Wait for upload to start (should return immediately with job_id)
            const response = await uploadPromise;

            clearTimeout(timeoutId);
            
            debugLog('Upload response received:', {
                status: response.status,
                ok: response.ok,
                contentType: response.headers.get('content-type')
            });
            
            if (response.ok) {
                const result = await response.json();
                debugLog('Upload result:', result);
                
                if (result.success) {
                    debugLog('Upload started successfully, job_id:', result.job_id);
                    
                    // Update progress message to show upload has started
                    ProgressManager.setProgress(0, 'Upload started, processing...');
                    
                    // Start ProgressManager tracking for background uploads
                    ProgressManager.startTracking('simple_csv_upload', 250); // Fast polling for responsive UI
                    
                    // The ProgressManager will handle the rest via polling
                    // When polling detects completion, it will call the success handlers
                    return;
                } else {
                    throw new Error(result.message || 'Upload failed');
                }
            } else {
                const errorText = await response.text();
                throw new Error(`Upload failed with status ${response.status}: ${errorText}`);
            }
            
        } catch (error) {
            console.error('Upload failed:', error);
            
            let errorMessage = 'Upload failed';
            if (error.name === 'AbortError') {
                errorMessage = 'Upload timed out after 2 minutes. Please try again with a smaller file or check your connection.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            ProgressManager.error(errorMessage);
            
            // Show error notification
            if (typeof showNotification === 'function') {
                showNotification(errorMessage, 'is-danger');
            }
            
            // Reset upload card state
            const uploadCard = document.getElementById('upload-card');
            if (uploadCard) {
                uploadCard.classList.remove('is-processing');
            }
        }
    },

    async submitFileAjax(file, actionUrl) {
        try {
            // Fix for local development: ensure we use relative URLs
            let uploadUrl = actionUrl;
            if (uploadUrl.includes('rebalancer.nniiccoo.com')) {
                // Replace production URL with relative path for local development
                uploadUrl = '/portfolio/upload';
                debugLog('Fixed upload URL for local development:', uploadUrl);
            }
            
            debugLog('Submitting CSV file via AJAX...', {
                fileName: file.name,
                fileSize: file.size,
                actionUrl: actionUrl,
                fixedUrl: uploadUrl
            });

            // First, test basic connectivity
            debugLog('Testing server connectivity...');
            try {
                const testResponse = await fetch('/portfolio/api/portfolios', {
                    method: 'GET',
                    credentials: 'include'
                });
                debugLog('Connectivity test status:', testResponse.status);
            } catch (connectError) {
                console.error('Connectivity test failed:', connectError);
                debugLog('Server appears unreachable - this may be normal in Docker or when CORS is misconfigured');
                // Don't fallback immediately - try the upload anyway as it might work
            }

            // Start progress tracking now that we're actually uploading
            ProgressManager.startTracking('simple_csv_upload');

            const formData = new FormData();
            formData.append('csv_file', file);

            debugLog('Making fetch request to:', uploadUrl);
            debugLog('FormData contents:', formData.get('csv_file'));

            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData,
                credentials: 'include',
                headers: {
                    'Accept': 'application/json, text/html, */*'
                }
            });

            debugLog('Upload response status:', response.status);
            debugLog('Upload response headers:', response.headers);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
            }

            // Try to parse the response
            const contentType = response.headers.get('content-type');
            let result;
            
            if (contentType && contentType.includes('application/json')) {
                result = await response.json();
            } else {
                const text = await response.text();
                console.warn('Non-JSON response received:', text);
                // If it's an HTML response (redirect), it might be successful
                if (text.includes('success') || text.includes('CSV')) {
                    result = { success: true, message: 'CSV uploaded successfully' };
                } else {
                    throw new Error('Unexpected response format: ' + text.substring(0, 200));
                }
            }
            
            debugLog('Upload response data:', result);

            if (result.success) {
                debugLog('CSV upload successful:', result.message);
                ProgressManager.setProgress(100, 'Upload completed successfully!');
                
                // Wait a bit to show the completion message
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                console.error('CSV upload failed:', result.message);
                ProgressManager.complete();
                this.showErrorMessage(result.message || 'Upload failed');
            }
        } catch (error) {
            console.error('Error during AJAX CSV upload:', error);
            ProgressManager.complete();
            
            let errorMessage = 'Error uploading file. Please try again.';
            if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
                console.warn('AJAX upload failed with NetworkError, falling back to form submission');
                this.fallbackToFormSubmission(file, actionUrl);
                return;
            } else if (error.message.includes('HTTP error')) {
                errorMessage = `Server error during upload: ${error.message}`;
            }
            
            this.showErrorMessage(errorMessage);
        }
    },

    fallbackToFormSubmission(file, actionUrl) {
        debugLog('Using fallback form submission for CSV upload');
        
        // Since AJAX failed, let's try a direct approach
        // Reset the processing state first
        const uploadCard = document.getElementById('upload-card');
        if (uploadCard) {
            uploadCard.classList.remove('is-processing');
        }
        
        // Get the original form and submit it normally
        const originalForm = document.querySelector('form[action*="upload"]');
        if (originalForm) {
            debugLog('Submitting original form directly');
            originalForm.submit();
        } else {
            // Fallback: create a new form
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = actionUrl;
            form.enctype = 'multipart/form-data';
            form.style.display = 'none';
            
            // Create file input
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.name = 'csv_file';
            
            // Create a new FileList with our file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            
            form.appendChild(fileInput);
            document.body.appendChild(form);
            
            // Submit the form
            form.submit();
        }
    },

    showErrorMessage(message) {
        // Create a simple error notification
        const notification = document.createElement('div');
        notification.className = 'notification is-danger is-light';
        notification.innerHTML = `
            <button class="delete" onclick="this.parentElement.remove()"></button>
            ${message}
        `;

        // Insert at the top of the page
        const container = document.querySelector('.container') || document.body;
        container.insertBefore(notification, container.firstChild);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    },

    resetForm(form) {
        // Reset the file input
        const fileInput = form.querySelector('.file-input');
        if (fileInput) {
            fileInput.value = '';
        }
        
        // Reset the file label
        const fileLabel = form.querySelector('.file-name');
        if (fileLabel) {
            fileLabel.textContent = 'No file selected';
        }
        
        // Remove processing state
        const uploadCard = document.getElementById('upload-card');
        if (uploadCard) {
            uploadCard.classList.remove('is-processing');
        }
        
        debugLog('Form reset completed');
    }
};

const PortfolioManager = {
    init() {
        const actionSelect = document.getElementById('portfolio-action');
        const actionButton = document.getElementById('portfolio-action-btn');
        const addFields = document.getElementById('add-portfolio-fields');
        const renameFields = document.getElementById('rename-portfolio-fields');
        const deleteFields = document.getElementById('delete-portfolio-fields');
        const portfolioForm = document.getElementById('manage-portfolios-form');

        if (!actionSelect || !actionButton) {
            console.error('Required portfolio management elements not found');
            return;
        }

        // Action selection handler
        actionSelect.addEventListener('change', function () {
            const action = this.value;

            // Hide all fields first
            addFields.classList.add('is-hidden');
            renameFields.classList.add('is-hidden');
            deleteFields.classList.add('is-hidden');

            // Enable/disable action button
            actionButton.disabled = !action;

            // Show relevant fields based on action
            if (action === 'add') {
                addFields.classList.remove('is-hidden');
            } else if (action === 'rename') {
                renameFields.classList.remove('is-hidden');
            } else if (action === 'delete') {
                deleteFields.classList.remove('is-hidden');
            }
        });

        // Form validation before submit
        if (portfolioForm) {
            portfolioForm.addEventListener('submit', function (e) {
                const action = actionSelect.value;

                if (action === 'add') {
                    const addNameField = document.querySelector('input[name="add_portfolio_name"]');
                    if (!addNameField.value.trim()) {
                        e.preventDefault();
                        alert('Portfolio name cannot be empty');
                    }
                } else if (action === 'rename') {
                    const oldName = document.querySelector('select[name="old_name"]').value;
                    const newName = document.querySelector('input[name="new_name"]').value.trim();
                    if (!oldName || !newName) {
                        e.preventDefault();
                        alert('Both old and new portfolio names are required');
                    }
                } else if (action === 'delete') {
                    const deleteNameField = document.querySelector('select[name="delete_portfolio_name"]');
                    if (!deleteNameField.value) {
                        e.preventDefault();
                        alert('Please select a portfolio to delete');
                    }
                }
            });
        }
    }
};

const LayoutManager = {
    adjustCardHeights() {
        const cards = document.querySelectorAll('.columns > .column > .card');
        let maxContentHeight = 0;
        let targetHeight = 200; // Reduced target height for more compactness

        // Reset heights to auto first to get natural content height
        cards.forEach(card => {
            card.style.height = 'auto';
        });

        // Find the maximum content height
        cards.forEach(card => {
            const height = card.offsetHeight;
            if (height > maxContentHeight) {
                maxContentHeight = height;
            }
        });

        // Use the larger of target height or content height
        const finalHeight = Math.max(targetHeight, maxContentHeight);

        // Apply the consistent height to all cards
        cards.forEach(card => {
            card.style.height = `${finalHeight}px`;
        });
    },

    init() {
        this.adjustCardHeights();

        // Adjust heights on window resize
        window.addEventListener('resize', this.adjustCardHeights);
    }
};

// Portfolio Table Vue Application
class PortfolioTableApp {
    constructor(portfolios, defaultPortfolio = "") {
        this.app = new Vue({
            el: '#portfolio-table-app',
            data() {
                return {
                    portfolioItems: [],
                    portfolioOptions: portfolios,
                    selectedItem: {},
                    showUpdatePriceModal: false,
                    isUpdating: false,
                    loading: false,
                    metrics: {
                        total: 0,
                        health: 0,
                        totalValue: 0,
                        lastUpdate: null
                    },
                    selectedPortfolio: defaultPortfolio,
                    companySearchQuery: '',
                    sortColumn: '',
                    sortDirection: 'asc',
                    // Bulk edit properties
                    selectedItemIds: [],
                    bulkPortfolio: '',
                    bulkSector: '',
                    bulkThesis: '',
                    bulkCountry: '',
                    isBulkProcessing: false,
                    isUpdatingSelected: false,
                    // Track which items/fields are currently saving
                    savingStates: {},
                    // Track original values for commit-on-blur editing
                    editingOriginals: {},
                    // Track local editing values (prevents re-sorting while typing)
                    editingValues: {},
                    // Cash balance for portfolio totals
                    cashBalance: 0,
                    originalCashBalance: 0,
                    isSavingCash: false,
                    // Builder KPI data
                    builderData: null,
                    builderDataLoaded: false
                    // Country options now server-rendered like portfolios
                };
            },
            computed: {
                healthColorClass() {
                    if (!this.portfolioItems.length) return 'is-info';
                    const health = this.metrics.health;
                    if (health >= 90) return 'is-success';
                    if (health >= 70) return 'is-warning';
                    return 'is-danger';
                },
                // Total portfolio value including cash
                portfolioTotal() {
                    return (this.metrics.totalValue || 0) + (this.cashBalance || 0);
                },
                filteredPortfolioItems() {
                    debugLog(`Computing filtered items with portfolio=${this.selectedPortfolio}, companySearch=${this.companySearchQuery}`);

                    // First filter by selected portfolio
                    let filtered = this.selectedPortfolio
                        ? this.portfolioItems.filter(item => item.portfolio === this.selectedPortfolio)
                        : this.portfolioItems;

                    debugLog(`After portfolio filter: ${filtered.length} items`);

                    // Filter by company name if search query is provided
                    if (this.companySearchQuery && this.companySearchQuery.trim() !== '') {
                        const query = this.companySearchQuery.toLowerCase().trim();
                        filtered = filtered.filter(item => {
                            return item.company && item.company.toLowerCase().includes(query);
                        });
                        debugLog(`After company search filter: ${filtered.length} items`);
                    }

                    // Apply sorting if a sort column is specified
                    if (this.sortColumn) {
                        const direction = this.sortDirection === 'asc' ? 1 : -1;

                        filtered = [...filtered].sort((a, b) => {
                            // Handle special cases for calculated fields
                            if (this.sortColumn === 'total_value') {
                                // Use centralized calculator for consistent sorting
                                const aValue = calculateItemValue(a);
                                const bValue = calculateItemValue(b);
                                return direction * (aValue - bValue);
                            }

                            // For regular fields
                            let aVal = a[this.sortColumn];
                            let bVal = b[this.sortColumn];

                            // Handle null/undefined values
                            if (aVal === null || aVal === undefined) aVal = '';
                            if (bVal === null || bVal === undefined) bVal = '';

                            // Convert to numbers for numeric fields
                            if (this.sortColumn === 'shares' || this.sortColumn === 'price_eur' || this.sortColumn === 'total_invested') {
                                aVal = parseFloat(aVal) || 0;
                                bVal = parseFloat(bVal) || 0;
                                return direction * (aVal - bVal);
                            }

                            // Handle dates
                            if (this.sortColumn === 'last_updated') {
                                const aDate = aVal ? new Date(aVal) : new Date(0);
                                const bDate = bVal ? new Date(bVal) : new Date(0);
                                return direction * (aDate - bDate);
                            }

                            // Handle country sorting specially
                            if (this.sortColumn === 'country') {
                                // Use effective_country for sorting to ensure consistency
                                aVal = a.effective_country;
                                bVal = b.effective_country;
                                
                                // Normalize country values for consistent sorting
                                const normalizeCountry = (country) => {
                                    if (!country || country === 'N/A' || country === '') return 'ZZZ_Unknown'; // Sort unknowns to end
                                    if (country === '(crypto)') return 'AAA_Crypto'; // Sort crypto to beginning
                                    return String(country).trim();
                                };
                                
                                aVal = normalizeCountry(aVal);
                                bVal = normalizeCountry(bVal);
                            }

                            // String comparison for text fields
                            return direction * String(aVal).localeCompare(String(bVal));
                        });
                    }

                    return filtered;
                },
                // Checkbox selection computed properties
                allFilteredSelected() {
                    return this.filteredPortfolioItems.length > 0 &&
                        this.filteredPortfolioItems.every(item => this.selectedItemIds.includes(item.id));
                },
                someFilteredSelected() {
                    return this.selectedItemIds.length > 0 &&
                        this.filteredPortfolioItems.some(item => this.selectedItemIds.includes(item.id));
                },
                // Column health percentages
                portfolioHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.portfolio && item.portfolio.trim() !== '' && item.portfolio !== '-'
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                sectorHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.sector && item.sector.trim() !== ''
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                thesisHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.thesis && item.thesis.trim() !== ''
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                investmentTypeHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.investment_type && (item.investment_type === 'Stock' || item.investment_type === 'ETF')
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                priceHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.price_eur && item.price_eur > 0
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                countryHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.effective_country && item.effective_country.trim() !== '' && item.effective_country !== 'N/A'
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                // Value completeness percentage - positions with non-zero values
                valueCompletenessPercentage() {
                    if (!this.filteredPortfolioItems || this.filteredPortfolioItems.length === 0) {
                        return 0;
                    }

                    const valuedItems = this.filteredPortfolioItems.filter(item => {
                        // Has custom value
                        if (item.is_custom_value && item.custom_total_value && item.custom_total_value > 0) {
                            return true;
                        }
                        // Has market price
                        if (item.price_eur && item.price_eur > 0) {
                            return true;
                        }
                        return false;
                    });

                    return Math.round((valuedItems.length / this.filteredPortfolioItems.length) * 100);
                },
                // Color class for completeness KPI
                completenessColorClass() {
                    const pct = this.valueCompletenessPercentage;
                    if (pct === 100) return 'has-text-success';        // Green - complete
                    if (pct >= 70) return 'has-text-warning-dark';     // Orange - partial
                    return 'has-text-danger';                           // Red - low
                }
            },
            watch: {
                selectedPortfolio() {
                    // Update metrics when portfolio selection changes
                    debugLog('selectedPortfolio changed:', this.selectedPortfolio);
                    this.updateFilteredMetrics();
                },
                companySearchQuery() {
                    // Update metrics when search query changes
                    debugLog('companySearchQuery changed:', this.companySearchQuery);
                    this.updateFilteredMetrics();
                }
            },
            methods: {
                // Sync UI controls with Vue model for two-way binding
                syncUIWithVueModel() {
                    // Use a more robust approach with a setTimeout to ensure DOM is fully loaded
                    setTimeout(() => {
                        // Setup two-way binding with portfolio dropdown
                        const portfolioDropdown = document.getElementById('filter-portfolio');
                        if (portfolioDropdown) {
                            debugLog('Found portfolio dropdown element');
                            // Initial value from Vue to DOM
                            portfolioDropdown.value = this.selectedPortfolio;

                            // DOM to Vue binding
                            portfolioDropdown.addEventListener('change', () => {
                                debugLog('Portfolio dropdown changed to:', portfolioDropdown.value);
                                this.selectedPortfolio = portfolioDropdown.value;
                                // Force update filtered list
                                this.updateFilteredMetrics();
                            });

                            // Vue to DOM binding
                            this.$watch('selectedPortfolio', (newVal) => {
                                debugLog('selectedPortfolio changed in Vue:', newVal);
                                portfolioDropdown.value = newVal;
                            });
                        } else {
                            console.warn('Portfolio dropdown element not found with ID: filter-portfolio');
                        }

                        // Setup two-way binding with company search input
                        const companySearchInput = document.getElementById('company-search');
                        const clearSearchButton = document.getElementById('clear-company-search');

                        if (companySearchInput) {
                            debugLog('Found company search input element');
                            // Initial value from Vue to DOM
                            companySearchInput.value = this.companySearchQuery;

                            // DOM to Vue binding
                            companySearchInput.addEventListener('input', () => {
                                debugLog('Company search input changed to:', companySearchInput.value);
                                this.companySearchQuery = companySearchInput.value;
                                // Force update filtered list
                                this.updateFilteredMetrics();
                            });

                            // Vue to DOM binding
                            this.$watch('companySearchQuery', (newVal) => {
                                debugLog('companySearchQuery changed in Vue:', newVal);
                                companySearchInput.value = newVal;
                            });

                            // Setup clear button
                            if (clearSearchButton) {
                                clearSearchButton.addEventListener('click', () => {
                                    this.companySearchQuery = '';
                                    companySearchInput.value = '';
                                    companySearchInput.focus();
                                });
                            }
                        } else {
                            console.warn('Company search input element not found with ID: company-search');
                        }

                    }, 500); // 500ms delay to ensure DOM is fully loaded
                },

                updateAllData() {
                    UpdateAllDataHandler.run();
                },

                updateSelected() {
                    // Use the new async UpdateSelectedHandler instead of the old synchronous method
                    UpdateSelectedHandler.run(this.selectedItemIds);
                },

                // Cash balance tracking and saving
                trackOriginalCash() {
                    this.originalCashBalance = this.cashBalance;
                    debugLog('Tracked original cash balance:', this.originalCashBalance);
                },

                async commitCash(event) {
                    const inputValue = event.target.value;
                    const newCash = parseGermanNumber(inputValue);

                    // Validate the new value
                    if (isNaN(newCash) || newCash < 0) {
                        debugLog('Invalid cash value, reverting to original');
                        event.target.value = formatCurrencyRaw(this.cashBalance);
                        return;
                    }

                    // Check if value actually changed
                    if (Math.abs(newCash - this.originalCashBalance) < 0.01) {
                        debugLog('Cash value unchanged, skipping save');
                        return;
                    }

                    debugLog('Saving new cash balance:', newCash);
                    this.isSavingCash = true;

                    try {
                        const response = await fetch('/portfolio/api/account/cash', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ cash: newCash })
                        });

                        const result = await response.json();

                        if (response.ok && result.success) {
                            this.cashBalance = result.cash;
                            this.originalCashBalance = result.cash;
                            debugLog('Cash balance saved successfully:', result.cash);

                            if (typeof showNotification === 'function') {
                                showNotification('Cash balance updated', 'is-success');
                            }
                        } else {
                            throw new Error(result.error || 'Failed to save cash balance');
                        }
                    } catch (error) {
                        console.error('Error saving cash balance:', error);
                        // Revert to original value
                        this.cashBalance = this.originalCashBalance;
                        event.target.value = formatCurrencyRaw(this.cashBalance);

                        if (typeof showNotification === 'function') {
                            showNotification('Failed to save cash balance', 'is-danger');
                        }
                    } finally {
                        this.isSavingCash = false;
                    }
                },

                async loadCashBalance() {
                    try {
                        const response = await fetch('/portfolio/api/account/cash', {
                            credentials: 'include'
                        });

                        if (response.ok) {
                            const result = await response.json();
                            if (result.success) {
                                this.cashBalance = result.cash || 0;
                                this.originalCashBalance = this.cashBalance;
                                debugLog('Loaded cash balance:', this.cashBalance);
                            }
                        }
                    } catch (error) {
                        console.error('Error loading cash balance:', error);
                    }
                },

                // Builder KPI methods
                async loadBuilderData() {
                    try {
                        const response = await fetch('/portfolio/api/builder/investment-targets', {
                            credentials: 'include'
                        });

                        if (response.ok) {
                            const result = await response.json();
                            debugLog('Builder API response:', result);

                            // Response is wrapped: { success: true, data: { budget: { availableToInvest: ... } } }
                            const data = result.data || result;
                            if (data.budget && data.budget.availableToInvest !== undefined) {
                                this.builderData = {
                                    availableToInvest: data.budget.availableToInvest
                                };
                                debugLog('Loaded builder data:', this.builderData);
                            } else {
                                // Builder data exists but no budget configured
                                this.builderData = null;
                                debugLog('Builder data exists but no budget.availableToInvest');
                            }
                        } else if (response.status === 404 || response.status === 400) {
                            // Builder not configured or incomplete
                            this.builderData = null;
                            debugLog('Builder not configured or incomplete:', response.status);
                        } else {
                            this.builderData = null;
                            debugLog('Builder API error:', response.status);
                        }
                    } catch (error) {
                        console.error('Error loading builder data:', error);
                        this.builderData = null;
                    } finally {
                        this.builderDataLoaded = true;
                    }
                },

                async useBuilderAsCash() {
                    if (!this.builderData || this.builderData.availableToInvest === undefined) {
                        return;
                    }

                    const newCash = this.builderData.availableToInvest;
                    debugLog('Using builder available to invest as cash:', newCash);

                    this.isSavingCash = true;

                    try {
                        const response = await fetch('/portfolio/api/account/cash', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ cash: newCash })
                        });

                        const result = await response.json();

                        if (response.ok && result.success) {
                            this.cashBalance = result.cash;
                            this.originalCashBalance = result.cash;
                            debugLog('Cash balance updated from builder:', result.cash);

                            if (typeof showNotification === 'function') {
                                showNotification('Cash updated from Builder', 'is-success');
                            }
                        } else {
                            throw new Error(result.error || 'Failed to update cash balance');
                        }
                    } catch (error) {
                        console.error('Error updating cash from builder:', error);

                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update cash from Builder', 'is-danger');
                        }
                    } finally {
                        this.isSavingCash = false;
                    }
                },

                downloadCSV() {
                    // Use the current filtered items for CSV export
                    const dataToExport = this.filteredPortfolioItems;

                    if (dataToExport.length === 0) {
                        if (typeof showNotification === 'function') {
                            showNotification('No data available to export', 'is-warning');
                        } else {
                            alert('No data available to export');
                        }
                        return;
                    }

                    // Create CSV content
                    const headers = [
                        'Identifier',
                        'Company',
                        'Portfolio',
                        'Sector',
                        'Shares',
                        'Price (€)',
                        'Total Value (€)',
                        'Total Invested (€)',
                        'Last Updated'
                    ];

                    const csvRows = [headers.join(',')];

                    dataToExport.forEach(item => {
                        const row = [
                            this.escapeCSVField(item.identifier || ''),
                            this.escapeCSVField(item.company || ''),
                            this.escapeCSVField(item.portfolio || ''),
                            this.escapeCSVField(item.sector || ''),
                            this.escapeCSVField(formatGermanNumber(item.effective_shares || 0)),
                            this.escapeCSVField(formatGermanNumber(item.price_eur || 0)),
                            this.escapeCSVField(formatGermanNumber(calculateItemValue(item))),
                            this.escapeCSVField(formatGermanNumber(item.total_invested || 0)),
                            this.escapeCSVField(item.last_updated || '')
                        ];
                        csvRows.push(row.join(','));
                    });

                    // Create and download file
                    const csvContent = csvRows.join('\n');
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');

                    if (link.download !== undefined) {
                        const url = URL.createObjectURL(blob);
                        link.setAttribute('href', url);

                        // Generate filename with current date
                        const now = new Date();
                        const dateStr = now.toISOString().split('T')[0];
                        const portfolioFilter = this.selectedPortfolio ? `_${this.selectedPortfolio}` : '';
                        link.setAttribute('download', `portfolio_data${portfolioFilter}_${dateStr}.csv`);

                        link.style.visibility = 'hidden';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                        if (typeof showNotification === 'function') {
                            showNotification(`CSV file downloaded with ${dataToExport.length} records`, 'is-success');
                        }
                    }
                },

                escapeCSVField(field) {
                    // Handle null/undefined values
                    if (field === null || field === undefined) {
                        return '';
                    }

                    // Convert to string
                    const str = String(field);

                    // If field contains comma, quote, or newline, wrap in quotes and escape quotes
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return '"' + str.replace(/"/g, '""') + '"';
                    }

                    return str;
                },

                // This function will update the dropdown to only show portfolios that are actually used
                async loadData() {
                    this.loading = true;
                    debugLog('🔄 loadData: Starting to load portfolio data...');
                    try {
                        // Load portfolio items with timeout
                        debugLog('🔄 loadData: Fetching from /portfolio/api/portfolio_data');

                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

                        const response = await fetch('/portfolio/api/portfolio_data', {
                            cache: 'no-store',
                            credentials: 'same-origin',  // Ensure cookies are sent
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);
                        debugLog('🔄 loadData: Response received:', response.status, response.statusText);

                        // Check if redirected (authentication issue)
                        if (response.redirected) {
                            console.error('❌ loadData: Request was redirected to:', response.url);
                            throw new Error('Session expired - please refresh the page');
                        }

                        if (!response.ok) {
                            console.error('❌ loadData: HTTP error!', response.status);
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }

                        const data = await response.json();
                        debugLog('✅ loadData: Data parsed successfully, items:', Array.isArray(data) ? data.length : 'not an array');
                        
                        // Ensure data is an array
                        if (Array.isArray(data)) {
                            this.portfolioItems = data;
                        } else if (data && data.error) {
                            console.error('API error:', data.error);
                            this.portfolioItems = [];
                        } else {
                            console.warn('Unexpected data format, using empty array');
                            this.portfolioItems = [];
                        }
                        
                        debugLog('Loaded portfolio items:', this.portfolioItems);

                        // Extract unique portfolios from the data that are actually in use
                        const usedPortfolios = [...new Set(this.portfolioItems.map(item => item.portfolio))].filter(Boolean);
                        debugLog('Used portfolios:', usedPortfolios);

                        // Also refresh the portfolio options from the server but only keep those that are in use
                        try {
                            const portfoliosResponse = await fetch('/portfolio/api/portfolios', {
                                cache: 'no-store'
                            });
                            const portfoliosData = await portfoliosResponse.json();

                            if (Array.isArray(portfoliosData) && portfoliosData.length > 0) {
                                // Filter to only show portfolios that are actually in use
                                const filteredPortfolios = portfoliosData.filter(portfolio =>
                                    usedPortfolios.includes(portfolio));

                                this.portfolioOptions = filteredPortfolios;
                                debugLog('Updated portfolio options (filtered):', this.portfolioOptions);

                                // Update the DOM dropdown as well
                                const portfolioDropdown = document.getElementById('filter-portfolio');
                                if (portfolioDropdown) {
                                    // Save current selection
                                    const currentSelection = portfolioDropdown.value;

                                    // Clear existing options except the "All Portfolios" option
                                    while (portfolioDropdown.options.length > 1) {
                                        portfolioDropdown.remove(1);
                                    }

                                    // Add filtered options
                                    filteredPortfolios.forEach(portfolio => {
                                        const option = document.createElement('option');
                                        option.value = portfolio;
                                        option.text = portfolio;
                                        portfolioDropdown.add(option);
                                    });

                                    // Restore selection if it still exists, otherwise reset to "All Portfolios"
                                    if (filteredPortfolios.includes(currentSelection)) {
                                        portfolioDropdown.value = currentSelection;
                                    } else {
                                        portfolioDropdown.value = '';
                                        this.selectedPortfolio = '';
                                    }
                                }
                            } else {
                                console.warn('No portfolio options received or empty array');
                            }
                        } catch (portfolioError) {
                            console.error('Error refreshing portfolio options:', portfolioError);
                        }

                        // Update metrics based on whether we're filtering
                        if (this.selectedPortfolio) {
                            this.updateFilteredMetrics();
                        } else {
                            this.updateMetrics();
                        }

                        // Load cash balance for portfolio totals
                        await this.loadCashBalance();

                        // Load builder data for Available to Invest KPI
                        await this.loadBuilderData();
                    } catch (error) {
                        console.error('❌ Error loading portfolio data:', error);

                        // Show user-friendly error message
                        if (error.name === 'AbortError') {
                            console.error('❌ Request timed out after 15 seconds');
                            alert('Request timed out. Please check your connection and try refreshing the page.');
                        } else if (error.message.includes('Session expired')) {
                            alert('Your session has expired. Please refresh the page to log in again.');
                        } else {
                            console.error('❌ Unexpected error:', error.message);
                            // Set empty array to show "no data" message instead of infinite loading
                            this.portfolioItems = [];
                        }
                    } finally {
                        debugLog('🔄 loadData: Setting loading = false');
                        this.loading = false;
                    }
                },

                updateMetrics() {
                    const items = this.portfolioItems;
                    const missingPriceItems = items.filter(i => !i.price_eur || i.price_eur === 0 || i.price_eur === null);
                    this.metrics = {
                        total: items.length,
                        health: items.length ? Math.round(((items.length - missingPriceItems.length) / items.length) * 100) : 100,
                        // Use centralized value calculator for consistency
                        totalValue: calculatePortfolioTotal(items),
                        lastUpdate: items.reduce((latest, item) => !latest || (item.last_updated && item.last_updated > latest) ? item.last_updated : latest, null)
                    };
                },

                updateFilteredMetrics() {
                    // Get filtered data
                    const filteredItems = this.filteredPortfolioItems;
                    const missingPriceItems = filteredItems.filter(i => !i.price_eur || i.price_eur === 0 || i.price_eur === null);

                    // Update metrics
                    this.metrics = {
                        total: filteredItems.length,
                        health: filteredItems.length ? Math.round(((filteredItems.length - missingPriceItems.length) / filteredItems.length) * 100) : 100,
                        // Use centralized value calculator for consistency
                        totalValue: calculatePortfolioTotal(filteredItems),
                        lastUpdate: filteredItems.reduce((latest, item) => !latest || (item.last_updated && item.last_updated > latest) ? item.last_updated : latest, null)
                    };

                    // Force Vue to re-render the filtered list
                    this.$forceUpdate();
                    debugLog(`Updated metrics: ${this.metrics.total} items`);
                    debugLog(`Filtering conditions: portfolio=${this.selectedPortfolio}`);
                },

                confirmPriceUpdate(item) {
                    this.selectedItem = item;
                    // Instead of showing modal, directly update the price
                    this.updatePrice();
                },



                closeModal() {
                    this.showUpdatePriceModal = false;
                    this.selectedItem = {};

                    // Reload data when modal is closed to ensure table has latest data
                    this.loadData();
                },

                async updatePrice() {
                    if (!this.selectedItem.id) return;

                    this.isUpdating = true;
                    try {
                        const response = await fetch(`/portfolio/api/update_price/${this.selectedItem.id}`, {
                            method: 'POST'
                        });
                        const result = await response.json();

                        if (response.ok) {
                            // Refresh the data
                            await this.loadData();

                            // Show success notification
                            if (typeof showNotification === 'function') {
                                showNotification(result.message || 'Price updated successfully', 'is-success');
                            } else {
                                debugLog(result.message || 'Price updated successfully');
                            }
                        } else {
                            // Construct a meaningful error message
                            let errorMessage = result.error || 'Failed to update price';

                            // If we have additional details, add them
                            if (result.details) {
                                errorMessage += `\n\n${result.details}`;
                                console.error('Detailed error:', result.details);
                            }

                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(errorMessage, 'is-danger');
                            } else {
                                console.error('Error:', errorMessage);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating price:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Network error while updating price. Please try again.', 'is-danger');
                        }
                    } finally {
                        this.isUpdating = false;
                        // Reset the selected item after update is complete
                        this.selectedItem = {};
                    }
                },

                async updateSelectedPrices() {
                    if (this.selectedItemIds.length === 0) return;

                    this.isUpdatingSelected = true;
                    const selectedCount = this.selectedItemIds.length;
                    let successCount = 0;
                    let errorCount = 0;

                    try {
                        // Update each selected item
                        for (const itemId of this.selectedItemIds) {
                            try {
                                const response = await fetch(`/portfolio/api/update_price/${itemId}`, {
                                    method: 'POST'
                                });
                                const result = await response.json();

                                if (response.ok) {
                                    successCount++;
                                } else {
                                    errorCount++;
                                    console.error(`Error updating item ${itemId}:`, result.error);
                                }
                            } catch (error) {
                                errorCount++;
                                console.error(`Network error updating item ${itemId}:`, error);
                            }
                        }

                        // Refresh the data after all updates
                        await this.loadData();

                        // Show summary notification
                        let message = '';
                        if (successCount > 0 && errorCount === 0) {
                            message = `Successfully updated ${successCount} price${successCount > 1 ? 's' : ''}`;
                            if (typeof showNotification === 'function') {
                                showNotification(message, 'is-success');
                            }
                        } else if (successCount > 0 && errorCount > 0) {
                            message = `Updated ${successCount} price${successCount > 1 ? 's' : ''}, ${errorCount} failed`;
                            if (typeof showNotification === 'function') {
                                showNotification(message, 'is-warning');
                            }
                        } else {
                            message = `Failed to update ${errorCount} price${errorCount > 1 ? 's' : ''}`;
                            if (typeof showNotification === 'function') {
                                showNotification(message, 'is-danger');
                            }
                        }

                        // Clear selection after update
                        this.selectedItemIds = [];

                    } catch (error) {
                        console.error('Error in bulk price update:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Network error during bulk update. Please try again.', 'is-danger');
                        }
                    } finally {
                        this.isUpdatingSelected = false;
                    }
                },

                // ========================================
                // Commit-on-blur editing support methods
                // Uses local editing values to prevent re-sorting while typing
                // ========================================

                // Get local editing value (or fall back to item value if not editing)
                getEditingValue(item, field) {
                    return this.editingValues[item.id]?.[field] ?? item[field];
                },

                // Set local editing value (doesn't modify item, so no re-sort)
                setEditingValue(item, field, value) {
                    if (!this.editingValues[item.id]) {
                        this.$set(this.editingValues, item.id, {});
                    }
                    this.$set(this.editingValues[item.id], field, value);
                },

                // Track original value and initialize local editing value
                trackOriginal(item, field) {
                    // Store original for comparison on commit
                    if (!this.editingOriginals[item.id]) {
                        this.$set(this.editingOriginals, item.id, {});
                    }
                    this.$set(this.editingOriginals[item.id], field, item[field]);

                    // Initialize local editing value
                    if (!this.editingValues[item.id]) {
                        this.$set(this.editingValues, item.id, {});
                    }
                    this.$set(this.editingValues[item.id], field, item[field]);
                },

                // Track original shares value
                trackOriginalShares(item) {
                    if (!this.editingOriginals[item.id]) {
                        this.$set(this.editingOriginals, item.id, {});
                    }
                    this.$set(this.editingOriginals[item.id], 'shares', item.effective_shares);

                    // Initialize local editing value
                    if (!this.editingValues[item.id]) {
                        this.$set(this.editingValues, item.id, {});
                    }
                    this.$set(this.editingValues[item.id], 'shares', item.effective_shares);
                },

                // Track original total value
                trackOriginalTotalValue(item) {
                    if (!this.editingOriginals[item.id]) {
                        this.$set(this.editingOriginals, item.id, {});
                    }
                    const originalValue = item.custom_total_value ||
                        (item.price_eur ? item.price_eur * item.effective_shares : 0);
                    this.$set(this.editingOriginals[item.id], 'totalValue', originalValue);

                    // Initialize local editing value (store raw number)
                    if (!this.editingValues[item.id]) {
                        this.$set(this.editingValues, item.id, {});
                    }
                    this.$set(this.editingValues[item.id], 'totalValue', originalValue);
                },

                // Commit identifier change (on blur or enter)
                commitIdentifier(item) {
                    const original = this.editingOriginals[item.id]?.identifier;
                    const newValue = this.editingValues[item.id]?.identifier ?? item.identifier;

                    if (newValue !== original) {
                        // Sync local value to item (triggers one re-sort)
                        item.identifier = newValue;
                        // Show saving state and save
                        if (!this.savingStates[item.id]) {
                            this.$set(this.savingStates, item.id, {});
                        }
                        this.$set(this.savingStates[item.id], 'identifier', true);
                        this.saveIdentifierChange(item);
                    }
                    // Clean up
                    if (this.editingOriginals[item.id]) {
                        delete this.editingOriginals[item.id].identifier;
                    }
                    if (this.editingValues[item.id]) {
                        delete this.editingValues[item.id].identifier;
                    }
                },

                // Commit sector change (on blur or enter)
                commitSector(item) {
                    const original = this.editingOriginals[item.id]?.sector;
                    const newValue = this.editingValues[item.id]?.sector ?? item.sector;

                    if (newValue !== original) {
                        // Sync local value to item (triggers one re-sort)
                        item.sector = newValue;
                        // Show saving state and save
                        if (!this.savingStates[item.id]) {
                            this.$set(this.savingStates, item.id, {});
                        }
                        this.$set(this.savingStates[item.id], 'sector', true);
                        this.saveSectorChange(item);
                    }
                    // Clean up
                    if (this.editingOriginals[item.id]) {
                        delete this.editingOriginals[item.id].sector;
                    }
                    if (this.editingValues[item.id]) {
                        delete this.editingValues[item.id].sector;
                    }
                },

                // Commit thesis change (on blur or enter)
                commitThesis(item) {
                    const original = this.editingOriginals[item.id]?.thesis;
                    const newValue = this.editingValues[item.id]?.thesis ?? item.thesis;

                    if (newValue !== original) {
                        // Sync local value to item (triggers one re-sort)
                        item.thesis = newValue;
                        // Show saving state and save
                        if (!this.savingStates[item.id]) {
                            this.$set(this.savingStates, item.id, {});
                        }
                        this.$set(this.savingStates[item.id], 'thesis', true);
                        this.saveThesisChange(item);
                    }
                    // Clean up
                    if (this.editingOriginals[item.id]) {
                        delete this.editingOriginals[item.id].thesis;
                    }
                    if (this.editingValues[item.id]) {
                        delete this.editingValues[item.id].thesis;
                    }
                },

                // Commit shares change (on blur or enter)
                commitShares(item) {
                    const original = this.editingOriginals[item.id]?.shares;
                    const newShares = this.editingValues[item.id]?.shares ?? item.effective_shares;

                    if (newShares !== original) {
                        // Sync local value to item (triggers one re-sort)
                        item.effective_shares = newShares;
                        // Show saving state and save
                        if (!this.savingStates[item.id]) {
                            this.$set(this.savingStates, item.id, {});
                        }
                        this.$set(this.savingStates[item.id], 'shares', true);
                        this.saveSharesChange(item, newShares);
                    }
                    // Clean up
                    if (this.editingOriginals[item.id]) {
                        delete this.editingOriginals[item.id].shares;
                    }
                    if (this.editingValues[item.id]) {
                        delete this.editingValues[item.id].shares;
                    }
                },

                // Commit total value change (on blur or enter)
                commitTotalValue(item, formattedValue) {
                    const original = this.editingOriginals[item.id]?.totalValue;
                    const newValue = parseGermanNumber(formattedValue);

                    if (newValue !== original && newValue > 0) {
                        // Show saving state and save
                        if (!this.savingStates[item.id]) {
                            this.$set(this.savingStates, item.id, {});
                        }
                        this.$set(this.savingStates[item.id], 'totalValue', true);
                        this.saveTotalValueChange(item, formattedValue);
                    }
                    // Clean up
                    if (this.editingOriginals[item.id]) {
                        delete this.editingOriginals[item.id].totalValue;
                    }
                    if (this.editingValues[item.id]) {
                        delete this.editingValues[item.id].totalValue;
                    }
                },

                // ========================================
                // End commit-on-blur editing methods
                // ========================================

                // ========================================
                // Tooltip methods (using native title attribute)
                // ========================================

                showOverflowTooltip(event, content) {
                    if (content) {
                        event.target.title = content;
                    }
                },

                hideOverflowTooltip(event) {
                    event.target.title = '';
                },

                // ========================================
                // End tooltip methods
                // ========================================

                async savePortfolioChange(item) {
                    debugLog('savePortfolioChange called with item:', item);
                    if (!item || !item.id) {
                        console.error('Invalid item for portfolio change');
                        return;
                    }

                    try {
                        debugLog('Sending portfolio update request for item ID:', item.id, 'Portfolio:', item.portfolio);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                portfolio: item.portfolio || '-'
                            })
                        });

                        const result = await response.json();
                        debugLog('Portfolio update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Portfolio updated successfully', 'is-success', 3000);
                            } else {
                                debugLog('Portfolio updated successfully');
                            }
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating portfolio: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating portfolio: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating portfolio:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update portfolio', 'is-danger');
                        }
                    }
                },



                // Save identifier changes to the database
                async saveIdentifierChange(item) {
                    if (!item || !item.id) {
                        console.error('Invalid item for identifier change');
                        return;
                    }

                    try {
                        const payload = {
                            identifier: item.identifier || '',
                            is_identifier_user_edit: true
                        };
                        debugLog('🔍 DEBUG: Sending identifier update with payload:', payload);

                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        });

                        const result = await response.json();

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Identifier updated and price fetched automatically', 'is-success', 3000);
                            } else {
                                debugLog('Identifier updated and price fetched automatically');
                            }

                            // Refresh the data to show updated price (backend handles price update automatically)
                            await this.loadData();
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating identifier: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating identifier: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating identifier:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update identifier', 'is-danger');
                        }
                    }
                },

                async saveSectorChange(item) {
                    debugLog('saveSectorChange called with item:', item);
                    if (!item || !item.id) {
                        console.error('Invalid item for sector change');
                        return;
                    }

                    try {
                        debugLog('Sending sector update request for item ID:', item.id, 'Sector:', item.sector);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                sector: item.sector || ''
                            })
                        });

                        const result = await response.json();
                        debugLog('Sector update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Sector updated successfully', 'is-success', 3000);
                            } else {
                                debugLog('Sector updated successfully');
                            }
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating sector: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating sector: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating sector:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update sector', 'is-danger');
                        }
                    }
                },

                async saveThesisChange(item) {
                    debugLog('saveThesisChange called with item:', item);
                    if (!item || !item.id) {
                        console.error('Invalid item for thesis change');
                        return;
                    }

                    try {
                        debugLog('Sending thesis update request for item ID:', item.id, 'Thesis:', item.thesis);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                thesis: item.thesis || ''
                            })
                        });

                        const result = await response.json();
                        debugLog('Thesis update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Thesis updated successfully', 'is-success', 3000);
                            } else {
                                debugLog('Thesis updated successfully');
                            }
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating thesis: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating thesis: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating thesis:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update thesis', 'is-danger');
                        }
                    }
                },

                async saveInvestmentTypeChange(item) {
                    debugLog('saveInvestmentTypeChange called with item:', item);
                    if (!item || !item.id) {
                        console.error('Invalid item for investment type change');
                        return;
                    }

                    try {
                        debugLog('Sending investment type update request for item ID:', item.id, 'Type:', item.investment_type);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                investment_type: item.investment_type
                            })
                        });

                        const result = await response.json();
                        debugLog('Investment type update response:', result);

                        if (result.success) {
                            // Show success notification
                            if (typeof showNotification === 'function') {
                                const typeName = item.investment_type || 'Not Set';
                                showNotification(`Investment type updated to ${typeName}`, 'is-success', 3000);
                            } else {
                                debugLog('Investment type updated successfully');
                            }
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating investment type: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating investment type: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating investment type:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update investment type', 'is-danger');
                        }
                    }
                },

                // Save shares changes to the database
                async saveSharesChange(item, newShares) {
                    if (!item || !item.id) {
                        console.error('Invalid item for shares change');
                        return;
                    }

                    try {
                        // Ensure shares is a valid number
                        const shares = parseFloat(newShares);
                        if (isNaN(shares)) {
                            if (typeof showNotification === 'function') {
                                showNotification('Shares must be a valid number', 'is-warning');
                            }
                            return;
                        }

                        debugLog('Sending shares update request for item ID:', item.id, 'Override shares:', shares);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                override_share: shares,  // Store user edit in override_share column
                                is_user_edit: true  // Flag to indicate this is a manual user edit
                            })
                        });

                        const result = await response.json();
                        debugLog('Shares update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Shares updated successfully', 'is-success', 3000);
                            } else {
                                debugLog('Shares updated successfully');
                            }

                            // Update the item to reflect manual edit status
                            item.is_manually_edited = true;
                            item.manual_edit_date = new Date().toISOString();
                            item.csv_modified_after_edit = false;
                            item.override_share = shares;
                            item.effective_shares = shares;

                            // If the response includes updated data, use it
                            if (result.data && result.data.override_share !== undefined) {
                                item.override_share = result.data.override_share;
                                item.effective_shares = result.data.override_share;
                                debugLog('Updated override_share value from server:', item.override_share);
                            }

                            // Update the total value display
                            this.updateMetrics();
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating shares: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating shares: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating shares:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update shares', 'is-danger');
                        }
                    }
                },

                async saveTotalValueChange(item, newTotalValue) {
                    if (!item || !item.id) {
                        console.error('Invalid item for total value change');
                        return;
                    }

                    try {
                        // Parse currency input using German locale parser
                        const totalValue = parseGermanNumber(newTotalValue);

                        if (isNaN(totalValue) || totalValue < 0) {
                            if (typeof showNotification === 'function') {
                                showNotification('Total value must be a valid positive number', 'is-warning');
                            }
                            return;
                        }

                        // Calculate custom price: total_value / shares
                        const customPrice = item.effective_shares > 0
                            ? totalValue / item.effective_shares
                            : 0;

                        debugLog('Saving custom total value:', {
                            company_id: item.id,
                            total_value: totalValue,
                            shares: item.effective_shares,
                            calculated_custom_price: customPrice
                        });

                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                custom_total_value: totalValue,
                                custom_price_eur: customPrice,
                                is_custom_value_edit: true
                            })
                        });

                        const result = await response.json();

                        if (result.success) {
                            // Update local item
                            item.custom_total_value = totalValue;
                            item.custom_price_eur = customPrice;
                            item.is_custom_value = true;

                            if (typeof showNotification === 'function') {
                                showNotification('Total value updated successfully', 'is-success', 3000);
                            }

                            // Update metrics
                            this.updateMetrics();
                        } else {
                            if (typeof showNotification === 'function') {
                                showNotification(`Error: ${result.error}`, 'is-danger');
                            }
                        }
                    } catch (error) {
                        console.error('Error updating total value:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update total value', 'is-danger');
                        }
                    }
                },



                formatCurrency(value) {
                    if (!value) return '<span class="sensitive-value">€0.00</span>';
                    const formatted = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
                    return `<span class="sensitive-value">${formatted}</span>`;
                },

                // Format currency without HTML wrapper (for input values)
                formatCurrencyRaw(value) {
                    if (!value) return '€0,00';
                    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
                },

                formatNumber(value) {
                    if (!value) return '0';
                    return new Intl.NumberFormat('de-DE').format(value);
                },

                formatDateAgo(date) {
                    if (!date) return 'Never';
                    const d = new Date(date);
                    const now = new Date();
                    const diff = Math.floor((now - d) / 1000); // seconds

                    if (diff < 60) return 'Just now';
                    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
                    return d.toLocaleDateString();
                },

                // Get health color class based on percentage
                getHealthColorClass(percentage) {
                    if (percentage >= 100) return 'health-green';
                    if (percentage >= 70) return 'health-orange';
                    return 'health-red';
                },

                // Get tooltip title for shares based on edit status
                getSharesTitle(item) {
                    let tooltip = '';

                    // Always show original shares value
                    if (item.shares !== undefined && item.shares !== null) {
                        tooltip += `Original shares: ${this.formatNumber(item.shares)}`;
                    }

                    // Add edit status information
                    if (item.is_manually_edited && item.csv_modified_after_edit) {
                        tooltip += `\nUser edited, then modified by CSV import. Last edit: ${this.formatDateAgo(item.manual_edit_date)}`;
                    } else if (item.is_manually_edited) {
                        tooltip += `\nManually edited by user on ${this.formatDateAgo(item.manual_edit_date)}`;
                    } else {
                        tooltip += '\nShares from CSV import';
                    }

                    return tooltip;
                },

                // Sort table by column
                sortBy(column) {
                    // If clicking the same column, toggle direction
                    if (this.sortColumn === column) {
                        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        // New column, default to ascending
                        this.sortColumn = column;
                        this.sortDirection = 'asc';
                    }

                    debugLog(`Sorting by ${column} in ${this.sortDirection} order`);
                },

                // Bulk edit methods
                toggleSelectAll() {
                    if (this.allFilteredSelected) {
                        // Unselect all filtered items
                        this.selectedItemIds = this.selectedItemIds.filter(id =>
                            !this.filteredPortfolioItems.some(item => item.id === id)
                        );
                    } else {
                        // Select all filtered items
                        const filteredIds = this.filteredPortfolioItems.map(item => item.id);
                        this.selectedItemIds = [...new Set([...this.selectedItemIds, ...filteredIds])];
                    }
                },

                clearSelection() {
                    this.selectedItemIds = [];
                    this.bulkPortfolio = '';
                    this.bulkSector = '';
                    this.bulkThesis = '';
                    this.bulkCountry = '';
                },

                async applyBulkChanges() {
                    if (this.selectedItemIds.length === 0) {
                        if (typeof showNotification === 'function') {
                            showNotification('No items selected', 'is-warning');
                        }
                        return;
                    }

                    if (!this.bulkPortfolio && !this.bulkSector && !this.bulkThesis && !this.bulkCountry) {
                        if (typeof showNotification === 'function') {
                            showNotification('Please select a value to apply', 'is-warning');
                        }
                        return;
                    }

                    this.isBulkProcessing = true;

                    try {
                        // Get the selected items data
                        const selectedItems = this.portfolioItems.filter(item =>
                            this.selectedItemIds.includes(item.id)
                        );

                        // Prepare the bulk update data
                        const updateData = selectedItems.map(item => ({
                            id: item.id,
                            company: item.company,
                            portfolio: this.bulkPortfolio || item.portfolio,
                            sector: this.bulkSector !== '' ? this.bulkSector : item.sector,
                            thesis: this.bulkThesis !== '' ? this.bulkThesis : item.thesis,
                            country: this.bulkCountry !== '' ? this.bulkCountry : item.effective_country,
                            is_country_user_edit: this.bulkCountry !== '',
                            identifier: item.identifier
                        }));

                        debugLog('Sending bulk update:', updateData);

                        // Send the bulk update request
                        const response = await fetch('/portfolio/api/bulk_update', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(updateData)
                        });

                        const result = await response.json();

                        if (response.ok && result.success) {
                            // Success notification
                            const changesText = [];
                            if (this.bulkPortfolio) changesText.push(`portfolio to "${this.bulkPortfolio}"`);
                            if (this.bulkSector !== '') changesText.push(`sector to "${this.bulkSector}"`);
                            if (this.bulkThesis !== '') changesText.push(`thesis to "${this.bulkThesis}"`);
                            if (this.bulkCountry !== '') changesText.push(`country to "${this.bulkCountry}"`);

                            if (typeof showNotification === 'function') {
                                showNotification(
                                    `Successfully updated ${this.selectedItemIds.length} items: ${changesText.join(' and ')}`,
                                    'is-success'
                                );
                            }

                            // Reload data to show changes
                            await this.loadData();

                            // Clear selection and form
                            this.clearSelection();
                        } else {
                            throw new Error(result.error || 'Failed to update items');
                        }
                    } catch (error) {
                        console.error('Error applying bulk changes:', error);
                        if (typeof showNotification === 'function') {
                            showNotification(`Error: ${error.message}`, 'is-danger');
                        }
                    } finally {
                        this.isBulkProcessing = false;
                    }
                },

                // Countries are now server-rendered like portfolios - no need for API calls or styling

                async saveCountryChange(item) {
                    if (!item || !item.id) {
                        console.error('Invalid item for country change');
                        return;
                    }

                    try {
                        debugLog('Sending country update request for item ID:', item.id, 'Country:', item.effective_country);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                country: item.effective_country,
                                is_country_user_edit: true
                            })
                        });

                        const result = await response.json();
                        debugLog('Country update response:', result);

                        if (result.success) {
                            item.country_manually_edited = true;
                            item.country_manual_edit_date = new Date().toISOString();
                            if (typeof showNotification === 'function') {
                                showNotification('Country updated successfully', 'is-success');
                            }
                        } else {
                            throw new Error(result.error || 'Country update failed');
                        }
                    } catch (error) {
                        console.error('Country update error:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update country: ' + error.message, 'is-danger');
                        }
                    }
                },

                async resetCountry(item) {
                    if (!item || !item.id) {
                        console.error('Invalid item for country reset');
                        return;
                    }

                    try {
                        debugLog('Resetting country for item ID:', item.id);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                reset_country: true
                            })
                        });

                        const result = await response.json();
                        debugLog('Country reset response:', result);

                        if (result.success && result.data) {
                            // Update the item with the response data from server
                            item.effective_country = result.data.effective_country;
                            item.country_manually_edited = false;
                            item.country_manual_edit_date = null;
                            if (typeof showNotification === 'function') {
                                showNotification(`Country reset to "${item.effective_country}" from yfinance`, 'is-success');
                            }
                        } else {
                            throw new Error(result.error || 'Country reset failed');
                        }
                    } catch (error) {
                        console.error('Country reset error:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to reset country: ' + error.message, 'is-danger');
                        }
                    }
                }
            },
            created() {
                // Wrap save methods to auto-clear saving state when done
                // This ensures "Saving..." indicator disappears after API call completes

                // Helper to clear saving state
                const clearSaving = (itemId, field) => {
                    if (this.savingStates[itemId]) {
                        this.$set(this.savingStates[itemId], field, false);
                    }
                };

                // Wrap original save methods to clear saving state when done
                const wrapSaveMethod = (methodName, fieldName) => {
                    const original = this[methodName];
                    this[methodName] = async function(...args) {
                        try {
                            return await original.apply(this, args);
                        } finally {
                            const item = args[0];
                            if (item && item.id) {
                                clearSaving(item.id, fieldName);
                            }
                        }
                    };
                };

                // Wrap all save methods to auto-clear saving state
                wrapSaveMethod('saveSectorChange', 'sector');
                wrapSaveMethod('saveThesisChange', 'thesis');
                wrapSaveMethod('saveIdentifierChange', 'identifier');
                wrapSaveMethod('saveSharesChange', 'shares');
                wrapSaveMethod('saveTotalValueChange', 'totalValue');
            },
            mounted() {
                // Link DOM elements to Vue model for two-way binding (moved from duplicate mounted)
                this.syncUIWithVueModel();
                
                debugLog('Vue component mounted. Methods available:', Object.keys(this.$options.methods).join(', '));
                debugLog('Initial portfolio options:', this.portfolioOptions);

                // First, normalize the initial portfolioOptions if they exist
                debugLog('Initial portfolio options type:', typeof this.portfolioOptions, Array.isArray(this.portfolioOptions));

                // Convert array of objects to array of strings if needed
                if (Array.isArray(this.portfolioOptions)) {
                    if (this.portfolioOptions.length > 0 && typeof this.portfolioOptions[0] === 'object' && this.portfolioOptions[0].name) {
                        debugLog('Converting portfolio options from objects to strings');
                        this.portfolioOptions = this.portfolioOptions.map(p => p.name);
                    }
                    debugLog('Normalized initial portfolio options:', this.portfolioOptions);
                }

                // Always fetch fresh portfolio data from the server
                debugLog('Fetching up-to-date portfolio options from server...');
                fetch('/portfolio/api/portfolios', {
                    cache: 'no-store'
                })
                    .then(response => {
                        debugLog('Portfolio API response status:', response.status);
                        if (!response.ok) {
                            throw new Error(`HTTP error ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                        debugLog('Portfolio options from server (RAW):', data);
                        debugLog('Portfolio options type:', typeof data, Array.isArray(data));

                        if (Array.isArray(data)) {
                            this.portfolioOptions = data.filter(p => p && p !== '-');
                            debugLog('Processed portfolio options:', this.portfolioOptions.length, 'items');
                        } else {
                            console.warn('Invalid portfolio options format from server');
                            this.portfolioOptions = [];
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching portfolio options:', error);
                        // Fall back to options passed from template if API fails
                        if (Array.isArray(this.portfolioOptions)) {
                            debugLog('Falling back to template-provided portfolio options');
                            this.portfolioOptions = this.portfolioOptions.filter(p => p && p !== '-');
                        } else {
                            this.portfolioOptions = [];
                        }
                    })
                    .finally(() => {
                        // Load all data after portfolio options are handled
                        this.loadData();

                        // Re-run syncUIWithVueModel after data is loaded
                        setTimeout(() => {
                            this.syncUIWithVueModel();
                        }, 1000);
                    });

                // Countries are now server-rendered like portfolios - no need to load them
                debugLog('Country options are now server-rendered like portfolios');

                // Add event listeners for the delete confirmation modal and update price modal
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && (this.showDeleteModal || this.showUpdatePriceModal)) {
                        this.closeModal();
                    }
                });

                // Ensure the X button and background clicks close the modals properly
                this.$nextTick(() => {
                    // For Delete Modal - use a simpler, more reliable selector
                    const deleteModal = document.querySelector('.modal.is-active');
                    if (deleteModal) {
                        const deleteModalCloseBtn = deleteModal.querySelector('.delete');
                        if (deleteModalCloseBtn) {
                            deleteModalCloseBtn.addEventListener('click', this.closeModal.bind(this));
                        }
                    }

                    // For Update Price Modal - use a simpler, more reliable selector  
                    const updatePriceModal = document.querySelector('.modal.is-active');
                    if (updatePriceModal) {
                        const updatePriceModalCloseBtn = updatePriceModal.querySelector('.delete');
                        if (updatePriceModalCloseBtn) {
                            updatePriceModalCloseBtn.addEventListener('click', this.closeModal.bind(this));
                        }
                    }
                });
            }
        });

        return this.app;
    }
}

// Portfolio Modal Management functionality
const ModalPortfolioManager = {
    updatePortfolioFields(action) {
        // Hide all fields first
        document.getElementById('modal-add-portfolio-fields').classList.add('is-hidden');
        document.getElementById('modal-rename-portfolio-fields').classList.add('is-hidden');
        document.getElementById('modal-delete-portfolio-fields').classList.add('is-hidden');

        // Enable/disable action button
        const actionButton = document.getElementById('modal-portfolio-action-btn');
        actionButton.disabled = !action;

        // Show relevant fields based on action
        if (action === 'add') {
            document.getElementById('modal-add-portfolio-fields').classList.remove('is-hidden');
        } else if (action === 'rename') {
            document.getElementById('modal-rename-portfolio-fields').classList.remove('is-hidden');
        } else if (action === 'delete') {
            document.getElementById('modal-delete-portfolio-fields').classList.remove('is-hidden');
        }
    },

    init() {
        const modalActionSelect = document.getElementById('modal-portfolio-action');
        const modalPortfolioForm = document.getElementById('modal-manage-portfolios-form');

        if (modalActionSelect) {
            modalActionSelect.addEventListener('change', function () {
                ModalPortfolioManager.updatePortfolioFields(this.value);
            });
        }

        if (modalPortfolioForm) {
            modalPortfolioForm.addEventListener('submit', function (e) {
                const action = document.getElementById('modal-portfolio-action').value;

                if (action === 'add') {
                    const addNameField = document.querySelector('#modal-add-portfolio-fields input[name="add_portfolio_name"]');
                    if (!addNameField.value.trim()) {
                        e.preventDefault();
                        alert('Portfolio name cannot be empty');
                    }
                } else if (action === 'rename') {
                    const oldName = document.querySelector('#modal-rename-portfolio-fields select[name="old_name"]').value;
                    const newName = document.querySelector('#modal-rename-portfolio-fields input[name="new_name"]').value.trim();
                    if (!oldName || !newName) {
                        e.preventDefault();
                        alert('Both old and new portfolio names are required');
                    }
                } else if (action === 'delete') {
                    const deleteNameField = document.querySelector('#modal-delete-portfolio-fields select[name="delete_portfolio_name"]');
                    if (!deleteNameField.value) {
                        e.preventDefault();
                        alert('Please select a portfolio to delete');
                    }
                }
            });
        }
    }
};

// Main initialization function
document.addEventListener('DOMContentLoaded', function () {
    // Check if required libraries are loaded
    const requiredLibraries = {
        'Vue': typeof Vue,
        'Axios': typeof axios,
        'Lodash': typeof _
    };
    
    const missingLibraries = Object.entries(requiredLibraries)
        .filter(([name, type]) => type === 'undefined')
        .map(([name]) => name);
    
    if (missingLibraries.length > 0) {
        console.error('Missing required libraries:', missingLibraries);
        console.error('Cannot initialize Vue components. Please check CDN connections.');
        return;
    }
    
    debugLog('All required libraries loaded successfully:', Object.keys(requiredLibraries));

    // Initialize the centralized progress manager first
    if (!ProgressManager.init()) {
        console.warn('ProgressManager initialization failed - some features may not work');
    }

    // Initialize components that are outside of the Vue controlled area first
    FileUploadHandler.init();
    PortfolioManager.init();
    LayoutManager.init();
    ModalPortfolioManager.init();

    // Get portfolios data from the template
    const portfoliosElement = document.getElementById('portfolios-data');
    let portfolios = [];
    let defaultPortfolio = "";

    if (portfoliosElement) {
        try {
            portfolios = JSON.parse(portfoliosElement.textContent);
            debugLog('Parsed portfolios from DOM:', portfolios);
        } catch (error) {
            console.error('Error parsing portfolios data:', error);
        }
    } else {
        console.warn('No portfolios-data element found in DOM');
    }

    // Check for default portfolio setting
    const defaultPortfolioElement = document.getElementById('default-portfolio');
    if (defaultPortfolioElement) {
        defaultPortfolio = defaultPortfolioElement.textContent === 'true' ? '-' : '';
    }

    // Initialize Vue apps (if their mount points exist)
    if (document.getElementById('portfolio-table-app')) {
        try {
            // Create global portfolioTableApp instance to ensure it's accessible outside this scope
            window.portfolioTableApp = new PortfolioTableApp(portfolios, defaultPortfolio);

            // Log that the app has been initialized
            debugLog('PortfolioTableApp initialized globally as window.portfolioTableApp');
        } catch (error) {
            console.error('Failed to initialize PortfolioTableApp:', error);
        }
    }

    // The update-all button action is now handled via a Vue method
});
