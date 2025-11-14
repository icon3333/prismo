/**
 * Portfolio Allocation - Main JavaScript file
 * This file handles the portfolio allocation calculation based on user input.
 */

// Debounce function to limit how often a function can be called
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Format number with commas and decimals
function formatNumber(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Parse number from string, removing commas
function parseNumber(string) {
    return parseFloat(string.replace(/,/g, '')) || 0;
}

document.addEventListener('DOMContentLoaded', function () {
    // Get tab elements
    const globalTab = document.getElementById('global-tab');
    const detailedTab = document.getElementById('detailed-tab');
    const globalContent = document.getElementById('global');
    const detailedContent = document.getElementById('detailed');

    // Function to handle tab switching
    function switchTab(tabId) {
        // Remove active class from all tabs and content
        [globalTab, detailedTab].forEach(tab => tab.classList.remove('active'));
        [globalContent, detailedContent].forEach(content => {
            content.classList.remove('active');
            content.style.display = 'none';
        });

        // Add active class to selected tab and content
        if (tabId === 'global') {
            globalTab.classList.add('active');
            globalContent.classList.add('active');
            globalContent.style.display = 'block';
        } else {
            detailedTab.classList.add('active');
            detailedContent.classList.add('active');
            detailedContent.style.display = 'block';
        }

        // Add smooth transition effect
        const activeContent = tabId === 'global' ? globalContent : detailedContent;
        activeContent.style.transition = 'opacity 0.3s ease-in-out';
        activeContent.style.opacity = '0';

        setTimeout(() => {
            activeContent.style.opacity = '1';
        }, 50);
    }

    // Add click event listeners to tabs
    globalTab.addEventListener('click', () => switchTab('global'));
    detailedTab.addEventListener('click', () => switchTab('detailed'));

    // Add hover effect to tabs
    [globalTab, detailedTab].forEach(tab => {
        tab.addEventListener('mouseenter', () => {
            if (!tab.classList.contains('active')) {
                tab.style.backgroundColor = '#f8f9fa';
            }
        });

        tab.addEventListener('mouseleave', () => {
            if (!tab.classList.contains('active')) {
                tab.style.backgroundColor = '';
            }
        });
    });

    // Portfolio allocation functionality
    class PortfolioAllocator {
        constructor() {
            this.portfolioData = null;
            this.investmentAmount = 0;
            this.rebalanceMode = 'existing-only'; // 'existing-only', 'new-only', 'new-with-sells'
            this.categoriesExpanded = new Set(); // Track expanded categories
            this.selectedPortfolio = null; // Track selected portfolio
            this.init();
        }

        init() {
            this.hideExpandCollapseButtons(); // Hide buttons initially
            this.fetchPortfolioData();
            this.setupEventListeners();

            // Initialize tab view
            switchTab('global');
        }

        setupEventListeners() {
            // Add event listener for investment amount input
            const investmentInput = document.getElementById('investment-amount');
            if (investmentInput) {
                // Combined event listener for formatting and updating calculations
                investmentInput.addEventListener('input', (e) => {
                    // Clean and format the input value
                    const cleanValue = e.target.value.replace(/[^\d.]/g, '');
                    const number = parseFloat(cleanValue) || 0;

                    // Format the display value
                    e.target.value = formatNumber(number);

                    // Update the investment amount and trigger calculations immediately
                    this.investmentAmount = number;
                    this.updateTableCalculations();
                    this.renderDetailedView(); // Update detailed view when investment amount changes
                });
            }

            // Add event listeners for rebalance mode radio buttons
            const rebalanceModeRadios = document.querySelectorAll('input[name="rebalance-mode"]');
            rebalanceModeRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.rebalanceMode = e.target.value;
                    this.handleModeChange();
                    this.updateTableCalculations();
                    this.renderDetailedView();
                });
            });

            // Add portfolio selection change listener
            const portfolioSelect = document.getElementById('portfolio-select');
            if (portfolioSelect) {
                portfolioSelect.addEventListener('change', (e) => {
                    this.selectedPortfolio = e.target.value;
                    this.renderDetailedView();
                });
            }

            // Add expand/collapse all buttons event listeners
            const expandAllBtn = document.getElementById('expand-all-btn');
            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', () => {
                    this.expandAllCategories();
                });
            }

            const collapseAllBtn = document.getElementById('collapse-all-btn');
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', () => {
                    this.collapseAllCategories();
                });
            }
        }

        handleModeChange() {
            const investmentInputContainer = document.getElementById('investment-input-container');
            if (this.rebalanceMode === 'existing-only') {
                // Hide investment amount input for existing capital only mode
                investmentInputContainer.style.display = 'none';
                this.investmentAmount = 0; // No new investment
                // Also update the input field visually
                const investmentInput = document.getElementById('investment-amount');
                if (investmentInput) {
                    investmentInput.value = '';
                }
            } else {
                // Show investment amount input for modes that use new capital
                investmentInputContainer.style.display = 'block';
            }
        }

        async fetchPortfolioData() {
            try {
                const response = await fetch('/portfolio/api/allocate/portfolio-data');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                this.portfolioData = await response.json();
                if (!this.portfolioData || !this.portfolioData.portfolios) {
                    throw new Error('Invalid portfolio data received');
                }

                // Debug: Log basic portfolio info
                console.log(`Loaded ${this.portfolioData.portfolios.length} portfolios for allocation`);

                // Initialize UI state based on current mode
                this.handleModeChange();
                this.renderPortfolioTable();
                this.populatePortfolioSelect();
                this.renderDetailedView();
            } catch (error) {
                console.error('Error fetching portfolio data:', error);
                this.showError('Failed to load portfolio data. Please try again later.');
            }
        }

        populatePortfolioSelect() {
            const portfolioSelect = document.getElementById('portfolio-select');
            if (!portfolioSelect || !this.portfolioData || !this.portfolioData.portfolios) return;

            // Clear existing options
            portfolioSelect.innerHTML = '';

            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select a portfolio';
            portfolioSelect.appendChild(defaultOption);

            // Add portfolio options - show all portfolios with target allocations (even if empty)
            this.portfolioData.portfolios.forEach(portfolio => {
                // Filter out portfolios with target allocation AND valid names (not "Unknown")
                const isValidPortfolio = portfolio.targetWeight > 0 &&
                                        portfolio.name &&
                                        !portfolio.name.toLowerCase().includes('unknown');

                if (isValidPortfolio) {
                    const option = document.createElement('option');
                    option.value = portfolio.name;
                    // Add "(Empty)" suffix for empty portfolios
                    option.textContent = portfolio.currentValue > 0
                        ? portfolio.name
                        : `${portfolio.name} (Empty)`;
                    portfolioSelect.appendChild(option);
                }
            });

            // Set initial selection if none exists
            if (!this.selectedPortfolio && portfolioSelect.options.length > 1) {
                this.selectedPortfolio = portfolioSelect.options[1].value;
                portfolioSelect.value = this.selectedPortfolio;
            }
        }

        showError(message) {
            const container = document.getElementById('portfolio-table-container');
            if (container) {
                container.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle"></i> ${message}
                    </div>
                `;
            }
        }

        showNoPositionsMessage() {
            const container = document.getElementById('portfolio-table-container');
            if (container) {
                container.innerHTML = `
                    <div class="alert alert-info">
                        No stock or crypto positions found. Please add positions on the Enrich tab.
                    </div>
                `;
            }
            const detailed = document.getElementById('detailed-portfolio-container');
            if (detailed) {
                detailed.innerHTML = `
                    <div class="alert alert-info mt-4">
                        No stock or crypto positions found. Please add positions on the Enrich tab.
                    </div>
                `;
            }
            this.hideExpandCollapseButtons();
        }

        formatCurrency(value) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'EUR',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(value);
        }

        formatPercentage(value) {
            return new Intl.NumberFormat('en-US', {
                style: 'percent',
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            }).format(value / 100);
        }

        // Helper method to count current positions in a portfolio
        countCurrentPositions(portfolio) {
            if (!portfolio.categories) return 0;
            return portfolio.categories
                .filter(cat => cat.name !== 'Missing Positions')
                .reduce((sum, cat) => sum + (cat.positionCount || 0), 0);
        }

        renderPortfolioTable() {
            if (!this.portfolioData || !this.portfolioData.portfolios || this.portfolioData.portfolios.length === 0) {
                this.showNoPositionsMessage();
                return;
            }

            // Include ALL portfolios with target allocations from builder (even if empty)
            // Rationale: If user set target allocation in Build page, they want to see it here
            const filteredPortfolios = this.portfolioData.portfolios.filter(portfolio =>
                portfolio.targetWeight > 0  // Include any portfolio with target allocation (even if currentValue is 0)
            );

            if (filteredPortfolios.length === 0) {
                this.showError('No portfolios with target allocations found. Please configure allocations in the Build page first.');
                return;
            }

            // Calculate total current value across all portfolios
            const totalCurrentValue = filteredPortfolios.reduce(
                (sum, portfolio) => sum + (portfolio.currentValue || 0), 0
            );

            // Calculate new total value based on rebalancing mode
            let newTotalValue = totalCurrentValue;
            if (this.rebalanceMode !== 'existing-only') {
                newTotalValue += this.investmentAmount;
            }

            // Normalize target weights and calculate target values
            const totalTargetWeight = filteredPortfolios.reduce((sum, p) => sum + (p.targetWeight || 0), 0);
            
            filteredPortfolios.forEach(portfolio => {
                const normalizedWeight = totalTargetWeight > 0 ? (portfolio.targetWeight / totalTargetWeight) * 100 : 0;
                portfolio.targetValue = (normalizedWeight / 100) * newTotalValue;
                portfolio.discrepancy = portfolio.targetValue - portfolio.currentValue;
            });

            // Calculate actions based on rebalancing mode
            this.calculateRebalancingActions(filteredPortfolios, totalCurrentValue);

            // Sync calculated actions back to master portfolioData for detailed view consistency
            filteredPortfolios.forEach(filtered => {
                const originalPortfolio = this.portfolioData.portfolios.find(p => p.name === filtered.name);
                if (originalPortfolio) {
                    originalPortfolio.action = filtered.action;
                    originalPortfolio.targetValue = filtered.targetValue;
                    originalPortfolio.discrepancy = filtered.discrepancy;
                }
            });

            // Generate table HTML
            const tableHTML = this.generatePortfolioTableHTML(filteredPortfolios, totalCurrentValue, newTotalValue);

            // Update the table container
            const container = document.getElementById('portfolio-table-container');
            if (container) {
                container.innerHTML = tableHTML;
            }
        }

        calculateRebalancingActions(portfolios, totalCurrentValue) {
            /**
             * UNIFIED ALLOCATION LOGIC
             * All modes follow the same core principles:
             * 1. Calculate gap = target_value - current_value
             * 2. Exclude items with gap = 0 (already at target)
             * 3. Distribute capital proportionally based on gap sizes
             *
             * Mode differences:
             * - existing-only: Allows sells (negative gaps), no new capital, buys = sells
             * - new-only: Only buys (positive gaps), distribute new capital only
             * - new-with-sells: Allows both, distribute full target adjustment
             */

            if (this.rebalanceMode === 'existing-only') {
                // Mode: Rebalance Existing Capital (no new money, buys must equal sells)
                // Calculate gaps and distribute proportionally
                const positiveGaps = [];
                const negativeGaps = [];
                let totalPositiveGap = 0;
                let totalNegativeGap = 0;

                portfolios.forEach(portfolio => {
                    const gap = portfolio.discrepancy;

                    if (Math.abs(gap) < 0.01) {
                        // At target - no action
                        portfolio.action = 0;
                    } else if (gap > 0) {
                        // Below target - needs to buy
                        positiveGaps.push(portfolio);
                        totalPositiveGap += gap;
                    } else {
                        // Above target - needs to sell
                        negativeGaps.push(portfolio);
                        totalNegativeGap += Math.abs(gap);
                    }
                });

                // Calculate the smaller of total buys or total sells
                const rebalanceAmount = Math.min(totalPositiveGap, totalNegativeGap);

                // Distribute buys proportionally
                positiveGaps.forEach(portfolio => {
                    const proportionalShare = portfolio.discrepancy / totalPositiveGap;
                    portfolio.action = proportionalShare * rebalanceAmount;
                });

                // Distribute sells proportionally
                negativeGaps.forEach(portfolio => {
                    const proportionalShare = Math.abs(portfolio.discrepancy) / totalNegativeGap;
                    portfolio.action = -1 * proportionalShare * rebalanceAmount;
                });

            } else if (this.rebalanceMode === 'new-only') {
                // Mode: New Capital Only (no sales, only buys)
                // Only allocate to portfolios BELOW target
                // Distribute proportionally based on gap size

                const eligibleGaps = [];
                let totalGap = 0;

                portfolios.forEach(portfolio => {
                    const gap = portfolio.discrepancy;

                    if (gap <= 0) {
                        // At or above target - gets 0€
                        portfolio.action = 0;
                    } else {
                        // Below target - eligible for allocation
                        eligibleGaps.push({ portfolio, gap });
                        totalGap += gap;
                    }
                });

                // Distribute new capital proportionally by gap size
                if (this.investmentAmount > 0 && totalGap > 0) {
                    eligibleGaps.forEach(item => {
                        const proportionalShare = item.gap / totalGap;
                        item.portfolio.action = proportionalShare * this.investmentAmount;
                    });
                }

            } else if (this.rebalanceMode === 'new-with-sells') {
                // Mode: New Capital with Full Rebalancing (allows both buys and sells)
                // Distribute full discrepancy, allowing both positive and negative actions

                portfolios.forEach(portfolio => {
                    const gap = portfolio.discrepancy;

                    if (Math.abs(gap) < 0.01) {
                        // At target - no action
                        portfolio.action = 0;
                    } else {
                        // Apply full gap adjustment (buy if positive, sell if negative)
                        portfolio.action = gap;
                    }
                });
            }
        }

        generatePortfolioTableHTML(portfolios, totalCurrentValue, newTotalValue) {
            let tableHTML = `
            <div class="table-responsive">
                <table class="table table-striped table-hover unified-table">
                    <thead>
                        <tr>
                            <th class="col-company">Name</th>
                            <th class="col-currency">Current Value</th>
                            <th class="col-percentage">Current Allocation</th>
                            <th class="col-percentage">Target Allocation</th>
                            <th class="col-currency">Target Value</th>
                            <th class="col-input-medium">Actions</th>
                            <th class="col-currency">Value After Action</th>
                            <th class="col-percentage">Allocation After Action</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            // Track totals for summary
            let totalTargetValue = 0;
            let totalBuys = 0;
            let totalSells = 0;
            let totalValueAfter = 0;

            portfolios.forEach(portfolio => {
                const currentAllocation = totalCurrentValue > 0 ? (portfolio.currentValue / totalCurrentValue) * 100 : 0;
                const valueAfterAction = portfolio.currentValue + portfolio.action;
                const allocationAfterAction = newTotalValue > 0 ? (valueAfterAction / newTotalValue) * 100 : 0;

                // Determine action styling and text
                let actionClass = "actions-neutral";
                let actionText = "No action";
                
                if (portfolio.action > 0.01) {
                    actionClass = "actions-positive";
                    actionText = `Buy ${this.formatCurrency(portfolio.action)}`;
                    totalBuys += portfolio.action;
                } else if (portfolio.action < -0.01) {
                    actionClass = "actions-negative";
                    actionText = `Sell ${this.formatCurrency(Math.abs(portfolio.action))}`;
                    totalSells += Math.abs(portfolio.action);
                }

                // Check for position deficits
                const currentPositions = this.countCurrentPositions(portfolio);
                const minPositions = portfolio.minPositions || 0;
                const positionDeficit = Math.max(0, minPositions - currentPositions);

                let portfolioNameDisplay = portfolio.name;

                // Show indicator for completely empty portfolios
                if (portfolio.currentValue === 0 || !portfolio.currentValue) {
                    portfolioNameDisplay = `${portfolio.name} <span class="badge bg-info" style="font-size: 0.75em; padding: 0.25em 0.5em; margin-left: 0.5em;">Empty - Needs Positions</span>`;
                } else if (positionDeficit > 0) {
                    // Show warning for portfolios that need more positions
                    portfolioNameDisplay = `${portfolio.name} <span class="text-warning" title="Needs ${positionDeficit} more positions">⚠️</span>`;
                }

                totalTargetValue += portfolio.targetValue;
                totalValueAfter += valueAfterAction;

                // Add row to table
                tableHTML += `
                    <tr ${positionDeficit > 0 ? 'class="table-warning"' : ''}>
                        <td class="col-company">${portfolioNameDisplay}</td>
                        <td class="col-currency current-value">${this.formatCurrency(portfolio.currentValue)}</td>
                        <td class="col-percentage allocation-percentage">${this.formatPercentage(currentAllocation)}</td>
                        <td class="col-percentage target-value">${this.formatPercentage(portfolio.targetWeight || 0)}</td>
                        <td class="col-currency target-value">${this.formatCurrency(portfolio.targetValue)}</td>
                        <td class="col-input-medium ${actionClass}">${actionText}</td>
                        <td class="col-currency value-after">${this.formatCurrency(valueAfterAction)}</td>
                        <td class="col-percentage allocation-after">${this.formatPercentage(allocationAfterAction)}</td>
                    </tr>
                `;
            });

            // Add total row
            tableHTML += `
                    <tr class="total-row">
                        <td class="col-company"><strong>Total</strong></td>
                        <td class="col-currency current-value"><strong>${this.formatCurrency(totalCurrentValue)}</strong></td>
                        <td class="col-percentage allocation-percentage"><strong>100%</strong></td>
                        <td class="col-percentage target-value"><strong>100%</strong></td>
                        <td class="col-currency target-value"><strong>${this.formatCurrency(totalTargetValue)}</strong></td>
                        <td class="col-input-medium">
                            ${totalBuys > 0 ? `<span class="actions-positive">Buy: ${this.formatCurrency(totalBuys)}</span><br>` : ''}
                            ${totalSells > 0 ? `<span class="actions-negative">Sell: ${this.formatCurrency(totalSells)}</span>` : ''}
                            ${totalBuys === 0 && totalSells === 0 ? '<span class="actions-neutral">No action</span>' : ''}
                        </td>
                        <td class="col-currency value-after"><strong>${this.formatCurrency(totalValueAfter)}</strong></td>
                        <td class="col-percentage allocation-after"><strong>100%</strong></td>
                    </tr>
                </tbody>
            </table>
            </div>
            `;

            // Add summary footer
            tableHTML += this.generateSummaryFooter(totalCurrentValue, totalBuys, totalSells, totalValueAfter);

            return tableHTML;
        }

        generateSummaryFooter(currentValue, totalBuys, totalSells, newValue) {
            const netCapital = totalBuys - totalSells;
            
            return `
            <div class="rebalance-summary">
                <div class="summary-row">
                    <span class="summary-label">Portfolio Value:</span>
                    <span class="summary-value">${this.formatCurrency(currentValue)}</span>
                </div>
                ${netCapital > 0 ? `
                <div class="summary-row">
                    <span class="summary-label">New Capital Required:</span>
                    <span class="summary-value positive">${this.formatCurrency(netCapital)}</span>
                </div>
                ` : ''}
                <div class="summary-row">
                    <span class="summary-label">New Portfolio Value:</span>
                    <span class="summary-value">${this.formatCurrency(newValue)}</span>
                </div>
                ${totalBuys > 0 || totalSells > 0 ? `
                <div class="summary-row">
                    <span class="summary-label">Total Transactions:</span>
                    <span class="summary-value">
                        ${totalBuys > 0 ? `<span class="positive">Buy: ${this.formatCurrency(totalBuys)}</span>` : ''}
                        ${totalBuys > 0 && totalSells > 0 ? ' | ' : ''}
                        ${totalSells > 0 ? `<span class="negative">Sell: ${this.formatCurrency(totalSells)}</span>` : ''}
                    </span>
                </div>
                ` : ''}
            </div>
            `;
        }

        updateTableCalculations() {
            if (this.portfolioData) {
                this.renderPortfolioTable();
            }
        }

        toggleCategoryExpand(categoryId) {
            console.log(`Toggling category: ${categoryId}`);
            if (this.categoriesExpanded.has(categoryId)) {
                this.categoriesExpanded.delete(categoryId);
                console.log(`Collapsed: ${categoryId}`);
            } else {
                this.categoriesExpanded.add(categoryId);
                console.log(`Expanded: ${categoryId}`);
            }
            this.renderDetailedView();
        }

        expandAllCategories() {
            if (!this.selectedPortfolio || !this.portfolioData) return;

            const portfolio = this.portfolioData.portfolios.find(p => p.name === this.selectedPortfolio);
            if (!portfolio || !portfolio.categories) return;

            // Add all category IDs to the expanded set
            portfolio.categories.forEach((category, categoryIndex) => {
                if (category.positions && category.positions.length > 0) {
                    const categoryId = category.name === 'Missing Positions'
                        ? `${portfolio.name}-Missing-Positions`
                        : `${portfolio.name}-${category.name}-${categoryIndex}`;
                    this.categoriesExpanded.add(categoryId);
                }
            });

            console.log('Expanded all categories:', Array.from(this.categoriesExpanded));
            this.renderDetailedView();
        }

        collapseAllCategories() {
            if (!this.selectedPortfolio || !this.portfolioData) return;

            const portfolio = this.portfolioData.portfolios.find(p => p.name === this.selectedPortfolio);
            if (!portfolio || !portfolio.categories) return;

            // Remove all category IDs for this portfolio from the expanded set
            portfolio.categories.forEach((category, categoryIndex) => {
                if (category.positions && category.positions.length > 0) {
                    const categoryId = category.name === 'Missing Positions'
                        ? `${portfolio.name}-Missing-Positions`
                        : `${portfolio.name}-${category.name}-${categoryIndex}`;
                    this.categoriesExpanded.delete(categoryId);
                }
            });

            console.log('Collapsed all categories:', Array.from(this.categoriesExpanded));
            this.renderDetailedView();
        }

        showExpandCollapseButtons() {
            const expandBtn = document.getElementById('expand-all-btn');
            const collapseBtn = document.getElementById('collapse-all-btn');
            if (expandBtn) expandBtn.style.display = 'inline-block';
            if (collapseBtn) collapseBtn.style.display = 'inline-block';
        }

        hideExpandCollapseButtons() {
            const expandBtn = document.getElementById('expand-all-btn');
            const collapseBtn = document.getElementById('collapse-all-btn');
            if (expandBtn) expandBtn.style.display = 'none';
            if (collapseBtn) collapseBtn.style.display = 'none';
        }

        /**
         * Render the detailed view according to the rebalancing actions table plan
         */
        renderDetailedView() {
            const detailedContainer = document.getElementById('detailed-portfolio-container');

            if (!detailedContainer) return;
            if (!this.portfolioData || !this.portfolioData.portfolios || this.portfolioData.portfolios.length === 0) {
                this.showNoPositionsMessage();
                return;
            }

            // Clear the container
            detailedContainer.innerHTML = '';

            // If no portfolio is selected, show a message
            if (!this.selectedPortfolio) {
                detailedContainer.innerHTML = `
                    <div class="alert alert-info mt-4">
                        Please select a portfolio to view its details.
                    </div>
                `;
                this.hideExpandCollapseButtons();
                return;
            }

            // Find the selected portfolio
            const portfolio = this.portfolioData.portfolios.find(p => p.name === this.selectedPortfolio);
            if (!portfolio) return;

            // Special handling for GME portfolio - add debugging
            if (portfolio.name === "GME") {
                console.log("Processing GME portfolio:", portfolio);
            }

            // Skip portfolios with no current value
            if (!portfolio.currentValue || portfolio.currentValue === 0) {
                detailedContainer.innerHTML = `
                    <div class="alert alert-warning mt-4">
                        No data available for the selected portfolio.
                    </div>
                `;
                this.hideExpandCollapseButtons();
                return;
            }

            // Skip portfolios with no target weight defined
            if (!portfolio.targetWeight || portfolio.targetWeight === 0) {
                detailedContainer.innerHTML = `
                    <div class="alert alert-warning mt-4">
                        This portfolio has no target allocation defined in the builder. Please define a target allocation first.
                    </div>
                `;
                this.hideExpandCollapseButtons();
                return;
            }

            // Get the portfolio action amount from the global view calculation
            // This ensures consistency between global and detailed views
            const globalPortfolio = this.portfolioData.portfolios.find(p => p.name === portfolio.name);
            const portfolioActionAmount = globalPortfolio && globalPortfolio.action ? globalPortfolio.action : 0;

            // Display the action amount for this portfolio at the top of the detailed view
            const investmentInfo = document.createElement('div');
            investmentInfo.className = 'investment-info mb-4';
            
            let infoText = '';
            if (this.rebalanceMode === 'existing-only') {
                if (portfolioActionAmount > 0) {
                    infoText = `Portfolio needs: ${this.formatCurrency(portfolioActionAmount)} (rebalancing existing capital)`;
                } else if (portfolioActionAmount < 0) {
                    infoText = `Portfolio excess: ${this.formatCurrency(Math.abs(portfolioActionAmount))} (rebalancing existing capital)`;
                } else {
                    infoText = `Portfolio is balanced (rebalancing existing capital)`;
                }
            } else {
                infoText = `Portfolio allocation amount: ${this.formatCurrency(Math.max(0, portfolioActionAmount))}`;
                if (this.investmentAmount > 0) {
                    infoText += ` <span class="text-muted ms-2">(from total investment: ${this.formatCurrency(this.investmentAmount)})</span>`;
                }
            }
            
            investmentInfo.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>
                    ${infoText}
                </div>
            `;
            detailedContainer.appendChild(investmentInfo);

            // Create rebalancing table
            const tableResponsive = document.createElement('div');
            tableResponsive.className = 'table-responsive';

            const table = document.createElement('table');
            table.className = 'table table-hover';

            // Table header
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Current Value</th>
                    <th>Current Allocation</th>
                    <th>Target Allocation</th>
                    <th>Target Value</th>
                    <th>Actions</th>
                    <th>Value After Action</th>
                    <th>Allocation After Action</th>
                </tr>
            `;

            // Table body
            const tbody = document.createElement('tbody');

            // Calculate the distribution base and target value
            let totalCurrentValue = portfolio.currentValue || 0;

            // Key fix: For "new-only" mode, distribute only the allocated new capital
            // For rebalancing modes, use the final target value (current + action)
            let distributionBase;
            let portfolioTargetValue;  // Final value after all actions

            if (this.rebalanceMode === 'new-only') {
                // New-only mode: positions compete for their share of NEW capital only
                distributionBase = portfolioActionAmount;  // Distribute the €18K
                portfolioTargetValue = totalCurrentValue + portfolioActionAmount;  // Final value €80K
            } else {
                // Rebalancing modes: positions target their share of final portfolio value
                distributionBase = totalCurrentValue + portfolioActionAmount;  // Both distribute and target the same €80K
                portfolioTargetValue = distributionBase;
            }

            let totalAction = 0;
            let totalValueAfter = 0;

            // Define totalValueAfterAllActions at the portfolio level for consistent scope
            const totalValueAfterAllActions = portfolioTargetValue;

            // Count total number of positions and positions with user-defined allocations
            let totalPositionsCount = 0;
            let userDefinedAllocationsCount = 0;
            let sumUserDefinedAllocations = 0;

            // First pass: gather position counts and target allocations
            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach(category => {
                    if (!category.positions || category.positions.length === 0) return;
                    if (category.name === 'Missing Positions') {
                        const placeholderPosition = category.positions.find(pos => pos.isPlaceholder);
                        if (placeholderPosition) {
                            totalPositionsCount += placeholderPosition.positionsRemaining || 0;
                        }
                    } else {
                        category.positions.forEach(position => {
                            totalPositionsCount++;
                            // Check if position has user-defined allocation
                            if (position.targetAllocation && position.targetAllocation > 0) {
                                userDefinedAllocationsCount++;
                                sumUserDefinedAllocations += position.targetAllocation;
                            }
                        });
                    }
                });
            }

            // Use builder configuration instead of crude equal distribution
            let defaultAllocation = 0;

            // Get builder positions data for this portfolio
            const builderPositions = portfolio.builderPositions || [];
            const builderPositionsMap = new Map();

            // Map builder positions by company name for easy lookup
            builderPositions.forEach(pos => {
                if (!pos.isPlaceholder) {
                    builderPositionsMap.set(pos.companyName, pos.weight || 0);
                }
            });

            // Find placeholder position for default weight calculation
            const placeholderPosition = builderPositions.find(pos => pos.isPlaceholder);

            if (placeholderPosition) {
                // Use builder's calculated weight per position for missing positions
                defaultAllocation = placeholderPosition.weight || 0;
            } else if (sumUserDefinedAllocations < 100) {
                // Fallback to equal distribution if no builder data
                const remainingAllocation = 100 - sumUserDefinedAllocations;
                const positionsWithoutUserDefinedAllocation = totalPositionsCount - userDefinedAllocationsCount;
                defaultAllocation = positionsWithoutUserDefinedAllocation > 0 ?
                    remainingAllocation / positionsWithoutUserDefinedAllocation : 0;
            }

            // No longer need totalPositiveDiscrepancy since we calculate actions directly

            // Second pass: Check if we should show missing positions
            // This must be done BEFORE normalization
            let shouldShowMissingPositions = false;
            const missingPositionsCategory = portfolio.categories && portfolio.categories.find(cat =>
                cat.name === 'Missing Positions' ||
                (cat.positions && cat.positions.some(pos => pos.isPlaceholder))
            );

            if (missingPositionsCategory) {
                // Calculate total weight of real positions from builder
                const realBuilderPositions = builderPositions.filter(pos => !pos.isPlaceholder);
                const totalRealWeight = realBuilderPositions.reduce((sum, pos) => sum + (pos.weight || 0), 0);

                const minPositions = portfolio.minPositions || 0;
                const currentPositionsCount = portfolio.categories
                    .filter(cat => cat.name !== 'Missing Positions')
                    .reduce((sum, cat) => sum + (cat.positions ? cat.positions.length : 0), 0);

                shouldShowMissingPositions = (
                    currentPositionsCount < minPositions &&
                    Math.round(totalRealWeight) < 100
                );

                console.log(`Portfolio ${portfolio.name}: shouldShowMissingPositions=${shouldShowMissingPositions}, currentPositions=${currentPositionsCount}, minPositions=${minPositions}, totalRealWeight=${totalRealWeight}%`);
            }

            // Third pass: assign target allocations and calculate total for normalization
            let totalTargetAllocation = 0;
            let hasBackendConstrainedValues = false;

            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach((category, categoryIndex) => {
                    // Skip categories with no positions
                    if (!category.positions || category.positions.length === 0) return;

                    // Skip missing positions if they shouldn't be shown
                    if (category.name === 'Missing Positions' && !shouldShowMissingPositions) return;

                    // Assign target allocations for each position
                    category.positions.forEach(position => {
                        // Check if backend provided constrained target value
                        if (position.targetValue !== undefined && position.targetValue !== null) {
                            hasBackendConstrainedValues = true;
                            // Calculate percentage for display (will be recalculated properly later)
                            const backendPct = portfolioTargetValue > 0
                                ? (position.targetValue / portfolioTargetValue) * 100
                                : 0;
                            totalTargetAllocation += backendPct;
                        } else {
                            // Use builder weight if available, otherwise use default allocation
                            if (!position.targetAllocation || position.targetAllocation <= 0) {
                                const builderWeight = builderPositionsMap.get(position.name);
                                position.targetAllocation = builderWeight || defaultAllocation;
                            }
                            totalTargetAllocation += position.targetAllocation;
                        }
                    });
                });
            }

            // Normalize target allocations to sum to exactly 100%
            // SKIP normalization if backend provided constrained values (already normalized)
            const normalizationFactor = (!hasBackendConstrainedValues && totalTargetAllocation > 0)
                ? (100 / totalTargetAllocation)
                : 1;
            console.log(`Portfolio ${portfolio.name}: Total target allocation before normalization: ${totalTargetAllocation}%, normalization factor: ${normalizationFactor}, using backend values: ${hasBackendConstrainedValues}`);

            // Fourth pass: normalize allocations and calculate target values
            // Store normalized allocations in a separate map to avoid mutating originals
            const normalizedAllocations = new Map();

            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach((category, categoryIndex) => {
                    // Skip categories with no positions
                    if (!category.positions || category.positions.length === 0) return;

                    // Skip missing positions if they shouldn't be shown
                    if (category.name === 'Missing Positions' && !shouldShowMissingPositions) return;

                    // Calculate category metrics
                    let categoryCurrentValue = 0;
                    let categoryTargetAllocation = 0;

                    // Calculate values for each position in the category
                    category.positions.forEach(position => {
                        categoryCurrentValue += (position.currentValue || 0);

                        // CRITICAL: Use backend's constrained target value if available
                        // Backend applies type constraints (maxPerStock, maxPerETF) with recursive redistribution
                        if (position.targetValue !== undefined && position.targetValue !== null) {
                            // Backend has already calculated constrained value - use it directly
                            position.calculatedTargetValue = position.targetValue;

                            // Calculate the percentage this represents (for display)
                            const backendAllocation = portfolioTargetValue > 0
                                ? (position.targetValue / portfolioTargetValue) * 100
                                : 0;
                            normalizedAllocations.set(position, backendAllocation);
                            categoryTargetAllocation += backendAllocation;

                            console.log(`Using backend constrained value for ${position.name}: ${position.targetValue.toFixed(2)} (${backendAllocation.toFixed(2)}%)`);
                        } else {
                            // Fallback to frontend normalization if backend didn't provide targetValue
                            const normalizedAllocation = position.targetAllocation * normalizationFactor;
                            normalizedAllocations.set(position, normalizedAllocation);
                            categoryTargetAllocation += normalizedAllocation;

                            const targetValue = (normalizedAllocation / 100) * portfolioTargetValue;
                            position.calculatedTargetValue = targetValue;

                            console.log(`Using frontend normalization for ${position.name}: ${normalizedAllocation.toFixed(2)}%`);
                        }
                    });

                    // Set category values
                    category.currentValue = categoryCurrentValue;
                    category.targetAllocation = categoryTargetAllocation;
                    category.calculatedTargetValue = (categoryTargetAllocation / 100) * portfolioTargetValue;
                });
            }

            // Fifth pass: UNIFIED ALLOCATION DISTRIBUTION LOGIC
            /**
             * All modes follow the same core principles:
             * 1. Calculate gap = target_value - current_value for each position
             * 2. Exclude positions with gap = 0 (already at target)
             * 3. Exclude entire categories if category is at/above target
             * 4. Distribute capital proportionally based on gap sizes
             *
             * Mode differences:
             * - existing-only: Allows sells (negative gaps), buys = sells at portfolio level
             * - new-only: Only buys (positive gaps), distribute portfolio's new capital
             * - new-with-sells: Allows both buys and sells, full rebalancing
             */

            const positiveGaps = [];
            const negativeGaps = [];
            let totalPositiveGap = 0;
            let totalNegativeGap = 0;

            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach((category, categoryIndex) => {
                    // Skip categories with no positions
                    if (!category.positions || category.positions.length === 0) return;

                    // Skip missing positions if they shouldn't be shown
                    if (category.name === 'Missing Positions' && !shouldShowMissingPositions) return;

                    // Check if category is at or above target (for all modes)
                    const categoryCurrentValue = category.currentValue || 0;
                    const categoryTargetValue = category.calculatedTargetValue || 0;
                    const categoryGap = categoryTargetValue - categoryCurrentValue;

                    // Process positions within this category
                    category.positions.forEach(position => {
                        const positionCurrentValue = position.currentValue || 0;
                        const positionTargetValue = position.calculatedTargetValue || 0;
                        const positionGap = positionTargetValue - positionCurrentValue;

                        position.gap = positionGap;

                        // Determine eligibility based on mode and gap
                        if (Math.abs(positionGap) < 0.01) {
                            // At target - no action needed
                            position.excludedReason = 'at_target';
                            position.action = 0;
                            position.valueAfter = positionCurrentValue;

                        } else if (categoryGap <= 0 && positionGap > 0) {
                            // Category is at/above target but position is below
                            // In this case, category constraint takes precedence
                            position.excludedReason = 'category_above_target';
                            position.action = 0;
                            position.valueAfter = positionCurrentValue;

                        } else if (this.rebalanceMode === 'new-only' && positionGap <= 0) {
                            // New-only mode: exclude positions at or above target
                            position.excludedReason = 'at_or_above_target';
                            position.action = 0;
                            position.valueAfter = positionCurrentValue;

                        } else if (this.rebalanceMode === 'existing-only' || this.rebalanceMode === 'new-with-sells') {
                            // Rebalancing modes: include all positions with gaps
                            if (positionGap > 0) {
                                // Below target - needs to buy
                                positiveGaps.push({
                                    position: position,
                                    gap: positionGap,
                                    category: category.name
                                });
                                totalPositiveGap += positionGap;
                            } else {
                                // Above target - needs to sell
                                negativeGaps.push({
                                    position: position,
                                    gap: Math.abs(positionGap),
                                    category: category.name
                                });
                                totalNegativeGap += Math.abs(positionGap);
                            }

                        } else {
                            // New-only mode with positive gap
                            positiveGaps.push({
                                position: position,
                                gap: positionGap,
                                category: category.name
                            });
                            totalPositiveGap += positionGap;
                        }
                    });
                });
            }

            console.log(`Portfolio ${portfolio.name} (${this.rebalanceMode}): ${positiveGaps.length} buys (€${totalPositiveGap.toFixed(2)}), ${negativeGaps.length} sells (€${totalNegativeGap.toFixed(2)})`);

            // Distribute capital based on mode
            if (this.rebalanceMode === 'new-only') {
                // New-only: Distribute new capital proportionally to positive gaps only
                if (totalPositiveGap > 0 && portfolioActionAmount > 0) {
                    const availableCapital = Math.max(0, portfolioActionAmount);

                    positiveGaps.forEach(item => {
                        const proportionalShare = item.gap / totalPositiveGap;
                        const allocation = proportionalShare * availableCapital;

                        item.position.action = allocation;
                        item.position.valueAfter = (item.position.currentValue || 0) + allocation;

                        if (item.gap > 100) {
                            console.log(`  Buy ${item.position.name}: gap=€${item.gap.toFixed(2)}, share=${(proportionalShare*100).toFixed(1)}%, allocation=€${allocation.toFixed(2)}`);
                        }
                    });
                }

            } else if (this.rebalanceMode === 'existing-only') {
                // Existing-only: Proportional buys and sells, buys = sells
                const rebalanceAmount = Math.min(totalPositiveGap, totalNegativeGap);

                if (rebalanceAmount > 0) {
                    // Distribute buys proportionally
                    if (totalPositiveGap > 0) {
                        positiveGaps.forEach(item => {
                            const proportionalShare = item.gap / totalPositiveGap;
                            const allocation = proportionalShare * rebalanceAmount;

                            item.position.action = allocation;
                            item.position.valueAfter = (item.position.currentValue || 0) + allocation;
                        });
                    }

                    // Distribute sells proportionally
                    if (totalNegativeGap > 0) {
                        negativeGaps.forEach(item => {
                            const proportionalShare = item.gap / totalNegativeGap;
                            const allocation = proportionalShare * rebalanceAmount;

                            item.position.action = -allocation;
                            item.position.valueAfter = (item.position.currentValue || 0) - allocation;
                        });
                    }
                }

            } else if (this.rebalanceMode === 'new-with-sells') {
                // New-with-sells: Full rebalancing - apply full gaps
                positiveGaps.forEach(item => {
                    item.position.action = item.gap;
                    item.position.valueAfter = (item.position.currentValue || 0) + item.gap;
                });

                negativeGaps.forEach(item => {
                    item.position.action = -item.gap;
                    item.position.valueAfter = (item.position.currentValue || 0) - item.gap;
                });
            }

            // Ensure all positions have action and valueAfter set
            if (portfolio.categories) {
                portfolio.categories.forEach(category => {
                    if (category.positions) {
                        category.positions.forEach(position => {
                            if (position.action === undefined) {
                                position.action = 0;
                                position.valueAfter = position.currentValue || 0;
                            }
                        });
                    }
                });
            }

            // Sixth pass: render categories and positions
            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach((category, categoryIndex) => {
                    // Skip categories with no positions
                    if (!category.positions || category.positions.length === 0) return;

                    // Skip missing positions if they shouldn't be shown
                    if (category.name === 'Missing Positions' && !shouldShowMissingPositions) return;

                    const categoryId = `${portfolio.name}-${category.name}-${categoryIndex}`;
                    const isExpanded = this.categoriesExpanded.has(categoryId);

                    // Calculate category metrics for rendering
                    let categoryAction = 0;
                    let categoryValueAfter = 0;

                    // Calculate category percentages
                    const categoryCurrentAllocation = totalCurrentValue > 0
                        ? (category.currentValue / totalCurrentValue) * 100
                        : 0;

                    // Use the already calculated position actions and aggregate for category
                    category.positions.forEach(position => {
                        categoryAction += position.action;
                        categoryValueAfter += position.valueAfter;
                    });

                    // Determine action class and text for the category
                    let categoryActionClass = "actions-neutral";
                    let categoryActionText = "No action";

                    if (categoryAction > 0.01) {
                        categoryActionClass = "actions-positive";
                        categoryActionText = `Buy ${this.formatCurrency(categoryAction)}`;
                    } else if (categoryAction < -0.01) {
                        categoryActionClass = "actions-negative";
                        categoryActionText = `Sell ${this.formatCurrency(Math.abs(categoryAction))}`;
                    }

                    const categoryRow = document.createElement('tr');
                    // Add special styling for Missing Positions
                    const isMissingPositions = category.name === 'Missing Positions';
                    categoryRow.className = isMissingPositions
                        ? 'table-warning category-row missing-positions-category'
                        : 'table-secondary category-row';
                    categoryRow.style.cursor = 'pointer';

                    // Calculate allocation after action for category
                    const categoryAllocationAfterAction = totalValueAfterAllActions > 0
                        ? (categoryValueAfter / totalValueAfterAllActions) * 100
                        : 0;

                    // Build category name display with special icon for missing positions
                    const categoryNameHtml = isMissingPositions
                        ? `<i class="fas fa-exclamation-triangle me-2 text-warning"></i><strong>Missing Positions (${category.positions.length})</strong>`
                        : `<strong>${category.name}</strong>`;

                    categoryRow.innerHTML = `
                        <td>
                            <i class="fas ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'} me-2"></i>
                            ${categoryNameHtml}
                        </td>
                        <td></td>
                        <td class="current-value">${this.formatCurrency(category.currentValue || 0)}</td>
                        <td>${this.formatPercentage(categoryCurrentAllocation)}</td>
                        <td>${this.formatPercentage(category.targetAllocation || 0)}</td>
                        <td class="target-value">${this.formatCurrency(category.calculatedTargetValue || 0)}</td>
                        <td class="${categoryActionClass}">${categoryActionText}</td>
                        <td class="value-after">${this.formatCurrency(categoryValueAfter)}</td>
                        <td class="allocation-after">${this.formatPercentage(categoryAllocationAfterAction)}</td>
                    `;

                    categoryRow.addEventListener('click', () => {
                        this.toggleCategoryExpand(categoryId);
                    });

                    tbody.appendChild(categoryRow);

                    // Add position rows if category is expanded
                    if (isExpanded) {
                        // Positions in this category
                        category.positions.forEach(position => {
                            // Calculate current allocation
                            const positionCurrentAllocation = totalCurrentValue > 0
                                ? ((position.currentValue || 0) / totalCurrentValue) * 100
                                : 0;

                            // Calculate allocation after action for position
                            const positionAllocationAfterAction = totalValueAfterAllActions > 0
                                ? (position.valueAfter / totalValueAfterAllActions) * 100
                                : 0;

                            // Determine action class and text
                            let actionClass = "actions-neutral";
                            let actionText = "No action";

                            if (position.action > 0.01) {
                                actionClass = "actions-positive";
                                actionText = `Buy ${this.formatCurrency(position.action)}`;
                            } else if (position.action < -0.01) {
                                actionClass = "actions-negative";
                                actionText = `Sell ${this.formatCurrency(Math.abs(position.action))}`;
                            }

                            // Position row - indented to show hierarchy
                            const positionRow = document.createElement('tr');
                            const isPlaceholder = position.isPlaceholder || false;
                            positionRow.className = isPlaceholder
                                ? 'position-row placeholder-position'
                                : 'position-row';

                            // Add special styling for placeholder positions
                            if (isPlaceholder) {
                                positionRow.style.fontStyle = 'italic';
                                positionRow.style.color = '#6c757d';
                                positionRow.title = "This represents a future position to be filled";
                            }

                            // Build position name with icon for placeholders
                            const positionNameHtml = isPlaceholder
                                ? `<i class="fas fa-plus-circle me-2 text-muted"></i>${position.name}`
                                : position.name;

                            // Get the normalized allocation for display
                            const displayAllocation = normalizedAllocations.get(position) || 0;

                            // Investment type display with icon
                            let typeDisplay = '-';
                            let typeIcon = '';
                            if (position.investment_type === 'Stock') {
                                typeIcon = '<i class="fas fa-chart-line me-1" style="color: #3b82f6;"></i>';
                                typeDisplay = typeIcon + 'Stock';
                            } else if (position.investment_type === 'ETF') {
                                typeIcon = '<i class="fas fa-layer-group me-1" style="color: #10b981;"></i>';
                                typeDisplay = typeIcon + 'ETF';
                            }

                            // Check if position is capped and build target allocation display
                            let targetAllocationDisplay = this.formatPercentage(displayAllocation);
                            if (position.is_capped) {
                                const rule = position.applicable_rule === 'maxPerStock' ? 'Stock' : 'ETF';
                                const unconstrainedPct = (position.unconstrained_target_value / portfolioTargetValue) * 100;
                                targetAllocationDisplay = `
                                    <span class="text-warning" title="Capped by max ${rule} rule. Unconstrained: ${this.formatPercentage(unconstrainedPct)}">
                                        <i class="fas fa-lock me-1"></i>${this.formatPercentage(displayAllocation)}
                                    </span>
                                `;
                            }

                            positionRow.innerHTML = `
                                <td class="position-name">
                                    <span class="ms-4">${positionNameHtml}</span>
                                </td>
                                <td class="text-center">${typeDisplay}</td>
                                <td class="current-value">${this.formatCurrency(position.currentValue || 0)}</td>
                                <td>${this.formatPercentage(positionCurrentAllocation)}</td>
                                <td>${targetAllocationDisplay}</td>
                                <td class="target-value">${this.formatCurrency(position.calculatedTargetValue || 0)}</td>
                                <td class="${actionClass}">${actionText}</td>
                                <td class="value-after">${this.formatCurrency(position.valueAfter || 0)}</td>
                                <td class="allocation-after">${this.formatPercentage(positionAllocationAfterAction)}</td>
                            `;

                            tbody.appendChild(positionRow);

                            // Add to totals
                            totalAction += position.action;
                            totalValueAfter += position.valueAfter;
                        });
                    } else {
                        // If category is collapsed, still add actions to totals
                        totalAction += categoryAction;
                        totalValueAfter += categoryValueAfter;
                    }
                });
            }

            // Verification: Check if totalAction matches portfolioActionAmount
            console.log(`Portfolio ${portfolio.name} verification:`);
            console.log(`  Expected action (from global): €${portfolioActionAmount.toFixed(2)}`);
            console.log(`  Calculated action (from positions): €${totalAction.toFixed(2)}`);
            console.log(`  Difference: €${Math.abs(totalAction - portfolioActionAmount).toFixed(2)}`);

            if (Math.abs(totalAction - portfolioActionAmount) > 0.10) {
                console.warn(`⚠️ Mismatch detected! Detailed view actions don't match global view.`);
            } else {
                console.log(`✓ Actions match within rounding tolerance`);
            }

            // Portfolio total row
            const totalRow = document.createElement('tr');
            totalRow.className = 'table-primary fw-bold';

            totalRow.innerHTML = `
                <td>Portfolio Total</td>
                <td></td>
                <td class="current-value">${this.formatCurrency(totalCurrentValue)}</td>
                <td>100%</td>
                <td>100%</td>
                <td class="target-value">${this.formatCurrency(portfolioTargetValue)}</td>
                <td>${this.formatCurrency(totalAction)}</td>
                <td class="value-after">${this.formatCurrency(totalValueAfter)}</td>
                <td class="allocation-after">100%</td>
            `;

            tbody.appendChild(totalRow);

            // Assemble table
            table.appendChild(thead);
            table.appendChild(tbody);
            tableResponsive.appendChild(table);

            // Add to container
            detailedContainer.appendChild(tableResponsive);

            // Show expand/collapse buttons since we have valid data
            this.showExpandCollapseButtons();
        }

        renderDetailedChart() {
            const detailedChartContainer = document.getElementById('detailedChart');

            if (!detailedChartContainer) return;
            if (!this.portfolioData || !this.portfolioData.portfolios) return;

            // Filter out portfolios with current value of 0
            const filteredPortfolios = this.portfolioData.portfolios.filter(portfolio =>
                portfolio.currentValue !== 0 && portfolio.currentValue !== null
            );

            // Clear previous chart contents
            detailedChartContainer.innerHTML = '';

            // Prepare data for the detailed chart
            const allCategories = [];

            filteredPortfolios.forEach((portfolio) => {
                if (portfolio.categories && portfolio.categories.length > 0) {
                    portfolio.categories.forEach(category => {
                        // Skip missing positions in chart
                        if (category.name === 'Missing Positions') return;

                        allCategories.push({
                            portfolio: portfolio.name,
                            category: category.name,
                            value: category.currentValue || 0
                        });
                    });
                }
            });

            if (typeof ChartConfig !== 'undefined' && allCategories.length > 0) {
                const labels = allCategories.map(c => `${c.portfolio} - ${c.category}`);
                const values = allCategories.map(c => c.value);
                ChartConfig.createStandardDoughnutChart('detailedChart', labels, values);
            } else {
                detailedChartContainer.innerHTML = `
                    <div class="alert alert-info">
                        No detailed category data available.
                    </div>
                `;
            }
        }
    }

    // Initialize portfolio allocator
    const allocator = new PortfolioAllocator();

    // Allocation Capacity Feature (Country & Category)
    // Shared constants for allocation charts
    const ALLOCATION_CHART_COLORS = {
        ranges: [
            {
                from: -Infinity,
                to: -0.01,
                color: '#dc3545' // Red for over-allocated
            },
            {
                from: 0,
                to: 0,
                color: '#e0e0e0' // Muted color for zero values
            },
            {
                from: 0.01,
                to: Infinity,
                color: '#00c4a7' // Green for capacity remaining
            }
        ]
    };

    // Country Capacity
    let countryCapacityExpanded = false;
    let countryCapacityData = null;

    // Category Capacity
    let categoryCapacityExpanded = false;
    let categoryCapacityData = null;

    // Toggle country capacity expander
    window.toggleCountryCapacityExpander = function() {
        const content = document.getElementById('country-capacity-content');
        const arrow = document.getElementById('country-capacity-arrow');
        
        countryCapacityExpanded = !countryCapacityExpanded;
        
        if (countryCapacityExpanded) {
            content.style.display = 'block';
            arrow.classList.remove('fa-angle-down');
            arrow.classList.add('fa-angle-up');
            
            // Load data when expanded for the first time
            if (!countryCapacityData) {
                fetchCountryCapacityData();
            }
        } else {
            content.style.display = 'none';
            arrow.classList.remove('fa-angle-up');
            arrow.classList.add('fa-angle-down');
        }
    };

    // Fetch country capacity data from API
    async function fetchCountryCapacityData() {
        try {
            const response = await fetch('/portfolio/api/allocate/country-capacity');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            countryCapacityData = await response.json();
            console.log('Country capacity data loaded:', countryCapacityData);
            renderCountryCapacityChart();
        } catch (error) {
            console.error('Error fetching country capacity data:', error);
            showCountryCapacityError('Failed to load country capacity data. Please try again later.');
        }
    }

    // Render country capacity bar chart
    function renderCountryCapacityChart() {
        const chartContainer = document.getElementById('country-capacity-chart');
        
        if (!chartContainer) return;
        if (!countryCapacityData || !countryCapacityData.countries || countryCapacityData.countries.length === 0) {
            showCountryCapacityEmpty();
            return;
        }

        // Clear the loading spinner
        chartContainer.innerHTML = '';

        // Prepare data for the chart
        const countries = countryCapacityData.countries;
        const labels = countries.map(c => c.country);
        const values = countries.map(c => c.remaining_capacity);

        // Create chart options styled to match Portfolio Allocations table
        const chartOptions = {
            series: [{
                name: 'Country Allocation',
                data: values
            }],
            chart: {
                type: 'bar',
                height: Math.max(350, countries.length * 45), // Slightly more generous spacing
                toolbar: {
                    show: false
                },
                background: 'transparent',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                animations: {
                    enabled: false // Remove animations for lightweight performance
                }
            },
            plotOptions: {
                bar: {
                    horizontal: true,
                    borderRadius: 6, // Match CSS border-radius
                    dataLabels: {
                        position: 'top'
                    },
                    colors: ALLOCATION_CHART_COLORS  // Use shared color configuration
                }
            },
            dataLabels: {
                enabled: true,
                formatter: function(val) {
                    if (val < 0) {
                        return `Over: €${Math.abs(Math.round(val)).toLocaleString()}`;
                    } else if (val > 0) {
                        return `€${Math.round(val).toLocaleString()}`;
                    } else {
                        return '€0';
                    }
                },
                offsetX: 10,
                style: {
                    fontSize: '13px',
                    fontWeight: '500',
                    colors: [getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333'] // Adaptive text color
                }
            },
            xaxis: {
                categories: labels,
                title: {
                    text: 'Allocation Status (€) - Negative = Over-allocated',
                    style: {
                        fontSize: '14px',
                        fontWeight: '500',
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666' // Adaptive muted color
                    }
                },
                labels: {
                    formatter: function(val) {
                        return `€${Math.round(val).toLocaleString()}`;
                    },
                    style: {
                        fontSize: '12px',
                        colors: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666' // Adaptive muted color
                    }
                },
                axisBorder: {
                    show: true,
                    color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0' // Adaptive border color
                },
                axisTicks: {
                    show: true,
                    color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0' // Adaptive border color
                }
            },
            yaxis: {
                title: {
                    text: 'Countries',
                    style: {
                        fontSize: '14px',
                        fontWeight: '500',
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666' // Adaptive muted color
                    }
                },
                labels: {
                    style: {
                        fontSize: '13px',
                        fontWeight: '500',
                        colors: getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333' // Adaptive text color
                    }
                }
            },
            title: {
                text: `Country Allocation Status (Max ${countryCapacityData.max_per_country_percent}% per country)`,
                align: 'left',
                margin: 20,
                style: {
                    fontSize: '16px',
                    fontWeight: '600',
                    color: getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333' // Adaptive text color
                }
            },
            colors: ['#00c4a7'], // Default color (overridden by ranges)
            tooltip: {
                shared: false,
                custom: function({series, seriesIndex, dataPointIndex, w}) {
                    const country = countries[dataPointIndex];
                    const remainingCapacity = series[seriesIndex][dataPointIndex];
                    const isOverAllocated = remainingCapacity < 0;

                    // Get adaptive colors for dark mode support
                    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim() || 'white';
                    const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0';
                    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333';
                    const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666';

                    let positionsHtml = '';
                    if (country.positions && country.positions.length > 0) {
                        positionsHtml = `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor};">`;
                        positionsHtml += `<div style="font-weight: 600; margin-bottom: 6px; color: ${textColor};">Current Positions:</div>`;

                        country.positions.forEach(position => {
                            positionsHtml += `
                                <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;">
                                    <span style="color: ${mutedColor};">${position.company_name}</span>
                                    <span style="color: ${textColor}; font-weight: 500;">€${Math.round(position.value).toLocaleString()}</span>
                                </div>
                            `;
                        });
                        positionsHtml += '</div>';
                    }

                    // Status row - show either remaining capacity or over-allocation
                    const statusLabel = isOverAllocated ? 'Over-allocated by:' : 'Remaining Capacity:';
                    const statusValue = Math.abs(Math.round(remainingCapacity)).toLocaleString();
                    const statusColor = isOverAllocated ? '#dc3545' : '#00c4a7';

                    return `
                        <div style="
                            background: ${bgColor};
                            border: 1px solid ${borderColor};
                            border-radius: 6px;
                            padding: 12px;
                            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            min-width: 250px;
                            max-width: 350px;
                        ">
                            <div style="font-weight: 600; margin-bottom: 8px; color: ${textColor}; font-size: 14px;">
                                ${country.country}
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: ${mutedColor};">${statusLabel}</span>
                                <span style="color: ${statusColor}; font-weight: 600;">€${statusValue}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: ${mutedColor};">Currently Invested:</span>
                                <span style="color: ${textColor}; font-weight: 500;">€${Math.round(country.current_invested).toLocaleString()}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: ${mutedColor};">Max Allowed:</span>
                                <span style="color: ${textColor}; font-weight: 500;">€${Math.round(country.max_allowed).toLocaleString()}</span>
                            </div>
                            ${positionsHtml}
                        </div>
                    `;
                }
            },
            grid: {
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0', // Adaptive border color
                strokeDashArray: 0,
                xaxis: {
                    lines: {
                        show: true
                    }
                },
                yaxis: {
                    lines: {
                        show: false
                    }
                },
                padding: {
                    top: 0,
                    right: 20,
                    bottom: 0,
                    left: 0
                }
            },
            states: {
                hover: {
                    filter: {
                        type: 'none' // Remove hover effects for lightweight performance
                    }
                }
            },
            responsive: [{
                breakpoint: 768,
                options: {
                    chart: {
                        height: Math.max(300, countries.length * 35)
                    },
                    title: {
                        style: {
                            fontSize: '14px'
                        }
                    }
                }
            }]
        };

        // Create and render the chart
        try {
            const chart = new ApexCharts(chartContainer, chartOptions);
            chart.render();
            console.log('Country capacity chart rendered successfully');
        } catch (error) {
            console.error('Error rendering country capacity chart:', error);
            showCountryCapacityError('Failed to render chart. Please refresh the page.');
        }
    }

    // Show error message in chart container
    function showCountryCapacityError(message) {
        const chartContainer = document.getElementById('country-capacity-chart');
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div class="notification is-danger">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    ${message}
                </div>
            `;
        }
    }

    // Show empty state message
    function showCountryCapacityEmpty() {
        const chartContainer = document.getElementById('country-capacity-chart');
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div class="notification is-info">
                    <i class="fas fa-info-circle mr-2"></i>
                    No country capacity data available. Please ensure you have budget settings configured in the Allocation Builder.
                </div>
            `;
        }
    }

    // Category Capacity Feature (mirrors country capacity)
    // Toggle category capacity expander
    window.toggleCategoryCapacityExpander = function() {
        const content = document.getElementById('category-capacity-content');
        const arrow = document.getElementById('category-capacity-arrow');

        categoryCapacityExpanded = !categoryCapacityExpanded;

        if (categoryCapacityExpanded) {
            content.style.display = 'block';
            arrow.classList.remove('fa-angle-down');
            arrow.classList.add('fa-angle-up');

            // Load data when expanded for the first time
            if (!categoryCapacityData) {
                fetchCategoryCapacityData();
            }
        } else {
            content.style.display = 'none';
            arrow.classList.remove('fa-angle-up');
            arrow.classList.add('fa-angle-down');
        }
    };

    // Fetch category capacity data from API
    async function fetchCategoryCapacityData() {
        try {
            const response = await fetch('/portfolio/api/allocate/category-capacity');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            categoryCapacityData = await response.json();
            console.log('Category capacity data loaded:', categoryCapacityData);
            renderCategoryCapacityChart();
        } catch (error) {
            console.error('Error fetching category capacity data:', error);
            showCategoryCapacityError('Failed to load category capacity data. Please try again later.');
        }
    }

    // Render category capacity bar chart
    function renderCategoryCapacityChart() {
        const chartContainer = document.getElementById('category-capacity-chart');

        if (!chartContainer) return;
        if (!categoryCapacityData || !categoryCapacityData.categories || categoryCapacityData.categories.length === 0) {
            showCategoryCapacityEmpty();
            return;
        }

        // Clear the loading spinner
        chartContainer.innerHTML = '';

        // Prepare data for the chart
        const categories = categoryCapacityData.categories;
        const labels = categories.map(c => c.category);
        const values = categories.map(c => c.remaining_capacity);

        // Create chart options (using shared configuration)
        const chartOptions = {
            series: [{
                name: 'Category Allocation',
                data: values
            }],
            chart: {
                type: 'bar',
                height: Math.max(350, categories.length * 45),
                toolbar: { show: false },
                background: 'transparent',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                animations: { enabled: false }
            },
            plotOptions: {
                bar: {
                    horizontal: true,
                    borderRadius: 6,
                    dataLabels: { position: 'top' },
                    colors: ALLOCATION_CHART_COLORS  // Use shared color configuration
                }
            },
            dataLabels: {
                enabled: true,
                formatter: function(val) {
                    if (val < 0) {
                        return `Over: €${Math.abs(Math.round(val)).toLocaleString()}`;
                    } else if (val > 0) {
                        return `€${Math.round(val).toLocaleString()}`;
                    } else {
                        return '€0';
                    }
                },
                offsetX: 10,
                style: {
                    fontSize: '13px',
                    fontWeight: '500',
                    colors: [getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333']
                }
            },
            xaxis: {
                categories: labels,
                title: {
                    text: 'Allocation Status (€) - Negative = Over-allocated',
                    style: {
                        fontSize: '14px',
                        fontWeight: '500',
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666'
                    }
                },
                labels: {
                    formatter: function(val) {
                        return `€${Math.round(val).toLocaleString()}`;
                    },
                    style: {
                        fontSize: '12px',
                        colors: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666'
                    }
                },
                axisBorder: {
                    show: true,
                    color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0'
                },
                axisTicks: {
                    show: true,
                    color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0'
                }
            },
            yaxis: {
                title: {
                    text: 'Categories',
                    style: {
                        fontSize: '14px',
                        fontWeight: '500',
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666666'
                    }
                },
                labels: {
                    style: {
                        fontSize: '13px',
                        fontWeight: '500',
                        colors: getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333'
                    }
                }
            },
            title: {
                text: `Category Allocation Status (Max ${categoryCapacityData.max_per_category_percent}% per category)`,
                align: 'left',
                margin: 20,
                style: {
                    fontSize: '16px',
                    fontWeight: '600',
                    color: getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333'
                }
            },
            colors: ['#00c4a7'], // Default color (overridden by ranges)
            tooltip: {
                shared: false,
                custom: function({series, seriesIndex, dataPointIndex, w}) {
                    const category = categories[dataPointIndex];
                    const remainingCapacity = series[seriesIndex][dataPointIndex];
                    const isOverAllocated = remainingCapacity < 0;

                    // Get adaptive colors for dark mode support
                    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim() || 'white';
                    const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0';
                    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333';
                    const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#666';

                    let positionsHtml = '';
                    if (category.positions && category.positions.length > 0) {
                        positionsHtml = `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor};">`;
                        positionsHtml += `<div style="font-weight: 600; margin-bottom: 6px; color: ${textColor};">Current Positions:</div>`;

                        category.positions.forEach(position => {
                            positionsHtml += `
                                <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px;">
                                    <span style="color: ${mutedColor};">${position.company_name}</span>
                                    <span style="color: ${textColor}; font-weight: 500;">€${Math.round(position.value).toLocaleString()}</span>
                                </div>
                            `;
                        });
                        positionsHtml += '</div>';
                    }

                    // Status row - show either remaining capacity or over-allocation
                    const statusLabel = isOverAllocated ? 'Over-allocated by:' : 'Remaining Capacity:';
                    const statusValue = Math.abs(Math.round(remainingCapacity)).toLocaleString();
                    const statusColor = isOverAllocated ? '#dc3545' : '#00c4a7';

                    return `
                        <div style="
                            background: ${bgColor};
                            border: 1px solid ${borderColor};
                            border-radius: 6px;
                            padding: 12px;
                            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            min-width: 250px;
                            max-width: 350px;
                        ">
                            <div style="font-weight: 600; margin-bottom: 8px; color: ${textColor}; font-size: 14px;">
                                ${category.category}
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: ${mutedColor};">${statusLabel}</span>
                                <span style="color: ${statusColor}; font-weight: 600;">€${statusValue}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: ${mutedColor};">Currently Invested:</span>
                                <span style="color: ${textColor}; font-weight: 500;">€${Math.round(category.current_invested).toLocaleString()}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="color: ${mutedColor};">Max Allowed:</span>
                                <span style="color: ${textColor}; font-weight: 500;">€${Math.round(category.max_allowed).toLocaleString()}</span>
                            </div>
                            ${positionsHtml}
                        </div>
                    `;
                }
            },
            grid: {
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#e0e0e0',
                strokeDashArray: 0,
                xaxis: {
                    lines: {
                        show: true
                    }
                },
                yaxis: {
                    lines: {
                        show: false
                    }
                },
                padding: {
                    top: 0,
                    right: 20,
                    bottom: 0,
                    left: 0
                }
            },
            states: {
                hover: {
                    filter: {
                        type: 'none'
                    }
                }
            },
            responsive: [{
                breakpoint: 768,
                options: {
                    chart: {
                        height: Math.max(300, categories.length * 35)
                    },
                    title: {
                        style: {
                            fontSize: '14px'
                        }
                    }
                }
            }]
        };

        // Create and render the chart
        try {
            const chart = new ApexCharts(chartContainer, chartOptions);
            chart.render();
            console.log('Category capacity chart rendered successfully');
        } catch (error) {
            console.error('Error rendering category capacity chart:', error);
            showCategoryCapacityError('Failed to render chart. Please refresh the page.');
        }
    }

    // Show error message in chart container
    function showCategoryCapacityError(message) {
        const chartContainer = document.getElementById('category-capacity-chart');
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div class="notification is-danger">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    ${message}
                </div>
            `;
        }
    }

    // Show empty state message
    function showCategoryCapacityEmpty() {
        const chartContainer = document.getElementById('category-capacity-chart');
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div class="notification is-info">
                    <i class="fas fa-info-circle mr-2"></i>
                    No category capacity data available. Please ensure you have budget settings configured in the Allocation Builder.
                </div>
            `;
        }
    }
});
