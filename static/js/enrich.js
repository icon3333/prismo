/**
 * Portfolio Enrichment Page JavaScript
 * Handles file uploads, portfolio management, and data visualization
 */

// Centralized Progress Manager - handles all progress tracking
const ProgressManager = {
    elements: {
        progressElement: null,
        progressPercentage: null,
        progressBar: null,
        uploadPercentage: null // Added for CSV upload percentage
    },

    currentJob: {
        type: null, // 'csv_upload', 'price_fetch'
        interval: null,
        startTime: null
    },

    init() {
        // Initialize elements based on job type
        this.elements.priceProgressElement = document.getElementById('price-fetch-progress');
        this.elements.priceProgressPercentage = document.getElementById('progress-percentage');
        this.elements.priceProgressBar = document.getElementById('progress-bar');

        this.elements.csvUploadIndicator = document.getElementById('csv-upload-indicator');
        this.elements.uploadPercentage = document.getElementById('upload-percentage'); // Get the percentage element

        if (!this.elements.priceProgressElement && !this.elements.csvUploadIndicator) {
            console.warn('No progress or indicator elements found - some features may be disabled');
            return false;
        }

        this.hide();
        return true;
    },

    show(jobType = 'price_fetch') {
        this.currentJob.type = jobType;
        this.currentJob.startTime = Date.now();

        console.log(`ProgressManager: Showing progress for ${jobType}`);

        if (jobType === 'csv_upload' && this.elements.csvUploadIndicator) {
            console.log('ProgressManager: Displaying CSV upload indicator');
            this.elements.csvUploadIndicator.style.display = 'block';
        } else if (jobType === 'price_fetch' && this.elements.priceProgressElement) {
            console.log('ProgressManager: Displaying price fetch progress element');
            this.elements.priceProgressElement.style.display = 'block';
            this.elements.priceProgressElement.dataset.processing = 'true';
        }

        this.setProgress(0, 'Initializing...');
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

    setProgress(percentage, message = null) {
        const jobType = this.currentJob.type;

        console.log(`ProgressManager: Setting progress ${percentage}% for ${jobType}${message ? ` - ${message}` : ''}`);

        if (jobType === 'csv_upload') {
            // Updated to handle percentage display
            if (this.elements.uploadPercentage) {
                this.elements.uploadPercentage.textContent = `${Math.round(percentage)}%`;
            }
            return;
        } else if (jobType === 'price_fetch') {
            if (this.elements.priceProgressPercentage) {
                this.elements.priceProgressPercentage.textContent = `${Math.round(percentage)}%`;
            }
            if (this.elements.priceProgressBar) {
                this.elements.priceProgressBar.value = percentage;
            }
        }
    },

    startTracking(jobType = 'price_fetch', checkInterval = 500) {
        this.stopTracking(); // Clear any existing interval
        this.show(jobType);

        if (jobType === 'csv_upload') {
            // Start polling for CSV upload progress
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

    startCsvUploadProgress(checkInterval = 500) {
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
            console.log("Price fetch progress:", data);

            const percentage = data.percentage || 0;
            this.setProgress(percentage);

            // Check completion
            if (data.status === 'completed' || data.status === 'idle' || percentage >= 100) {
                this.complete();
            }
        } catch (error) {
            console.error('Error checking price fetch progress:', error);
            this.setProgress(0);
        }
    },

    async checkCsvProgress() {
        try {
            const response = await fetch('/portfolio/api/csv_upload_progress');
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            console.log("CSV upload progress:", data);

            const percentage = data.percentage || 0;
            const message = data.message || 'Processing...';
            this.setProgress(percentage, message);

            // Check completion
            if (data.status === 'completed' || data.status === 'failed') {
                if (data.status === 'completed') {
                    this.setProgress(100, 'Upload completed successfully!');
                } else {
                    this.setProgress(0, 'Upload failed');
                }

                // Ensure minimum display time before hiding
                const timeRemaining = this.currentJob.minimumDisplayTime ?
                    Math.max(0, this.currentJob.minimumDisplayTime - Date.now()) : 1500;

                setTimeout(() => {
                    this.complete();
                    // Clear the progress from session after completion
                    fetch('/portfolio/api/csv_upload_progress', { method: 'DELETE' }).catch(() => { });

                    // Reload the page to show updated data
                    if (data.status === 'completed') {
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    }
                }, Math.max(timeRemaining, 1500));
            }
        } catch (error) {
            console.error('Error checking CSV upload progress:', error);
            this.setProgress(0, 'Error checking progress');
        }
    },

    complete(finalPercentage = 100) {
        this.setProgress(finalPercentage);

        // Show completion briefly before hiding
        setTimeout(() => {
            this.hide();
        }, 1000);
    },

    error(message = 'Operation failed') {
        console.error('Progress error:', message);
        this.elements.progressPercentage.textContent = 'Error';
        setTimeout(() => {
            this.hide();
        }, 2000);
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

            // Start progress tracking for price fetch
            ProgressManager.startTracking('price_fetch');

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
                    console.log('Success:', result.message || 'Started updating all prices and metadata');
                }

                // If there's a job ID, start polling for status updates
                if (result.job_id) {
                    const jobId = result.job_id;
                    console.log('Job ID:', jobId);

                    // Poll for job status
                    const statusInterval = setInterval(async () => {
                        try {
                            // Try fetching the job status first
                            const statusResponse = await fetch(`/portfolio/api/price_update_status/${jobId}`);

                            if (statusResponse.ok) {
                                const statusResult = await statusResponse.json();
                                console.log('Job status:', statusResult);

                                // Update progress display if available
                                if (statusResult.progress) {
                                    ProgressManager.setProgress(statusResult.progress.percentage);
                                }

                                // If job is completed, stop polling and reload data
                                if (statusResult.status === 'completed' || statusResult.is_complete) {
                                    clearInterval(statusInterval);
                                    ProgressManager.complete();

                                    // Show completion notification
                                    if (typeof showNotification === 'function') {
                                        showNotification(`Price update complete! Updated all companies successfully.`, 'is-success');
                                    }

                                    // Reload the data
                                    if (window.portfolioTableApp && typeof window.portfolioTableApp.loadData === 'function') {
                                        await window.portfolioTableApp.loadData();
                                        console.log('Portfolio data reloaded after price update completion');
                                    } else {
                                        console.warn('portfolioTableApp.loadData is not available, reloading page instead');
                                        window.location.reload();
                                    }
                                }
                            } else {
                                // Fall back to checking the progress endpoint if the status endpoint fails
                                console.log("Falling back to progress endpoint check");
                                // ProgressManager will handle this automatically
                            }
                        } catch (error) {
                            console.error('Error checking job status:', error);
                            clearInterval(statusInterval);
                            ProgressManager.error();
                        }
                    }, 1000);
                }
            } else {
                ProgressManager.error();
                throw new Error(result.message || 'Failed to start price update');
            }
        } catch (error) {
            console.error('Error updating all prices:', error);
            ProgressManager.error();
            if (typeof showNotification === 'function') {
                showNotification('An error occurred while updating prices', 'is-danger');
            }
        } finally {
            // Re-enable the button
            updateAllDataBtn.disabled = false;
            updateAllDataBtn.classList.remove('is-loading');
        }
    }
};

const FileUploadHandler = {
    init() {
        const fileInput = document.querySelector('.file-input');
        const fileLabel = document.querySelector('.file-name');
        const uploadForm = document.querySelector('form[action*="upload"]');
        const uploadCard = document.getElementById('upload-card');

        console.log('FileUploadHandler: Debugging elements found:');
        console.log('  fileInput:', fileInput);
        console.log('  fileLabel:', fileLabel);
        console.log('  uploadForm:', uploadForm);
        console.log('  uploadCard:', uploadCard);

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

        console.log('FileUploadHandler: Initializing CSV upload handler');
        console.log('Upload form action:', uploadForm.action);
        console.log('Upload form method:', uploadForm.method);

        // File selection handler
        fileInput.addEventListener('change', function () {
            console.log('File input change event triggered');
            console.log('Files length:', fileInput.files.length);

            if (fileInput.files.length > 0) {
                const fileName = fileInput.files[0].name;
                const fileSize = fileInput.files[0].size;
                fileLabel.textContent = fileName;
                console.log(`File selected: ${fileName}, size: ${fileSize} bytes`);

                // Show loading indicator and start tracking
                console.log('Starting progress tracking for csv_upload');
                ProgressManager.startTracking('csv_upload');

                // Add a class to the card to indicate processing
                uploadCard.classList.add('is-processing');
                console.log('Added is-processing class to upload card');

                // Submit file via AJAX instead of form submission
                FileUploadHandler.submitFileAjax(fileInput.files[0], uploadForm.action);
            } else {
                fileLabel.textContent = 'No file selected';
                console.log('No file selected');
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
    },

    async submitFileAjax(file, actionUrl) {
        try {
            console.log('Submitting CSV file via AJAX...');

            const formData = new FormData();
            formData.append('csv_file', file);

            const response = await fetch(actionUrl, {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            });

            const result = await response.json();

            if (result.success) {
                console.log('CSV upload successful:', result.message);
                // Success messages will be shown via flash messages after page reload
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                console.error('CSV upload failed:', result.message);
                ProgressManager.complete();
                this.showErrorMessage(result.message);
            }
        } catch (error) {
            console.error('Error during AJAX CSV upload:', error);
            ProgressManager.complete();
            this.showErrorMessage('Error uploading file. Please try again.');
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
                    bulkCategory: '',
                    isBulkProcessing: false
                };
            },
            mounted() {
                // Link DOM elements to Vue model for two-way binding
                this.syncUIWithVueModel();
            },
            computed: {
                healthColorClass() {
                    if (!this.portfolioItems.length) return 'is-info';
                    const health = this.metrics.health;
                    if (health >= 90) return 'is-success';
                    if (health >= 70) return 'is-warning';
                    return 'is-danger';
                },
                filteredPortfolioItems() {
                    console.log(`Computing filtered items with portfolio=${this.selectedPortfolio}, companySearch=${this.companySearchQuery}`);

                    // First filter by selected portfolio
                    let filtered = this.selectedPortfolio
                        ? this.portfolioItems.filter(item => item.portfolio === this.selectedPortfolio)
                        : this.portfolioItems;

                    console.log(`After portfolio filter: ${filtered.length} items`);

                    // Filter by company name if search query is provided
                    if (this.companySearchQuery && this.companySearchQuery.trim() !== '') {
                        const query = this.companySearchQuery.toLowerCase().trim();
                        filtered = filtered.filter(item => {
                            return item.company && item.company.toLowerCase().includes(query);
                        });
                        console.log(`After company search filter: ${filtered.length} items`);
                    }

                    // Apply sorting if a sort column is specified
                    if (this.sortColumn) {
                        const direction = this.sortDirection === 'asc' ? 1 : -1;

                        filtered = [...filtered].sort((a, b) => {
                            // Handle special cases for calculated fields
                            if (this.sortColumn === 'total_value') {
                                const aValue = (a.price_eur || 0) * (a.effective_shares || 0);
                                const bValue = (b.price_eur || 0) * (b.effective_shares || 0);
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
                categoryHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.category && item.category.trim() !== ''
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                },
                priceHealthPercentage() {
                    if (this.filteredPortfolioItems.length === 0) return 0;
                    const filledCount = this.filteredPortfolioItems.filter(item =>
                        item.price_eur && item.price_eur > 0
                    ).length;
                    return Math.round((filledCount / this.filteredPortfolioItems.length) * 100);
                }
            },
            watch: {
                selectedPortfolio() {
                    // Update metrics when portfolio selection changes
                    console.log('selectedPortfolio changed:', this.selectedPortfolio);
                    this.updateFilteredMetrics();
                },
                companySearchQuery() {
                    // Update metrics when search query changes
                    console.log('companySearchQuery changed:', this.companySearchQuery);
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
                            console.log('Found portfolio dropdown element');
                            // Initial value from Vue to DOM
                            portfolioDropdown.value = this.selectedPortfolio;

                            // DOM to Vue binding
                            portfolioDropdown.addEventListener('change', () => {
                                console.log('Portfolio dropdown changed to:', portfolioDropdown.value);
                                this.selectedPortfolio = portfolioDropdown.value;
                                // Force update filtered list
                                this.updateFilteredMetrics();
                            });

                            // Vue to DOM binding
                            this.$watch('selectedPortfolio', (newVal) => {
                                console.log('selectedPortfolio changed in Vue:', newVal);
                                portfolioDropdown.value = newVal;
                            });
                        } else {
                            console.warn('Portfolio dropdown element not found with ID: filter-portfolio');
                        }

                        // Setup two-way binding with company search input
                        const companySearchInput = document.getElementById('company-search');
                        const clearSearchButton = document.getElementById('clear-company-search');

                        if (companySearchInput) {
                            console.log('Found company search input element');
                            // Initial value from Vue to DOM
                            companySearchInput.value = this.companySearchQuery;

                            // DOM to Vue binding
                            companySearchInput.addEventListener('input', () => {
                                console.log('Company search input changed to:', companySearchInput.value);
                                this.companySearchQuery = companySearchInput.value;
                                // Force update filtered list
                                this.updateFilteredMetrics();
                            });

                            // Vue to DOM binding
                            this.$watch('companySearchQuery', (newVal) => {
                                console.log('companySearchQuery changed in Vue:', newVal);
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
                        'Category',
                        'Shares',
                        'Price (EUR)',
                        'Total Value',
                        'Total Invested',
                        'Last Updated'
                    ];

                    const csvRows = [headers.join(',')];

                    dataToExport.forEach(item => {
                        const row = [
                            this.escapeCSVField(item.identifier || ''),
                            this.escapeCSVField(item.company || ''),
                            this.escapeCSVField(item.portfolio || ''),
                            this.escapeCSVField(item.category || ''),
                            item.effective_shares || 0,
                            item.price_eur || 0,
                            (item.price_eur || 0) * (item.effective_shares || 0),
                            item.total_invested || 0,
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
                    try {
                        // Load portfolio items
                        const response = await fetch('/portfolio/api/portfolio_data', {
                            cache: 'no-store'
                        });
                        const data = await response.json();
                        this.portfolioItems = data;
                        console.log('Loaded portfolio items:', this.portfolioItems);

                        // Extract unique portfolios from the data that are actually in use
                        const usedPortfolios = [...new Set(this.portfolioItems.map(item => item.portfolio))].filter(Boolean);
                        console.log('Used portfolios:', usedPortfolios);

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
                                console.log('Updated portfolio options (filtered):', this.portfolioOptions);

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
                    } catch (error) {
                        console.error('Error loading portfolio data:', error);
                    } finally {
                        this.loading = false;
                    }
                },

                updateMetrics() {
                    const items = this.portfolioItems;
                    const missingPriceItems = items.filter(i => !i.price_eur || i.price_eur === 0 || i.price_eur === null);
                    this.metrics = {
                        total: items.length,
                        health: items.length ? Math.round(((items.length - missingPriceItems.length) / items.length) * 100) : 100,
                        totalValue: items.reduce((sum, item) => sum + ((item.price_eur || 0) * (item.effective_shares || 0)), 0),
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
                        totalValue: filteredItems.reduce((sum, item) => sum + ((item.price_eur || 0) * (item.effective_shares || 0)), 0),
                        lastUpdate: filteredItems.reduce((latest, item) => !latest || (item.last_updated && item.last_updated > latest) ? item.last_updated : latest, null)
                    };

                    // Force Vue to re-render the filtered list
                    this.$forceUpdate();
                    console.log(`Updated metrics: ${this.metrics.total} items`);
                    console.log(`Filtering conditions: portfolio=${this.selectedPortfolio}`);
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
                                console.log(result.message || 'Price updated successfully');
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



                async savePortfolioChange(item) {
                    console.log('savePortfolioChange called with item:', item);
                    if (!item || !item.id) {
                        console.error('Invalid item for portfolio change');
                        return;
                    }

                    try {
                        console.log('Sending portfolio update request for item ID:', item.id, 'Portfolio:', item.portfolio);
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
                        console.log('Portfolio update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Portfolio updated successfully', 'is-success', 3000);
                            } else {
                                console.log('Portfolio updated successfully');
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
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                identifier: item.identifier || ''
                            })
                        });

                        const result = await response.json();

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Identifier updated and price fetched automatically', 'is-success', 3000);
                            } else {
                                console.log('Identifier updated and price fetched automatically');
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

                async saveCategoryChange(item) {
                    console.log('saveCategoryChange called with item:', item);
                    if (!item || !item.id) {
                        console.error('Invalid item for category change');
                        return;
                    }

                    try {
                        console.log('Sending category update request for item ID:', item.id, 'Category:', item.category);
                        const response = await fetch(`/portfolio/api/update_portfolio/${item.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                category: item.category || ''
                            })
                        });

                        const result = await response.json();
                        console.log('Category update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Category updated successfully', 'is-success', 3000);
                            } else {
                                console.log('Category updated successfully');
                            }
                        } else {
                            // Show error notification
                            if (typeof showNotification === 'function') {
                                showNotification(`Error updating category: ${result.error}`, 'is-danger');
                            } else {
                                console.error(`Error updating category: ${result.error}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error updating category:', error);
                        if (typeof showNotification === 'function') {
                            showNotification('Failed to update category', 'is-danger');
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

                        console.log('Sending shares update request for item ID:', item.id, 'Override shares:', shares);
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
                        console.log('Shares update response:', result);

                        if (result.success) {
                            // Show success notification using the global function if available
                            if (typeof showNotification === 'function') {
                                showNotification('Shares updated successfully', 'is-success', 3000);
                            } else {
                                console.log('Shares updated successfully');
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
                                console.log('Updated override_share value from server:', item.override_share);
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



                formatCurrency(value) {
                    if (!value) return '€0.00';
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

                    console.log(`Sorting by ${column} in ${this.sortDirection} order`);
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
                    this.bulkCategory = '';
                },

                async applyBulkChanges() {
                    if (this.selectedItemIds.length === 0) {
                        if (typeof showNotification === 'function') {
                            showNotification('No items selected', 'is-warning');
                        }
                        return;
                    }

                    if (!this.bulkPortfolio && !this.bulkCategory) {
                        if (typeof showNotification === 'function') {
                            showNotification('Please select a portfolio or enter a category', 'is-warning');
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
                            category: this.bulkCategory !== '' ? this.bulkCategory : item.category,
                            identifier: item.identifier
                        }));

                        console.log('Sending bulk update:', updateData);

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
                            if (this.bulkCategory !== '') changesText.push(`category to "${this.bulkCategory}"`);

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
                }
            },
            mounted() {
                console.log('Vue component mounted. Methods available:', Object.keys(this.$options.methods).join(', '));
                console.log('Initial portfolio options:', this.portfolioOptions);

                // First, normalize the initial portfolioOptions if they exist
                console.log('Initial portfolio options type:', typeof this.portfolioOptions, Array.isArray(this.portfolioOptions));

                // Convert array of objects to array of strings if needed
                if (Array.isArray(this.portfolioOptions)) {
                    if (this.portfolioOptions.length > 0 && typeof this.portfolioOptions[0] === 'object' && this.portfolioOptions[0].name) {
                        console.log('Converting portfolio options from objects to strings');
                        this.portfolioOptions = this.portfolioOptions.map(p => p.name);
                    }
                    console.log('Normalized initial portfolio options:', this.portfolioOptions);
                }

                // Always fetch fresh portfolio data from the server
                console.log('Fetching up-to-date portfolio options from server...');
                fetch('/portfolio/api/portfolios', {
                    cache: 'no-store'
                })
                    .then(response => {
                        console.log('Portfolio API response status:', response.status);
                        if (!response.ok) {
                            throw new Error(`HTTP error ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                        console.log('Portfolio options from server (RAW):', data);
                        console.log('Portfolio options type:', typeof data, Array.isArray(data));

                        if (Array.isArray(data)) {
                            this.companies = data.map(item => ({
                                id: item.id,
                                company: item.company || '',
                                identifier: item.identifier || '',
                                portfolio: item.portfolio || 'Unassigned',
                                category: item.category || ''
                            }));
                            console.log('Processed company data:', this.companies.length, 'items');
                        } else {
                            console.warn('Invalid portfolio options format from server');
                            this.companies = [];
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching portfolio options:', error);
                        // Fall back to options passed from template if API fails
                        if (Array.isArray(this.portfolioOptions)) {
                            console.log('Falling back to template-provided portfolio options');
                            this.companies = this.companies.filter(p => p && p !== '-');
                        } else {
                            this.companies = [];
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
            console.log('Parsed portfolios from DOM:', portfolios);
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
        // Create global portfolioTableApp instance to ensure it's accessible outside this scope
        window.portfolioTableApp = new PortfolioTableApp(portfolios, defaultPortfolio);

        // Log that the app has been initialized
        console.log('PortfolioTableApp initialized globally as window.portfolioTableApp');
    }

    // The update-all button action is now handled via a Vue method
});
