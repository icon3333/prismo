/**
 * Portfolio Manager - Core Utilities
 * This file provides shared functionality across all pages
 */

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI components
    initializeModals();
    initializeDropdowns();
    initializeNotifications();
    initializeTabs();
    
    // Setup AJAX error handling
    setupAjaxErrorHandling();
});

/**
 * Initialize modal functionality
 */
function initializeModals() {
    // Functions to open and close modals
    function openModal($el) {
        $el.classList.add('is-active');
        document.documentElement.classList.add('is-clipped');
    }

    function closeModal($el) {
        $el.classList.remove('is-active');
        document.documentElement.classList.remove('is-clipped');
    }

    function closeAllModals() {
        (document.querySelectorAll('.modal') || []).forEach(($modal) => {
            closeModal($modal);
        });
    }

    // Add click events to modal triggers
    (document.querySelectorAll('.js-modal-trigger') || []).forEach(($trigger) => {
        const modal = $trigger.dataset.target;
        const $target = document.getElementById(modal);

        $trigger.addEventListener('click', () => {
            openModal($target);
        });
    });

    // Add click events to close buttons
    (document.querySelectorAll('.modal-background, .modal-close, .modal-card-head .delete, .modal-card-foot .button.modal-cancel') || []).forEach(($close) => {
        const $target = $close.closest('.modal');

        $close.addEventListener('click', () => {
            closeModal($target);
        });
    });

    // Close modals with Escape key
    document.addEventListener('keydown', (event) => {
        if(event.key === "Escape") {
            closeAllModals();
        }
    });

    // Export modal functions to window object for reuse
    window.modalFunctions = {
        openModal,
        closeModal,
        closeAllModals
    };
}

/**
 * Initialize dropdown functionality
 */
function initializeDropdowns() {
    // Get all dropdowns on the page
    const dropdowns = document.querySelectorAll('.dropdown:not(.is-hoverable)');

    if (dropdowns.length > 0) {
        // For each dropdown, add event listener to toggle button
        dropdowns.forEach(dropdown => {
            const trigger = dropdown.querySelector('.dropdown-trigger');
            const menu = dropdown.querySelector('.dropdown-menu');
            
            if (trigger && menu) {
                trigger.addEventListener('click', function(event) {
                    event.stopPropagation();
                    dropdown.classList.toggle('is-active');
                });
                
                // Close dropdown when clicking outside
                document.addEventListener('click', function() {
                    dropdown.classList.remove('is-active');
                });
                
                // Prevent menu clicks from closing dropdown
                menu.addEventListener('click', function(event) {
                    event.stopPropagation();
                });
            }
        });
    }
}

/**
 * Initialize notification handling
 */
function initializeNotifications() {
    // Get all notifications with a delete button
    const notifications = document.querySelectorAll('.notification:not(.is-permanent) .delete');
    
    // Add click event to each delete button
    notifications.forEach(deleteButton => {
        const notification = deleteButton.parentNode;
        
        // Convert to overlay notification if not already
        if (!notification.classList.contains('notification-overlay')) {
            notification.classList.add('notification-overlay');
            // Move to body for proper positioning
            document.body.appendChild(notification);
        }
        
        // Add event listener for deletion
        deleteButton.addEventListener('click', () => {
            notification.remove();
        });
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (notification && notification.parentNode) {
                notification.classList.add('is-fading-out');
                setTimeout(() => {
                    if (notification && notification.parentNode) {
                        notification.remove();
                    }
                }, 500);
            }
        }, 5000);
    });
}

/**
 * Initialize tabs functionality
 */
function initializeTabs() {
    // Handle tab groups with class 'tabs'
    const tabGroups = document.querySelectorAll('.tabs');
    
    tabGroups.forEach(tabGroup => {
        const tabs = tabGroup.querySelectorAll('li');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabs.forEach(tab => {
            const link = tab.querySelector('a');
            if (!link) return;
            
            const target = link.dataset.target;
            
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Deactivate all tabs
                tabs.forEach(t => t.classList.remove('is-active'));
                
                // Hide all tab contents
                tabContents.forEach(content => content.classList.add('is-hidden'));
                
                // Activate clicked tab
                tab.classList.add('is-active');
                
                // Show corresponding content
                if (target) {
                    const targetContent = document.getElementById(target);
                    if (targetContent) {
                        targetContent.classList.remove('is-hidden');
                    }
                }
            });
        });
    });

    // Handle tab navigation with class 'nav-tabs' (custom implementation)
    const navTabs = document.querySelectorAll('.nav-tabs');
    
    navTabs.forEach(navTab => {
        const tabButtons = navTab.querySelectorAll('.nav-link');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', function() {
                // Get the target tab content element
                const targetId = this.getAttribute('id').replace('-tab', '');
                const targetElement = document.getElementById(targetId);
                
                // Deactivate all tabs and hide content
                navTab.querySelectorAll('.nav-link').forEach(tab => {
                    tab.classList.remove('active');
                });
                document.querySelectorAll('.tab-pane').forEach(content => {
                    content.classList.remove('active');
                    content.style.display = 'none';
                });
                
                // Activate selected tab and show content
                this.classList.add('active');
                if (targetElement) {
                    targetElement.classList.add('active');
                    targetElement.style.display = 'block';
                    
                    // Apply smooth transition effect
                    targetElement.style.transition = 'opacity 0.3s ease-in-out';
                    targetElement.style.opacity = '0';
                    
                    setTimeout(() => {
                        targetElement.style.opacity = '1';
                    }, 50);
                }
            });
        });
    });
}

/**
 * Setup AJAX error handling
 */
function setupAjaxErrorHandling() {
    // Add global error handling for Axios if available
    if (window.axios) {
        axios.interceptors.response.use(
            response => response,
            error => {
                console.error('AJAX Error:', error);
                
                let errorMessage = 'An unexpected error occurred';
                
                if (error.response) {
                    // The server responded with an error status
                    if (error.response.data && error.response.data.error) {
                        errorMessage = error.response.data.error;
                    } else {
                        errorMessage = `Server error: ${error.response.status}`;
                    }
                } else if (error.request) {
                    // The request was made but no response was received
                    errorMessage = 'No response from server. Please check your connection.';
                }
                
                // Create and show error notification
                showNotification(errorMessage, 'is-danger');
                
                return Promise.reject(error);
            }
        );
    }
}

/**
 * Show notification
 * @param {string} message - Message to display
 * @param {string} type - Notification type (is-info, is-success, is-warning, is-danger)
 * @param {number} duration - Duration in milliseconds (0 for permanent)
 */
function showNotification(message, type = 'is-info', duration = 5000) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type} notification-overlay`;
    
    // Add delete button
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete';
    notification.appendChild(deleteButton);
    
    // Add message text
    const messageText = document.createTextNode(message);
    notification.appendChild(messageText);
    
    // Add notification to body for overlay positioning
    document.body.appendChild(notification);
    
    // Setup delete button
    deleteButton.addEventListener('click', () => {
        notification.remove();
    });
    
    // Auto-dismiss if duration > 0
    if (duration > 0) {
        setTimeout(() => {
            notification.classList.add('is-fading-out');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 500);
        }, duration);
    }
}

/**
 * Format currency with symbol
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency symbol
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, currency = '€') {
    if (typeof amount !== 'number') {
        return `<span class="sensitive-value">${currency}0</span>`;
    }

    const formatted = amount >= 100
        ? `${currency}${amount.toLocaleString('en-US', {maximumFractionDigits: 0})}`
        : `${currency}${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    return `<span class="sensitive-value">${formatted}</span>`;
}

/**
 * Format percentage
 * @param {number} value - Value to format as percentage
 * @param {number} decimals - Number of decimal places
 * @param {boolean} includeSymbol - Whether to include % symbol
 * @returns {string} Formatted percentage
 */
function formatPercentage(value, decimals = 1, includeSymbol = true) {
    if (typeof value !== 'number') {
        return includeSymbol ? '0%' : '0';
    }
    
    const formatted = value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
    
    return includeSymbol ? `${formatted}%` : formatted;
}

/**
 * Format number with thousand separators
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted number
 */
function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined) return '0';
    return parseFloat(value).toLocaleString('en-US', {
        maximumFractionDigits: decimals, 
        minimumFractionDigits: decimals
    });
}

/**
 * Parse number from string, removing commas
 * @param {string} string - String to parse
 * @returns {number} Parsed number
 */
function parseNumber(string) {
    return parseFloat(string.replace(/,/g, '')) || 0;
}

/**
 * Create loading overlay
 * @returns {Object} Loading overlay control object
 */
function createLoadingOverlay() {
    // Create elements
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    overlay.appendChild(spinner);
    
    // Return control object
    return {
        show: function() {
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';
        },
        hide: function() {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
                document.body.style.overflow = '';
            }
        }
    };
}

/**
 * Debounce function to limit function call frequency
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 300) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Format date as time ago
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDateAgo(date) {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000); // seconds

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
}

// Cache for portfolio data
let portfolioDataCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Portfolio manager utility
const portfolioManager = {
    // Formatting functions
    formatCurrency,
    formatPercentage,
    formatNumber,
    parseNumber,
    formatDateAgo,
    
    // UI utilities
    showNotification,
    createLoadingOverlay,
    debounce,

    /**
     * Load portfolio data, using cache when possible
     * @returns {Object} Portfolio data and cache status
     */
    async loadData() {
        try {
            // Check cache first
            const now = Date.now();
            if (portfolioDataCache && (now - lastCacheTime) < CACHE_DURATION) {
                return {
                    data: portfolioDataCache,
                    fromCache: true
                };
            }
            
            // Load fresh data
            const response = await fetch('/portfolio/api/portfolio_data');
            if (!response.ok) throw new Error('Failed to load portfolio data');
            
            const data = await response.json();
            
            // Update cache
            portfolioDataCache = data;
            lastCacheTime = now;
            
            return {
                data,
                fromCache: false
            };
        } catch (err) {
            console.error('Failed to load data:', err);
            throw err;
        }
    },

    /**
     * Refresh data in the background without UI blocking
     * @returns {Object|null} Updated data or null on error
     */
    async refreshDataInBackground() {
        try {
            const response = await fetch('/portfolio/api/portfolio_data');
            if (!response.ok) return null;
            
            const data = await response.json();
            
            // Update cache
            portfolioDataCache = data;
            lastCacheTime = Date.now();
            
            return data;
        } catch (err) {
            console.error('Background refresh failed:', err);
            return null;
        }
    },

    /**
     * Update price for a specific company
     * @param {string} companyId - ID of the company to update
     * @returns {Object} Response data
     */
    async updatePrice(companyId) {
        try {
            const response = await fetch(`/portfolio/api/update_price/${companyId}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to update price');
            }
            
            // Refresh the portfolio data
            await this.refreshDataInBackground();
            
            this.showNotification('Price updated successfully', 'is-success');
            return data;
            
        } catch (error) {
            console.error('Error updating price:', error);
            this.showNotification(error.message, 'is-danger');
            throw error;
        }
    }
};

// Export to window for global access
window.portfolioManager = portfolioManager;
window.showNotification = showNotification;
window.formatCurrency = formatCurrency;
window.formatPercentage = formatPercentage;
window.formatNumber = formatNumber;
window.parseNumber = parseNumber;
window.debounce = debounce;