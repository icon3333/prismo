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
            this.rebalanceMode = 'new-only'; // 'existing-only', 'new-only', 'new-with-sells'
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

            // Add portfolio options - only show portfolios with defined target weights
            this.portfolioData.portfolios.forEach(portfolio => {
                if (portfolio.currentValue && portfolio.currentValue > 0 && portfolio.targetWeight > 0) {
                    const option = document.createElement('option');
                    option.value = portfolio.name;
                    option.textContent = portfolio.name;
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

            // Filter out portfolios with current value of 0 AND only include portfolios with defined target weights
            const filteredPortfolios = this.portfolioData.portfolios.filter(portfolio =>
                portfolio.currentValue !== 0 && portfolio.currentValue !== null &&
                portfolio.targetWeight > 0  // Only include portfolios with target allocation defined in builder
            );

            if (filteredPortfolios.length === 0) {
                this.showError('No portfolios with non-zero values available');
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

            // Generate table HTML
            const tableHTML = this.generatePortfolioTableHTML(filteredPortfolios, totalCurrentValue, newTotalValue);

            // Update the table container
            const container = document.getElementById('portfolio-table-container');
            if (container) {
                container.innerHTML = tableHTML;
            }
        }

        calculateRebalancingActions(portfolios, totalCurrentValue) {
            if (this.rebalanceMode === 'existing-only') {
                // Mode: Rebalance Existing Capital (no new money, buys must equal sells)
                portfolios.forEach(portfolio => {
                    portfolio.action = portfolio.discrepancy;
                });
            } else if (this.rebalanceMode === 'new-only') {
                // Mode: New Capital Only (no sales, only buys)
                const totalNeeded = portfolios.reduce((sum, p) => sum + Math.max(0, p.discrepancy), 0);
                const canReachAllTargets = this.investmentAmount >= totalNeeded;

                portfolios.forEach(portfolio => {
                    let action = 0;
                    if (this.investmentAmount > 0 && portfolio.discrepancy > 0) {
                        if (canReachAllTargets) {
                            action = portfolio.discrepancy;
                        } else if (totalNeeded > 0) {
                            action = (portfolio.discrepancy / totalNeeded) * this.investmentAmount;
                        }
                    }
                    portfolio.action = action;
                });
            } else if (this.rebalanceMode === 'new-with-sells') {
                // Mode: New Capital with Full Rebalancing (allows both buys and sells)
                portfolios.forEach(portfolio => {
                    portfolio.action = portfolio.discrepancy;
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
                if (positionDeficit > 0) {
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

            // Calculate the new portfolio value after action (this is the target value)
            let totalCurrentValue = portfolio.currentValue || 0;
            let portfolioTargetValue = totalCurrentValue + portfolioActionAmount;
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

            // Second pass: assign target allocations and calculate discrepancies
            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach((category, categoryIndex) => {
                    // Skip categories with no positions
                    if (!category.positions || category.positions.length === 0) return;

                    // Skip "Missing Positions" category temporarily - we'll handle it separately
                    if (category.name === 'Missing Positions') return;

                    // Calculate category metrics
                    let categoryCurrentValue = 0;
                    let categoryTargetAllocation = 0;

                    // Calculate values for each position in the category
                    category.positions.forEach(position => {
                        categoryCurrentValue += (position.currentValue || 0);

                        // Use builder weight if available, otherwise use default allocation
                        if (!position.targetAllocation || position.targetAllocation <= 0) {
                            // Check if this position has a builder-defined weight
                            const builderWeight = builderPositionsMap.get(position.name);
                            position.targetAllocation = builderWeight || defaultAllocation;
                        }

                        categoryTargetAllocation += position.targetAllocation;

                        // Calculate target value using the new portfolio target value
                        const targetValue = (position.targetAllocation / 100) * portfolioTargetValue;
                        position.calculatedTargetValue = targetValue;

                        // Calculate action directly: target - current (unified logic with global view)
                        position.action = targetValue - (position.currentValue || 0);
                        
                        // For new-only mode, clamp negative actions to zero (no sells allowed)
                        if (this.rebalanceMode === 'new-only' && position.action < 0) {
                            position.action = 0;
                        }
                        
                        position.valueAfter = (position.currentValue || 0) + position.action;
                    });

                    // Set category values
                    category.currentValue = categoryCurrentValue;
                    category.targetAllocation = categoryTargetAllocation;
                    category.calculatedTargetValue = (categoryTargetAllocation / 100) * portfolioTargetValue;
                });

                // Handle missing positions if any
                const missingPositionsCategory = portfolio.categories.find(cat =>
                    cat.name === 'Missing Positions' ||
                    cat.positions.some(pos => pos.isPlaceholder));

                // Check if real categories already have 100% allocation
                let realPositionsHave100Percent = false;
                if (portfolio.categories) {
                    const realPositionCategories = portfolio.categories.filter(cat =>
                        cat.name !== 'Missing Positions' &&
                        cat.positions &&
                        cat.positions.length > 0
                    );

                    const totalRealPositionsWeight = realPositionCategories.reduce((sum, cat) => {
                        // Sum up the targetAllocation of all positions in this category
                        const catAllocation = cat.positions.reduce((catSum, pos) => {
                            return catSum + (pos.targetAllocation || 0);
                        }, 0);
                        return sum + catAllocation;
                    }, 0);

                    // If real positions already have 100% allocation, skip missing positions
                    realPositionsHave100Percent = Math.round(totalRealPositionsWeight) >= 100;

                    // Debug logging for troubleshooting
                    if (portfolio.name === "GME" || portfolio.name.includes("GameStop") || portfolio.name.includes("Gamestop")) {
                        console.log(`DEBUG ${portfolio.name}:`, {
                            realPositionCategories,
                            totalRealPositionsWeight,
                            realPositionsHave100Percent,
                            builderPositions: portfolio.builderPositions
                        });
                    }


                }

                // Handle case - show missing positions based on builder configuration
                if (missingPositionsCategory && !realPositionsHave100Percent) {
                    // Check if portfolio has minPositions defined
                    const minPositions = portfolio.minPositions || 0;
                    const currentPositionsCount = portfolio.categories
                        .filter(cat => cat.name !== 'Missing Positions')
                        .reduce((sum, cat) => sum + (cat.positions ? cat.positions.length : 0), 0);

                    // Only show missing positions if we haven't reached minimum positions AND real positions don't sum to 100%
                    if (currentPositionsCount < minPositions && !realPositionsHave100Percent) {
                        let missingTargetAllocation = 0;
                        let missingCalculatedValue = 0;

                        // Calculate allocation for each missing position based on builder data
                        missingPositionsCategory.positions.forEach(position => {
                            // Set target allocation for each placeholder position
                            position.targetAllocation = position.targetAllocation || defaultAllocation;
                            const positionTargetValue = (position.targetAllocation / 100) * portfolioTargetValue;
                            position.calculatedTargetValue = positionTargetValue;

                            // Calculate action directly (always a buy since current value is 0)
                            position.action = positionTargetValue;
                            position.valueAfter = positionTargetValue;

                            missingTargetAllocation += position.targetAllocation;
                            missingCalculatedValue += positionTargetValue;
                        });

                        missingPositionsCategory.targetAllocation = missingTargetAllocation;
                        missingPositionsCategory.calculatedTargetValue = missingCalculatedValue;
                    } else {
                        // If we have enough positions OR real positions sum to 100%, set missing positions to 0
                        missingPositionsCategory.targetAllocation = 0;
                        missingPositionsCategory.calculatedTargetValue = 0;

                        // Clear individual position calculations too
                        missingPositionsCategory.positions.forEach(position => {
                            position.targetAllocation = 0;
                            position.calculatedTargetValue = 0;
                        });
                    }
                } else if (missingPositionsCategory) {
                    // If user-defined allocations sum to 100% or real positions have 100%, set missing positions to 0
                    missingPositionsCategory.targetAllocation = 0;
                    missingPositionsCategory.calculatedTargetValue = 0;

                    // Clear individual position calculations too
                    missingPositionsCategory.positions.forEach(position => {
                        position.targetAllocation = 0;
                        position.calculatedTargetValue = 0;
                    });
                }
            }

            // Third pass: calculate actions and render
            if (portfolio.categories && portfolio.categories.length > 0) {
                portfolio.categories.forEach((category, categoryIndex) => {
                    // Skip categories with no positions
                    if (!category.positions || category.positions.length === 0) return;

                    // Skip "Missing Positions" category temporarily
                    if (category.name === 'Missing Positions') return;

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
                    categoryRow.className = 'table-secondary category-row';
                    categoryRow.style.cursor = 'pointer';

                    // Calculate allocation after action for category
                    const categoryAllocationAfterAction = totalValueAfterAllActions > 0
                        ? (categoryValueAfter / totalValueAfterAllActions) * 100
                        : 0;

                    categoryRow.innerHTML = `
                        <td>
                            <i class="fas ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'} me-2"></i>
                            <strong>${category.name}</strong>
                        </td>
                        <td class="current-value">${this.formatCurrency(category.currentValue || 0)}</td>
                        <td>${this.formatPercentage(categoryCurrentAllocation)}</td>
                        <td>${this.formatPercentage(category.targetAllocation)}</td>
                        <td class="target-value">${this.formatCurrency(category.calculatedTargetValue)}</td>
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
                            positionRow.className = 'position-row';

                            positionRow.innerHTML = `
                                <td class="position-name">
                                    <span class="ms-4">${position.name}</span>
                                </td>
                                <td class="current-value">${this.formatCurrency(position.currentValue || 0)}</td>
                                <td>${this.formatPercentage(positionCurrentAllocation)}</td>
                                <td>${this.formatPercentage(position.targetAllocation)}</td>
                                <td class="target-value">${this.formatCurrency(position.calculatedTargetValue)}</td>
                                <td class="${actionClass}">${actionText}</td>
                                <td class="value-after">${this.formatCurrency(position.valueAfter)}</td>
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

                // Handle Missing Positions category separately
                const missingPositionsCategory = portfolio.categories.find(cat =>
                    cat.name === 'Missing Positions');

                // Skip missing positions entirely for GME portfolio
                if (portfolio.name === "GME") {
                    console.log("GME portfolio - not rendering missing positions row");
                }
                // Show missing positions with individual placeholder rows
                else if (missingPositionsCategory && missingPositionsCategory.targetAllocation > 0) {
                    // Create expandable category header for missing positions
                    const categoryId = `${portfolio.name}-Missing-Positions`;

                    // Check if category is expanded (don't force auto-expand)
                    const isExpanded = this.categoriesExpanded.has(categoryId);

                    console.log(`Missing positions category for ${portfolio.name}:`, {
                        categoryId,
                        isExpanded,
                        positionsCount: missingPositionsCategory.positions.length,
                        targetAllocation: missingPositionsCategory.targetAllocation
                    });

                    // Calculate total action for all missing positions by summing individual actions
                    let totalMissingAction = 0;
                    missingPositionsCategory.positions.forEach(position => {
                        totalMissingAction += position.action || 0;
                    });

                    // Calculate allocation after action for missing positions category
                    const missingAllocationAfterAction = totalValueAfterAllActions > 0
                        ? (totalMissingAction / totalValueAfterAllActions) * 100
                        : 0;

                    // Missing Positions category row (expandable)
                    const categoryRow = document.createElement('tr');
                    categoryRow.className = 'table-warning category-row missing-positions-category';
                    categoryRow.style.cursor = 'pointer';

                    categoryRow.innerHTML = `
                        <td>
                            <i class="fas ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'} me-2"></i>
                            <i class="fas fa-exclamation-triangle me-2 text-warning"></i>
                            <strong>Missing Positions (${missingPositionsCategory.positions.length})</strong>
                        </td>
                        <td class="current-value">${this.formatCurrency(0)}</td>
                        <td>${this.formatPercentage(0)}</td>
                        <td>${this.formatPercentage(missingPositionsCategory.targetAllocation)}</td>
                        <td class="target-value">${this.formatCurrency(missingPositionsCategory.calculatedTargetValue)}</td>
                        <td class="actions-positive">Buy ${this.formatCurrency(totalMissingAction)}</td>
                        <td class="value-after">${this.formatCurrency(totalMissingAction)}</td>
                        <td class="allocation-after">${this.formatPercentage(missingAllocationAfterAction)}</td>
                    `;

                    categoryRow.addEventListener('click', (e) => {
                        console.log(`Missing Positions category clicked: ${categoryId}`, e);
                        e.preventDefault();
                        e.stopPropagation();
                        this.toggleCategoryExpand(categoryId);
                    });

                    tbody.appendChild(categoryRow);

                    // Add individual placeholder position rows if expanded
                    if (isExpanded) {
                        console.log(`Rendering ${missingPositionsCategory.positions.length} placeholder positions for ${portfolio.name}`);
                        missingPositionsCategory.positions.forEach((position, index) => {
                            console.log(`Rendering placeholder position ${index + 1}:`, position);
                            if (position.isPlaceholder) {
                                // Use the already calculated position action
                                const positionAction = position.action || 0;

                                // Calculate allocation after action for this position
                                const positionAllocationAfterAction = totalValueAfterAllActions > 0
                                    ? (positionAction / totalValueAfterAllActions) * 100
                                    : 0;

                                // Individual placeholder position row with special styling
                                const positionRow = document.createElement('tr');
                                positionRow.className = 'position-row placeholder-position';
                                positionRow.style.fontStyle = 'italic';
                                positionRow.style.color = '#6c757d';

                                positionRow.innerHTML = `
                                    <td class="position-name">
                                        <span class="ms-4">
                                            <i class="fas fa-plus-circle me-2 text-muted"></i>
                                            ${position.name}
                                        </span>
                                    </td>
                                    <td class="current-value">${this.formatCurrency(0)}</td>
                                    <td>${this.formatPercentage(0)}</td>
                                    <td>${this.formatPercentage(position.targetAllocation)}</td>
                                    <td class="target-value">${this.formatCurrency(position.calculatedTargetValue)}</td>
                                    <td class="actions-positive">Buy ${this.formatCurrency(positionAction)}</td>
                                    <td class="value-after">${this.formatCurrency(positionAction)}</td>
                                    <td class="allocation-after">${this.formatPercentage(positionAllocationAfterAction)}</td>
                                `;

                                // Add hover tooltip
                                positionRow.title = "This represents a future position to be filled";

                                tbody.appendChild(positionRow);

                                // Add to totals
                                totalAction += positionAction;
                                totalValueAfter += positionAction;
                            }
                        });
                    } else {
                        // If category is collapsed, still add actions to totals
                        totalAction += totalMissingAction;
                        totalValueAfter += totalMissingAction;
                    }
                }
            }

            // Portfolio total row
            const totalRow = document.createElement('tr');
            totalRow.className = 'table-primary fw-bold';

            totalRow.innerHTML = `
                <td>Portfolio Total</td>
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

    // Country Capacity Feature
    let countryCapacityExpanded = false;
    let countryCapacityData = null;

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
                name: 'Remaining Capacity',
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
                    colors: {
                        ranges: [{
                            from: 0,
                            to: 0,
                            color: '#e0e0e0' // Muted color for zero values
                        }]
                    }
                }
            },
            dataLabels: {
                enabled: true,
                formatter: function(val) {
                    return val > 0 ? `€${Math.round(val).toLocaleString()}` : '€0';
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
                    text: 'Remaining Investment Capacity (€)',
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
                text: `Country Investment Capacity (Max ${countryCapacityData.max_per_country_percent}% per country)`,
                align: 'left',
                margin: 20,
                style: {
                    fontSize: '16px',
                    fontWeight: '600',
                    color: getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#333333' // Adaptive text color
                }
            },
            colors: ['#00c4a7'], // Use app primary color
            tooltip: {
                shared: false,
                custom: function({series, seriesIndex, dataPointIndex, w}) {
                    const country = countries[dataPointIndex];
                    const remainingCapacity = series[seriesIndex][dataPointIndex];
                    
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
                                <span style="color: ${mutedColor};">Remaining Capacity:</span>
                                <span style="color: #00c4a7; font-weight: 600;">€${Math.round(remainingCapacity).toLocaleString()}</span>
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
});
