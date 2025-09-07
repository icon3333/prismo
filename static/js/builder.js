// Allocation Builder JavaScript - Improved Version with Position Selection
document.addEventListener('DOMContentLoaded', function () {
  // Auto-save debounce function
  function debounce(func, wait = 300) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Create Vue application
  new Vue({
    el: '#allocation-builder',
    delimiters: ['${', '}'],  // Changed from default {{ }} to avoid collision with Jinja2
    data: {
      budgetData: {
        totalNetWorth: 0,
        alreadyInvested: 0,
        emergencyFund: 0,
        availableToInvest: 0,
        totalInvestableCapital: 0
      },
      // Track editing state for number inputs
      editingFields: {
        totalNetWorth: false,
        alreadyInvested: false,
        emergencyFund: false
      },
      rules: {
        maxPerStock: 5,
        maxPerCategory: 25,
        maxPerCountry: 10
      },
      portfolios: [],
      availablePortfolios: [],
      portfolioCompanies: {},
      loadingState: false,
      autoSaveIndicator: false,
      sortOptions: {
        column: 'weight',
        direction: 'desc'
      },
      expandedPortfolios: {},
      expandedAllocations: {},
      isEditingWeight: false,
      portfolioMetrics: {
        total_value: 0,
        total_items: 0,
        health: 100,
        missing_prices: 0,
        last_update: null
      }
    },
    computed: {
      isAllocationValid() {
        const total = this.calculateTotalAllocation();
        return total === 100;
      },
      isAllocationUnder() {
        const total = this.calculateTotalAllocation();
        return total < 100;
      },
      isAllocationOver() {
        const total = this.calculateTotalAllocation();
        return total > 100;
      },
      allocationStatusMessage() {
        const total = this.calculateTotalAllocation();
        return `Total allocation: ${this.formatPercentage(total)}`;
      },
      allocationStatusClass() {
        const total = this.calculateTotalAllocation();
        if (total < 100) {
          return 'has-text-warning';
        } else if (total > 100) {
          return 'has-text-danger';
        } else {
          return 'has-text-mint';
        }
      },
      // Calculate available percentage
      availablePercentage() {
        if (!this.budgetData.totalInvestableCapital) return "0.00";
        return (this.budgetData.availableToInvest / this.budgetData.totalInvestableCapital * 100).toFixed(2);
      }
    },
    mounted() {
      this.loadInitialData();
    },
    methods: {
      // Initial data loading
      async loadInitialData() {
        try {
          this.loadingState = true;

          // Load available portfolios
          await this.loadAvailablePortfolios();
          console.log("Available portfolios loaded:", this.availablePortfolios);

          // Load portfolio metrics
          await this.loadPortfolioMetrics();
          console.log("Portfolio metrics loaded:", this.portfolioMetrics);

          // Load saved state if available
          await this.loadSavedState();

          // If no portfolios were loaded from saved state, initialize them from available portfolios
          if (!this.portfolios || this.portfolios.length === 0) {
            console.log("No portfolios in saved state, initializing from available portfolios");
            this.portfolios = [];

            // For each available portfolio, add it and load its companies
            for (const portfolio of this.availablePortfolios) {
              console.log("Processing portfolio:", portfolio);
              if (portfolio.id) {
                try {
                  // Add this portfolio with default allocation
                  this.portfolios.push({
                    id: portfolio.id,
                    name: portfolio.name,
                    allocation: 0,
                    positions: [], // Start with empty positions - don't auto-create any for companies
                    selectedPosition: "", // Initialize the selectedPosition property
                    evenSplit: false // Initialize evenSplit property - default to manual allocation
                  });
                  console.log(`Added portfolio ${portfolio.name} (ID: ${portfolio.id}) to this.portfolios`);

                  // Load companies for this portfolio (for dropdown only, not creating positions)
                  console.log(`Fetching companies for portfolio ${portfolio.name} (ID: ${portfolio.id})...`);
                  const response = await axios.get(`/portfolio/api/portfolio_companies/${portfolio.id}`);
                  console.log(`Received company data for portfolio ${portfolio.name}:`, response.data);

                  if (response.data && Array.isArray(response.data)) {
                    // Store companies in portfolioCompanies (for dropdown selection only)
                    Vue.set(this.portfolioCompanies, portfolio.id, response.data);
                    console.log(`Stored ${response.data.length} companies for portfolio ${portfolio.name} (for dropdown only)`);
                  } else {
                    // Initialize with empty array if no companies
                    Vue.set(this.portfolioCompanies, portfolio.id, []);
                    console.log(`No companies found for portfolio ${portfolio.name}, initialized with empty array`);
                  }
                } catch (error) {
                  console.error(`Error loading companies for portfolio ${portfolio.id}:`, error);
                  // Initialize with empty array on error
                  Vue.set(this.portfolioCompanies, portfolio.id, []);
                }
              }
            }
            console.log("Final portfolios list:", this.portfolios);
            console.log("Final portfolioCompanies:", this.portfolioCompanies);

            // Set default allocations
            if (this.portfolios.length > 0) {
              const evenAllocation = (100 / this.portfolios.length).toFixed(2);
              this.portfolios.forEach(p => {
                p.allocation = parseFloat(evenAllocation);
              });
            }

            // Initialize remaining properties for each portfolio
            for (const portfolio of this.portfolios) {
              // Calculate minimum positions needed
              this.calculateMinimumPositions(portfolio);
              // Set current positions from loaded companies
              portfolio.currentPositions = this.portfolioCompanies[portfolio.id]?.length || 0;
              // Add placeholder positions if needed
              this.ensureMinimumPositions(portfolio);
            }
          }

          // Ensure each portfolio has the selectedPosition property
          this.portfolios.forEach(portfolio => {
            if (!portfolio.hasOwnProperty('selectedPosition')) {
              Vue.set(portfolio, 'selectedPosition', "");
            }
          });

          // Calculate available to invest
          this.calculateAvailableToInvest();

          // Calculate total investable capital
          this.calculateTotalInvestableCapital();

          this.loadingState = false;
        } catch (error) {
          console.error('Error loading initial data:', error);
          portfolioManager.showNotification('Failed to load initial data. Please refresh the page.', 'is-danger');
          this.loadingState = false;
        }
      },

      // Load saved state from the server
      async loadSavedState() {
        try {
          const response = await axios.get('/portfolio/api/state?page=build');
          console.log('Loaded saved state:', response.data);

          if (response.data && response.data.budgetData) {
            this.budgetData = JSON.parse(response.data.budgetData);
            // Ensure we have all required properties
            if (!this.budgetData.hasOwnProperty('totalNetWorth')) {
              this.budgetData.totalNetWorth =
                (parseFloat(this.budgetData.totalInvestableCapital) || 0) +
                (parseFloat(this.budgetData.emergencyFund) || 0);
            }

            // Recalculate totalInvestableCapital and availableToInvest to ensure consistency
            this.calculateTotalInvestableCapital();
            this.calculateAvailableToInvest();
          }

          if (response.data && response.data.rules) {
            this.rules = JSON.parse(response.data.rules);
            // Ensure all new rule fields have default values for backward compatibility
            if (!this.rules.hasOwnProperty('maxPerCountry')) {
              this.rules.maxPerCountry = 10;
            }
          }

          // Create a map of available portfolio IDs and names
          const availablePortfolioMap = {};
          this.availablePortfolios.forEach(p => {
            if (p.id) {
              availablePortfolioMap[p.id] = p.name;
            }
          });
          console.log('Available portfolio map:', availablePortfolioMap);

          // Temporary array to store portfolios from saved state
          let savedPortfolios = [];
          let savedPortfolioIds = new Set();

          if (response.data && response.data.portfolios) {
            savedPortfolios = JSON.parse(response.data.portfolios);

            // Filter out portfolios without an ID
            savedPortfolios = savedPortfolios.filter(p => p.id);

            // Track which portfolio IDs we have from saved state
            savedPortfolioIds = new Set(savedPortfolios.map(p => p.id));
            console.log('Saved portfolio IDs:', Array.from(savedPortfolioIds));
          }

          // Initialize this.portfolios with saved portfolios
          this.portfolios = savedPortfolios;

          // Add any missing portfolios from availablePortfolios
          for (const portfolio of this.availablePortfolios) {
            if (portfolio.id && !savedPortfolioIds.has(portfolio.id)) {
              console.log(`Adding missing portfolio to state: ${portfolio.name} (ID: ${portfolio.id})`);
              this.portfolios.push({
                id: portfolio.id,
                name: portfolio.name,
                allocation: 0,
                positions: [],
                selectedPosition: "", // Initialize selectedPosition
                evenSplit: false // Default to manual allocation
              });
            }
          }

          console.log('Final portfolio list after merging saved state:', this.portfolios);

          // Load companies for each portfolio (for dropdown only) and ensure placeholder positions exist
          const portfoliosWithCompanies = [];
          for (const portfolio of this.portfolios) {
            if (portfolio.id) {
              // Initialize positions array if missing, but keep any existing positions
              // from previously saved state to preserve user selections
              if (!portfolio.positions) {
                portfolio.positions = [];
              }

              // Add selectedPosition if missing
              if (!portfolio.hasOwnProperty('selectedPosition')) {
                Vue.set(portfolio, 'selectedPosition', "");
              }

              // Load companies for dropdown selection only, don't auto-create positions
              await this.loadPortfolioCompanies(portfolio.id);

              // Only keep portfolios that have companies
              if (this.portfolioCompanies[portfolio.id] && this.portfolioCompanies[portfolio.id].length > 0) {
                portfoliosWithCompanies.push(portfolio);
                // Set current positions from loaded companies
                portfolio.currentPositions = this.portfolioCompanies[portfolio.id]?.length || 0;
                // Calculate minimum positions needed
                this.calculateMinimumPositions(portfolio);
                // Add placeholder positions if needed - this will not create actual company positions
                this.ensureMinimumPositions(portfolio);
              } else {
                console.log(`Skipping portfolio ${portfolio.name} (ID: ${portfolio.id}) because it has no companies`);
              }
            }
          }

          // Replace the portfolios array with only those that have companies
          this.portfolios = portfoliosWithCompanies;
          console.log('Final filtered portfolio list (only with companies):', this.portfolios);

          // Force recalculation of all placeholder weights
          this.portfolios.forEach((portfolio, portfolioIndex) => {
            this.updatePlaceholderWeight(portfolioIndex);
            console.log(`Recalculated placeholder weight for portfolio ${portfolio.name} (index: ${portfolioIndex})`);
          });

          if (response.data && response.data.expandedPortfolios) {
            this.expandedPortfolios = JSON.parse(response.data.expandedPortfolios);
          }

          if (response.data && response.data.expandedAllocations) {
            this.expandedAllocations = JSON.parse(response.data.expandedAllocations);
          }

          if (response.data && response.data.sortOptions) {
            this.sortOptions = JSON.parse(response.data.sortOptions);
          }
        } catch (error) {
          console.error('Error loading saved state:', error);
          // If error loading saved state, start with default values
        }
      },

      // Load available portfolios
      async loadAvailablePortfolios() {
        try {
          // Add has_companies=true to only get portfolios that have companies with shares
          const response = await axios.get('/portfolio/api/portfolios?include_ids=true&has_companies=true');
          this.availablePortfolios = response.data;
          console.log('Loaded portfolios with companies:', this.availablePortfolios);

          // Note: We don't auto-create positions for these portfolios
          // Positions will only be added when the user explicitly selects them from the dropdown
        } catch (error) {
          console.error('Error loading portfolios:', error);
          portfolioManager.showNotification('Failed to load portfolios', 'is-danger');
        }
      },

      // Load portfolio metrics
      async loadPortfolioMetrics() {
        try {
          const response = await axios.get('/portfolio/api/portfolio_metrics');
          this.portfolioMetrics = response.data;
          console.log('Loaded portfolio metrics:', this.portfolioMetrics);
        } catch (error) {
          console.error('Error loading portfolio metrics:', error);
          portfolioManager.showNotification('Failed to load portfolio metrics', 'is-danger');
        }
      },

      // Load companies for a specific portfolio
      async loadPortfolioCompanies(portfolioId) {
        try {
          const response = await axios.get(`/portfolio/api/portfolio_companies/${portfolioId}`);
          const companies = response.data;
          console.log(`Loaded ${companies.length} companies for portfolio ${portfolioId}:`, companies);

          // Store in portfolioCompanies map (for dropdown only)
          Vue.set(this.portfolioCompanies, portfolioId, companies);

          // Do NOT automatically create positions for companies
          // This keeps the positions array empty until user explicitly adds companies

          // Find the portfolio in our portfolios array to ensure minimum positions (placeholders)
          const portfolioIndex = this.portfolios.findIndex(p => p.id === portfolioId);
          if (portfolioIndex !== -1) {
            const portfolio = this.portfolios[portfolioIndex];

            // Ensure placeholders are shown if needed
            this.ensureMinimumPositions(portfolio);
          }
        } catch (error) {
          console.error(`Error loading companies for portfolio ${portfolioId}:`, error);
          portfolioManager.showNotification(`Failed to load companies for portfolio`, 'is-danger');
        }
      },

      // Budget calculations
      calculateAvailableToInvest() {
        const totalInvestableCapital = parseFloat(this.budgetData.totalInvestableCapital) || 0;
        const alreadyInvested = parseFloat(this.budgetData.alreadyInvested) || 0;

        this.budgetData.availableToInvest = Math.max(0, totalInvestableCapital - alreadyInvested);
      },

      calculateTotalInvestableCapital() {
        const totalNetWorth = parseFloat(this.budgetData.totalNetWorth) || 0;
        const emergencyFund = parseFloat(this.budgetData.emergencyFund) || 0;

        // Total Investable Capital is now derived from Total Net Worth minus Emergency Fund
        this.budgetData.totalInvestableCapital = Math.max(0, totalNetWorth - emergencyFund);
      },

      updateBudgetData() {
        // Ensure numeric values
        this.budgetData.totalNetWorth = this.parseNumericValue(this.budgetData.totalNetWorth);
        this.budgetData.alreadyInvested = this.parseNumericValue(this.budgetData.alreadyInvested);
        this.budgetData.emergencyFund = this.parseNumericValue(this.budgetData.emergencyFund);

        // First calculate Total Investable Capital from Total Net Worth and Emergency Fund
        this.calculateTotalInvestableCapital();

        // Then calculate Available to Invest
        this.calculateAvailableToInvest();

        // Trigger auto-save
        this.debouncedSave();
      },

      // Parse numeric value from input (handles commas and invalid input)
      parseNumericValue(value) {
        if (value === null || value === undefined || value === '') {
          return 0;
        }

        // If it's already a number, return it
        if (typeof value === 'number') {
          return isNaN(value) ? 0 : value;
        }

        // If it's a string, remove commas and parse
        const cleanValue = String(value).replace(/,/g, '');
        const parsed = parseFloat(cleanValue);
        return isNaN(parsed) ? 0 : parsed;
      },

      // Handle input focus (start editing)
      handleInputFocus(fieldName) {
        this.editingFields[fieldName] = true;
      },

      // Handle input blur (stop editing)
      handleInputBlur(fieldName) {
        this.editingFields[fieldName] = false;
        this.updateBudgetData();
      },

      // Get display value for input (formatted when not editing, raw when editing)
      getInputDisplayValue(fieldName) {
        const value = this.budgetData[fieldName];
        if (this.editingFields[fieldName]) {
          // When editing, show raw number without formatting
          if (value === 0 || value === null || value === undefined) return '';
          return String(value);
        } else {
          // When not editing, show formatted number
          if (value === 0 || value === null || value === undefined) return '';
          return this.formatNumber(value);
        }
      },

      // Handle clicking on total portfolio value to populate "Already Invested"
      populateAlreadyInvested() {
        // Round the value the same way it's displayed (consistent with formatCurrency)
        const roundedValue = this.portfolioMetrics.total_value >= 100
          ? Math.round(this.portfolioMetrics.total_value)
          : Math.round(this.portfolioMetrics.total_value * 100) / 100;

        this.budgetData.alreadyInvested = roundedValue;
        this.updateBudgetData();
        // Flash the input field to show it was updated
        const inputField = document.getElementById('alreadyInvested');
        if (inputField) {
          inputField.focus();
          inputField.select();
        }
      },

      // Portfolio management
      togglePortfolioExpand(index) {
        const portfolioId = this.portfolios[index].id;
        if (!this.expandedPortfolios[portfolioId]) {
          Vue.set(this.expandedPortfolios, portfolioId, true);
        } else {
          Vue.set(this.expandedPortfolios, portfolioId, !this.expandedPortfolios[portfolioId]);
        }
        // Save expanded state
        this.debouncedSave();
      },

      isPortfolioExpanded(index) {
        const portfolioId = this.portfolios[index].id;
        return this.expandedPortfolios[portfolioId] === true;
      },

      // Calculate minimum positions needed
      calculateMinimumPositions(portfolio) {
        // Get portfolio percentage of total account
        const portfolioPercentage = portfolio.allocation;

        // Get maximum percent per stock
        const maxPerStock = this.rules.maxPerStock;

        // Calculate minimum positions needed: Z = X% ÷ Y%
        // Always round up to ensure we have enough positions
        let minPositions = Math.ceil(portfolioPercentage / maxPerStock);

        // Ensure at least 1 position
        minPositions = Math.max(1, minPositions);

        // Update portfolio
        portfolio.minPositions = minPositions;

        return minPositions;
      },

      // Ensure portfolio has minimum number of positions
      ensureMinimumPositions(portfolio) {
        if (!portfolio.positions) {
          portfolio.positions = [];
        }

        // Calculate min positions if not already set
        if (!portfolio.minPositions) {
          this.calculateMinimumPositions(portfolio);
        }

        // Use the calculated minimum positions (already rounded up in calculateMinimumPositions)
        const minPositions = portfolio.minPositions;

        // First, filter out all placeholder positions to avoid duplicates
        portfolio.positions = portfolio.positions.filter(p => !p.isPlaceholder);

        // Get all real (non-placeholder) positions
        const realPositions = portfolio.positions;
        const realPositionCount = realPositions.length;

        // Calculate total weight of real positions
        const realPositionsWeight = realPositions.reduce((total, position) => {
          return total + parseFloat(position.weight || 0);
        }, 0);

        // Calculate actual number of positions remaining
        // Use current positions for this specific portfolio minus already allocated positions in builder
        const positionsRemaining = Math.max(0, (portfolio.currentPositions || 0) - realPositionCount);
        
        // If real positions sum to 100% OR there are no more positions to allocate, we don't need placeholders
        if (realPositionsWeight >= 100 || positionsRemaining <= 0) {
          return;
        }

        // Add a placeholder position that represents ALL remaining positions
        // The companyName shows total remaining for user information
        // Calculate weight based on real positions for immediate display

        // Calculate total remaining weight and per-position weight
        const totalRemainingWeight = Math.max(0, parseFloat((100 - realPositionsWeight).toFixed(2)));
        const weightPerPosition = parseFloat((totalRemainingWeight / positionsRemaining).toFixed(2));

        portfolio.positions.push({
          companyId: null,
          companyName: `${positionsRemaining}x positions remaining`,
          weight: weightPerPosition, // Apply the PER POSITION weight
          isPlaceholder: true,
          isSinglePosition: false, // Changed to false since this now represents multiple positions
          minPositions: minPositions, // Store the minPositions for allocation calculation
          positionsRemaining: positionsRemaining, // Store number of positions this placeholder represents
          totalRemainingWeight: totalRemainingWeight // Store the total remaining weight for calculations
        });

        // Apply consistent weight calculation to ensure this portfolio has correct weights
        // Note: We need to find the index of this portfolio in the portfolios array
        const portfolioIndex = this.portfolios.findIndex(p => p === portfolio);
        if (portfolioIndex !== -1 && portfolio.evenSplit) {
          this.applyConsistentWeightCalculation();
        }
      },

      // Get available companies for a portfolio (not already added as positions)
      availableCompaniesForPortfolio(portfolioId) {
        // Get all companies for this portfolio
        const companies = this.portfolioCompanies[portfolioId] || [];

        // Get company IDs already in positions
        const portfolio = this.portfolios.find(p => p.id === portfolioId);
        if (!portfolio) return [];

        const existingCompanyIds = new Set(
          portfolio.positions
            .filter(p => !p.isPlaceholder)
            .map(p => p.companyId)
        );

        // Return companies not already in positions
        return companies.filter(company => !existingCompanyIds.has(company.id));
      },

      // Add selected position to portfolio
      addSelectedPosition(portfolioIndex) {
        const portfolio = this.portfolios[portfolioIndex];
        const companyId = portfolio.selectedPosition;

        if (!companyId) return; // No position selected

        // Find company details
        const company = this.portfolioCompanies[portfolio.id].find(c => c.id === companyId);
        if (!company) return;

        // Calculate initial weight based on available positions
        let initialWeight = 0;
        if (portfolio.evenSplit) {
          // Count real positions (will be +1 after adding this one)
          const realPositionsCount = portfolio.positions.filter(p => !p.isPlaceholder).length + 1;
          initialWeight = 100 / realPositionsCount;
        } else {
          // Start with a reasonable weight for manual adjustment (20% or remaining amount, whichever is smaller)
          const currentRealPositions = portfolio.positions.filter(p => !p.isPlaceholder);
          const usedWeight = currentRealPositions.reduce((total, pos) => total + (pos.weight || 0), 0);
          const remainingWeight = 100 - usedWeight;
          initialWeight = Math.min(20, Math.max(0, remainingWeight));
        }

        // Add new position
        portfolio.positions.push({
          companyId: company.id,
          companyName: company.name,
          weight: initialWeight,
          isPlaceholder: false
        });

        // Clear selection
        portfolio.selectedPosition = "";

        // Recalculate weights if using even split
        if (portfolio.evenSplit) {
          this.updatePositionAllocations(portfolioIndex);
        }

        // Recalculate minimum positions
        this.calculateMinimumPositions(portfolio);

        // Ensure minimum positions (updates placeholder)
        this.ensureMinimumPositions(portfolio);

        // Update the placeholder weight to reflect the remaining percentage
        this.updatePlaceholderWeight(portfolioIndex);

        // Save changes
        this.debouncedSave();
      },

      // Remove a position
      removePosition(portfolioIndex, positionIndex) {
        const portfolio = this.portfolios[portfolioIndex];

        // Only remove if not a placeholder
        if (!portfolio.positions[positionIndex].isPlaceholder) {
          // Remove the position
          portfolio.positions.splice(positionIndex, 1);

          // Recalculate weights if using even split
          if (portfolio.evenSplit) {
            this.updatePositionAllocations(portfolioIndex);
          }

          // Recalculate minimum positions
          this.calculateMinimumPositions(portfolio);

          // Ensure minimum positions (updates placeholder)
          this.ensureMinimumPositions(portfolio);

          // Update the placeholder weight to reflect the remaining percentage
          this.updatePlaceholderWeight(portfolioIndex);

          // Save changes
          this.debouncedSave();
        }
      },

      // Get the number of remaining positions needed
      getRemainingPositionsCount(portfolioIndex) {
        const portfolio = this.portfolios[portfolioIndex];
        const realPositions = portfolio.positions.filter(p => !p.isPlaceholder);
        const realPositionsCount = realPositions.length;

        // Calculate total weight of real positions
        const realPositionsWeight = realPositions.reduce((total, position) => {
          return total + parseFloat(position.weight || 0);
        }, 0);

        // If real positions sum to 100%, return 0 remaining positions needed
        if (realPositionsWeight >= 100) {
          return 0;
        }

        // Use current positions for this specific portfolio minus already allocated positions in builder
        return Math.max(0, (portfolio.currentPositions || 0) - realPositionsCount);
      },

      // Get remaining weight percentage for manual allocation
      getRemainingWeight(portfolioIndex) {
        const portfolio = this.portfolios[portfolioIndex];
        if (!portfolio.positions) return 100;
        
        const realPositions = portfolio.positions.filter(p => !p.isPlaceholder);
        const usedWeight = realPositions.reduce((total, pos) => total + (pos.weight || 0), 0);
        return Math.max(0, 100 - usedWeight);
      },


      // Update position details when company is selected
      updatePositionDetails(portfolioIndex, positionIndex) {
        const portfolio = this.portfolios[portfolioIndex];
        const position = portfolio.positions[positionIndex];
        const companyId = position.companyId;

        if (companyId) {
          const company = this.portfolioCompanies[portfolio.id].find(c => c.id === companyId);
          if (company) {
            position.companyName = company.name;
          }
        }

        // Auto-save
        this.debouncedSave();
      },

      // Update position allocations when weights change - only handles even split case
      updatePositionAllocations(portfolioIndex) {
        const portfolio = this.portfolios[portfolioIndex];

        // If there are no positions, nothing to update
        if (portfolio.positions.length === 0) {
          return;
        }

        // Only handle even split - this is an explicit user choice
        if (portfolio.evenSplit) {
          const realPositions = portfolio.positions.filter(p => !p.isPlaceholder);
          const count = realPositions.length;

          if (count > 0) {
            // Calculate weight based on minimum positions, not just real positions count
            const minPositions = portfolio.minPositions || count;
            const evenWeight = parseFloat((100 / minPositions).toFixed(2));

            // Set even weight for all valid positions
            realPositions.forEach(position => {
              position.weight = evenWeight;
            });

            // Instead of manually handling placeholder positions here,
            // use the updatePlaceholderWeight method which will correctly
            // set the placeholder weight to (100% - existing positions weight)
            this.updatePlaceholderWeight(portfolioIndex);
          }
        }

        // Auto-save
        this.debouncedSave();
      },

      // Apply consistent weight calculation across all portfolios - simplified for even split only
      applyConsistentWeightCalculation() {
        // Apply to each portfolio - only used for even split which is an explicit user choice
        this.portfolios.forEach((portfolio, portfolioIndex) => {
          if (!portfolio.evenSplit || !portfolio.positions || portfolio.positions.length === 0) {
            return; // Skip if not in even split mode or no positions
          }

          // Get real positions (non-placeholder)
          const realPositions = portfolio.positions.filter(p => !p.isPlaceholder);
          const realPositionCount = realPositions.length;

          if (realPositionCount > 0) {
            // Calculate weight based on minimum positions, not real positions
            // This ensures proper distribution of weight: 100% / minPositions 
            const minPositions = portfolio.minPositions || realPositionCount;
            const evenWeight = parseFloat((100 / minPositions).toFixed(2));

            // Set weight for all real positions
            realPositions.forEach(position => {
              position.weight = evenWeight;
            });

            // Instead of manually handling placeholder positions here,
            // use the updatePlaceholderWeight method which will correctly
            // set the placeholder weight to (100% - existing positions weight)
            this.updatePlaceholderWeight(portfolioIndex);
          }
        });

        // Auto-save
        this.debouncedSave();
      },

      // Recalculate weights for even distribution - delegate to applyConsistentWeightCalculation
      recalculateEvenWeights(portfolioIndex) {
        this.applyConsistentWeightCalculation();
      },

      // Handle manual weight input - simplified with no automation
      updateManualWeight(portfolioIndex, positionIndex, value) {
        // Set editing flag to prevent immediate sorting
        this.isEditingWeight = true;

        // Parse the input value, removing any % sign if present
        let numValue = parseFloat(value.replace('%', ''));

        if (!isNaN(numValue)) {
          const portfolio = this.portfolios[portfolioIndex];

          // Store exact user input without any adjustments
          portfolio.positions[positionIndex].weight = numValue;

          // Update the placeholder weight to reflect the remaining percentage
          this.updatePlaceholderWeight(portfolioIndex);

          // Save the changes
          this.debouncedSave();
        }

        // Reset editing flag after a delay
        setTimeout(() => {
          this.isEditingWeight = false;
        }, 1000);
      },

      // Update the placeholder weight based on real positions' weights
      updatePlaceholderWeight(portfolioIndex) {
        const portfolio = this.portfolios[portfolioIndex];

        // Find real positions and placeholder
        const realPositions = portfolio.positions.filter(p => !p.isPlaceholder);
        const placeholder = portfolio.positions.find(p => p.isPlaceholder);

        console.log('Updating placeholder weight:', {
          portfolioIndex,
          placeholder,
          realPositions,
          positionsRemaining: placeholder ? placeholder.positionsRemaining : 0
        });

        if (placeholder) {
          // Calculate total weight of real positions
          const realPositionsWeight = realPositions.reduce((total, position) => {
            return total + parseFloat(position.weight || 0);
          }, 0);

          // If real positions already sum to 100%, set placeholder weight to 0
          if (realPositionsWeight >= 100) {
            placeholder.weight = 0;
            placeholder.totalRemainingWeight = 0;
            console.log('Set placeholder weight to 0 (real positions sum to 100%)');
            return;
          }

          // Only continue if we have positions remaining
          if (placeholder.positionsRemaining > 0) {
            // Calculate total remaining weight (100% - already allocated weight)
            // Never allow negative weight
            const totalRemainingWeight = Math.max(0, parseFloat((100 - realPositionsWeight).toFixed(2)));

            // Calculate weight per remaining position
            const weightPerPosition = parseFloat((totalRemainingWeight / placeholder.positionsRemaining).toFixed(2));

            console.log('Weight calculation:', {
              realPositionsWeight,
              totalRemainingWeight,
              weightPerPosition,
              positionsRemaining: placeholder.positionsRemaining
            });

            // Update the placeholder weight to show weight PER POSITION (not total remaining)
            placeholder.weight = weightPerPosition;

            // Store the total remaining weight for calculations
            placeholder.totalRemainingWeight = totalRemainingWeight;

            console.log('Updated placeholder weight to:', placeholder.weight);
          } else {
            // If no positions remaining, set weight to 0
            placeholder.weight = 0;
            placeholder.totalRemainingWeight = 0;
            console.log('Set placeholder weight to 0 (no positions remaining)');
          }
        }
      },

      // Check if position weight exceeds maximum
      isWeightExceeded(portfolioIndex, positionIndex) {
        const portfolio = this.portfolios[portfolioIndex];
        const position = portfolio.positions[positionIndex];

        // Calculate maximum allowed weight
        const maxWeight = 100 / Math.max(1, Math.ceil(portfolio.minPositions));

        return position.weight > maxWeight;
      },

      // Update portfolio allocations - simplified to just save changes
      updateAllocations() {
        // Only save changes, no adjustments at all
        this.debouncedSave();
      },

      // Calculate total weight for a portfolio
      calculateTotalWeight(portfolioIndex) {
        const portfolio = this.portfolios[portfolioIndex];

        // If no positions, return 0
        if (!portfolio.positions || portfolio.positions.length === 0) {
          return 0;
        }

        // If we have any real positions, the total should be 100%
        const realPositions = portfolio.positions.filter(p => !p.isPlaceholder);
        if (realPositions.length > 0) {
          return 100;
        }

        // If only placeholder positions, return their weights
        return portfolio.positions.reduce((total, position) => total + parseFloat(position.weight || 0), 0);
      },

      // Calculate total allocation percentage
      calculateTotalAllocation() {
        return this.portfolios.reduce((total, portfolio) => total + parseFloat(portfolio.allocation || 0), 0);
      },

      // Calculate allocation amount based on percentage
      calculateAllocationAmount(allocationPercentage) {
        const totalInvestableCapital = parseFloat(this.budgetData.totalInvestableCapital) || 0;
        return totalInvestableCapital * (parseFloat(allocationPercentage) / 100);
      },

      // Calculate position amount
      calculatePositionAmount(portfolioIndex, positionIndex) {
        const portfolio = this.portfolios[portfolioIndex];
        const position = portfolio.positions[positionIndex];
        const portfolioAmount = this.calculateAllocationAmount(portfolio.allocation);

        // For placeholder positions, we need to handle it differently since weight now represents per-position weight
        if (position.isPlaceholder && position.positionsRemaining) {
          if (position.totalRemainingWeight !== undefined) {
            // Use the total remaining weight (stored during updatePlaceholderWeight) 
            // to calculate the total amount for all remaining positions
            return portfolioAmount * (parseFloat(position.totalRemainingWeight || 0) / 100);
          } else {
            // Fallback - multiply the per-position weight by number of positions remaining
            const totalWeight = parseFloat(position.weight || 0) * position.positionsRemaining;
            return portfolioAmount * (totalWeight / 100);
          }
        } else {
          // For regular positions, use the weight percentage as normal
          return portfolioAmount * (parseFloat(position.weight || 0) / 100);
        }
      },

      // Calculate total allocated amount
      calculateTotalAllocatedAmount() {
        const totalInvestableCapital = parseFloat(this.budgetData.totalInvestableCapital) || 0;
        const totalAllocationPercentage = this.calculateTotalAllocation() / 100;

        return totalInvestableCapital * totalAllocationPercentage;
      },

      // Calculate unallocated amount
      calculateUnallocatedAmount() {
        const totalInvestableCapital = parseFloat(this.budgetData.totalInvestableCapital) || 0;
        const allocatedAmount = this.calculateTotalAllocatedAmount();

        return totalInvestableCapital - allocatedAmount;
      },

      // Calculate total number of positions
      calculateTotalPositions() {
        return this.portfolios.reduce((total, portfolio) => {
          return total + this.getTotalPositionsForPortfolio(portfolio);
        }, 0);
      },

      // Calculate total positions for a specific portfolio (including remaining positions)
      getTotalPositionsForPortfolio(portfolio) {
        // Count real positions
        const realPositions = portfolio.positions.filter(p => !p.isPlaceholder).length;

        // Add remaining positions from placeholders
        const placeholder = portfolio.positions.find(p => p.isPlaceholder);
        const remainingPositions = placeholder ? placeholder.positionsRemaining : 0;

        return realPositions + remainingPositions;
      },

      // Get portfolio name by ID
      getPortfolioName(portfolioId) {
        if (!portfolioId) return 'Unselected Portfolio';

        const portfolio = this.availablePortfolios.find(p => p.id === portfolioId);
        return portfolio ? portfolio.name : 'Unknown Portfolio';
      },

      // Format currency using utility function
      formatCurrency(amount) {
        return portfolioManager.formatCurrency(amount);
      },

      // Format number with thousand separators
      formatNumber(value) {
        if (value === null || value === undefined || value === 0 || value === '') return '';
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue === 0) return '';
        return numValue.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
      },

      // Format percentage without decimal places
      formatPercentage(value) {
        if (value === null || value === undefined) return '0%';
        return `${Math.round(parseFloat(value))}%`;
      },

      // Sort table by column
      sortBy(column) {
        // Don't change sort immediately when editing weights
        if (this.isEditingWeight) {
          return;
        }

        if (this.sortOptions.column === column) {
          // Toggle direction if same column clicked
          this.sortOptions.direction = this.sortOptions.direction === 'asc' ? 'desc' : 'asc';
        } else {
          // Set new column with default direction
          this.sortOptions.column = column;
          this.sortOptions.direction = column === 'name' ? 'asc' : 'desc';
        }

        // Save sort preference
        this.debouncedSave();
      },

      // Sort positions by selected column
      sortedPositions(positions) {
        if (!positions || positions.length === 0) return [];

        // Separate placeholder positions from real positions
        const placeholders = positions.filter(p => p.isPlaceholder);
        const realPositions = positions.filter(p => !p.isPlaceholder);

        // Sort only the real positions by selected column
        realPositions.sort((a, b) => {
          let valueA, valueB;

          // Get values based on sort column
          switch (this.sortOptions.column) {
            case 'name':
              valueA = a.companyName || '';
              valueB = b.companyName || '';
              break;
            case 'weight':
              valueA = parseFloat(a.weight || 0);
              valueB = parseFloat(b.weight || 0);
              break;
            case 'amount':
              // We'd need portfolio index and position index for this
              // As a fallback, use weight
              valueA = parseFloat(a.weight || 0);
              valueB = parseFloat(b.weight || 0);
              break;
            default:
              valueA = a[this.sortOptions.column] || 0;
              valueB = b[this.sortOptions.column] || 0;
          }

          // Sort ascending or descending
          if (this.sortOptions.direction === 'asc') {
            return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
          } else {
            return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
          }
        });

        // Return real positions followed by placeholders
        return [...realPositions, ...placeholders];
      },

      // Display all positions individually (no grouping)
      groupPositionsByWeight(positions, portfolio) {
        // Include placeholder positions for the allocation summary
        const realPositions = positions.filter(p => !p.isPlaceholder);
        const placeholderPosition = positions.find(p => p.isPlaceholder);

        // Convert to array for rendering - show each position individually
        const result = [];

        // Add each real position individually
        realPositions.forEach(position => {
          const company = this.portfolioCompanies[portfolio.id]?.find(c => c.id === position.companyId);
          result.push({
            companyName: company ? company.name : (position.companyName || 'Unknown'),
            weight: parseFloat(position.weight),
            count: 1
          });
        });

        // Calculate total weight of real positions
        const totalRealWeight = realPositions.reduce((sum, pos) => sum + parseFloat(pos.weight || 0), 0);

        // Add placeholder position if it exists and has remaining positions
        // BUT ONLY if the real positions don't sum to 100%
        if (placeholderPosition && placeholderPosition.positionsRemaining > 0 && totalRealWeight < 100) {
          // Only show the placeholder if we don't have enough real positions
          const realPositionCount = realPositions.length;
          const minPositions = Math.ceil(portfolio.minPositions);

          if (realPositionCount < minPositions) {
            // Individual position weight (what each actual position would get)
            const individualWeight = parseFloat(placeholderPosition.weight);

            result.push({
              companyName: `Remaining positions (${placeholderPosition.positionsRemaining})`,
              weight: individualWeight,  // Use weight per position for display
              count: placeholderPosition.positionsRemaining,
              isPlaceholder: true
            });
          }
        }

        // Sort by weight (descending)
        return result.sort((a, b) => b.weight - a.weight);
      },

      // Export allocation summary to CSV
      exportToCSV() {
        const csvData = [];

        // Add header row
        csvData.push(['Portfolio', 'Position', 'Global %', 'Portfolio %', 'To Be Invested']);

        // Process each portfolio
        this.portfolios.forEach(portfolio => {
          // Add portfolio row
          csvData.push([
            this.getPortfolioName(portfolio.id),
            '',
            `${parseFloat(portfolio.allocation).toFixed(1)}%`,
            '100%',
            this.formatCurrency(this.calculateAllocationAmount(portfolio.allocation))
          ]);

          // Add position rows
          const groups = this.groupPositionsByWeight(portfolio.positions, portfolio);
          groups.forEach(group => {
            if (group.weight > 0) {
              if (group.isPlaceholder) {
                csvData.push([
                  '',
                  group.companyName,
                  `${((portfolio.allocation * group.weight * group.count) / 100).toFixed(1)}%`,
                  `${(parseFloat(group.weight) * group.count).toFixed(1)}%`,
                  `${this.formatCurrency(this.calculateAllocationAmount(portfolio.allocation) * group.weight * group.count / 100)} (${this.formatCurrency(this.calculateAllocationAmount(portfolio.allocation) * group.weight / 100)} each)`
                ]);
              } else {
                csvData.push([
                  '',
                  group.companyName,
                  `${((portfolio.allocation * group.weight) / 100).toFixed(1)}%`,
                  `${parseFloat(group.weight).toFixed(1)}%`,
                  this.formatCurrency(this.calculateAllocationAmount(portfolio.allocation) * group.weight / 100)
                ]);
              }
            }
          });
        });

        // Add total row
        csvData.push([
          'Total',
          '',
          `${this.calculateTotalAllocation().toFixed(1)}%`,
          '-',
          this.formatCurrency(this.calculateTotalAllocatedAmount())
        ]);

        // Convert to CSV string
        const csvContent = csvData.map(row =>
          row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `allocation_summary_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Show success notification
        portfolioManager.showNotification('Allocation summary exported successfully!', 'is-success');
      },

      // Export allocation summary to PDF
      exportToPDF() {
        try {
          // Initialize jsPDF
          const { jsPDF } = window.jspdf;
          const doc = new jsPDF();

          // Set document properties
          doc.setProperties({
            title: 'Portfolio Allocation Summary',
            creator: 'Portfolio Rebalancer'
          });

          // Colors (minimal palette)
          const colors = {
            primary: [33, 37, 41],      // Dark gray
            secondary: [108, 117, 125], // Medium gray
            light: [248, 249, 250],     // Light gray
            accent: [0, 123, 255]       // Blue accent
          };

          // Header section with clean styling
          doc.setFillColor(...colors.primary);
          doc.rect(0, 0, 210, 35, 'F');

          // Title
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(24);
          doc.setFont('helvetica', 'normal');
          doc.text('Portfolio Allocation Summary', 20, 22);

          // Date in header
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const today = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          doc.text(`Generated ${today}`, 20, 30);

          // Reset text color
          doc.setTextColor(...colors.primary);

          // Budget overview section with cards
          let yPosition = 45;
          doc.setFontSize(16);
          doc.setFont('helvetica', 'normal');
          doc.text('Investment Overview', 20, yPosition);
          yPosition += 10;

          // Budget cards in a grid
          const cardWidth = 42;
          const cardHeight = 25;
          const cardSpacing = 5;
          const startX = 20;

          const budgetItems = [
            { label: 'Net Worth', value: this.formatCurrency(this.budgetData.totalNetWorth) },
            { label: 'Invested', value: this.formatCurrency(this.budgetData.alreadyInvested) },
            { label: 'Emergency', value: this.formatCurrency(this.budgetData.emergencyFund) },
            { label: 'Available', value: this.formatCurrency(this.budgetData.availableToInvest) }
          ];

          budgetItems.forEach((item, index) => {
            const x = startX + (index * (cardWidth + cardSpacing));

            // Card background
            doc.setFillColor(...colors.light);
            doc.roundedRect(x, yPosition, cardWidth, cardHeight, 2, 2, 'F');

            // Card border
            doc.setDrawColor(...colors.secondary);
            doc.setLineWidth(0.2);
            doc.roundedRect(x, yPosition, cardWidth, cardHeight, 2, 2, 'S');

            // Label
            doc.setTextColor(...colors.secondary);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(item.label, x + 3, yPosition + 8);

            // Value
            doc.setTextColor(...colors.primary);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            const textWidth = doc.getTextWidth(item.value);
            doc.text(item.value, x + cardWidth - textWidth - 3, yPosition + 18);
          });

          yPosition += cardHeight + 15;

          // Allocation table with modern styling
          doc.setTextColor(...colors.primary);
          doc.setFontSize(16);
          doc.setFont('helvetica', 'normal');
          doc.text('Portfolio Allocations', 20, yPosition);
          yPosition += 10;

          // Table setup
          const tableStartY = yPosition;
          const tableWidth = 170;
          const rowHeight = 8;
          const headerHeight = 12;

          // Column configuration
          const columns = [
            { header: 'Portfolio', width: 40, align: 'left' },
            { header: 'Position', width: 50, align: 'left' },
            { header: 'Global %', width: 20, align: 'right' },
            { header: 'Portfolio %', width: 22, align: 'right' },
            { header: 'Amount', width: 38, align: 'right' }
          ];

          // Table header
          doc.setFillColor(...colors.primary);
          doc.rect(20, yPosition, tableWidth, headerHeight, 'F');

          doc.setTextColor(255, 255, 255);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');

          let xPos = 20;
          columns.forEach(col => {
            const textX = col.align === 'right' ? xPos + col.width - 3 : xPos + 3;
            doc.text(col.header, textX, yPosition + 8, { align: col.align });
            xPos += col.width;
          });

          yPosition += headerHeight;
          let rowIndex = 0;

          // Table content
          this.portfolios.forEach(portfolio => {
            // Check for page break
            if (yPosition > 260) {
              doc.addPage();
              yPosition = 30;
              rowIndex = 0;
            }

            // Portfolio row with subtle background
            const bgColor = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
            doc.setFillColor(...bgColor);
            doc.rect(20, yPosition, tableWidth, rowHeight + 2, 'F');

            // Portfolio data
            doc.setTextColor(...colors.primary);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');

            const portfolioRow = [
              this.getPortfolioName(portfolio.id),
              '',
              `${parseFloat(portfolio.allocation).toFixed(1)}%`,
              '100%',
              this.formatCurrency(this.calculateAllocationAmount(portfolio.allocation))
            ];

            xPos = 20;
            portfolioRow.forEach((data, colIndex) => {
              const textX = columns[colIndex].align === 'right' ? xPos + columns[colIndex].width - 3 : xPos + 3;
              doc.text(data, textX, yPosition + 6, { align: columns[colIndex].align });
              xPos += columns[colIndex].width;
            });

            yPosition += rowHeight + 2;
            rowIndex++;

            // Position rows
            const groups = this.groupPositionsByWeight(portfolio.positions, portfolio);
            groups.forEach(group => {
              if (group.weight > 0) {
                // Check for page break
                if (yPosition > 260) {
                  doc.addPage();
                  yPosition = 30;
                  rowIndex = 0;
                }

                // Row background
                const bgColor = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
                doc.setFillColor(...bgColor);
                doc.rect(20, yPosition, tableWidth, rowHeight, 'F');

                doc.setTextColor(...colors.secondary);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');

                let positionRow;
                let hasSecondLine = false;
                let secondLineData = null;

                if (group.isPlaceholder) {
                  const totalAmount = this.calculateAllocationAmount(portfolio.allocation) * group.weight * group.count / 100;
                  const eachAmount = this.calculateAllocationAmount(portfolio.allocation) * group.weight / 100;
                  positionRow = [
                    '',
                    group.companyName.length > 30 ? group.companyName.substring(0, 27) + '...' : group.companyName,
                    `${((portfolio.allocation * group.weight * group.count) / 100).toFixed(1)}%`,
                    `${(parseFloat(group.weight) * group.count).toFixed(1)}%`,
                    this.formatCurrency(totalAmount)
                  ];

                  // Second line for "(each)" information
                  hasSecondLine = true;
                  secondLineData = [
                    '',
                    '',
                    '',
                    '',
                    `(${this.formatCurrency(eachAmount)} each)`
                  ];
                } else {
                  positionRow = [
                    '',
                    group.companyName.length > 30 ? group.companyName.substring(0, 27) + '...' : group.companyName,
                    `${((portfolio.allocation * group.weight) / 100).toFixed(1)}%`,
                    `${parseFloat(group.weight).toFixed(1)}%`,
                    this.formatCurrency(this.calculateAllocationAmount(portfolio.allocation) * group.weight / 100)
                  ];
                }

                xPos = 20;
                positionRow.forEach((data, colIndex) => {
                  const textX = columns[colIndex].align === 'right' ? xPos + columns[colIndex].width - 3 : xPos + 3;
                  doc.text(data, textX, yPosition + 5, { align: columns[colIndex].align });
                  xPos += columns[colIndex].width;
                });

                yPosition += rowHeight;
                rowIndex++;

                // Add second line for placeholder positions
                if (hasSecondLine && secondLineData) {
                  // Check for page break again
                  if (yPosition > 260) {
                    doc.addPage();
                    yPosition = 30;
                    rowIndex = 0;
                  }

                  // Row background for second line
                  const bgColor = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
                  doc.setFillColor(...bgColor);
                  doc.rect(20, yPosition, tableWidth, rowHeight, 'F');

                  doc.setTextColor(...colors.secondary);
                  doc.setFontSize(7);
                  doc.setFont('helvetica', 'italic');

                  xPos = 20;
                  secondLineData.forEach((data, colIndex) => {
                    const textX = columns[colIndex].align === 'right' ? xPos + columns[colIndex].width - 3 : xPos + 3;
                    doc.text(data, textX, yPosition + 5, { align: columns[colIndex].align });
                    xPos += columns[colIndex].width;
                  });

                  yPosition += rowHeight;
                  rowIndex++;

                  // Reset font for next row
                  doc.setTextColor(...colors.secondary);
                  doc.setFontSize(8);
                  doc.setFont('helvetica', 'normal');
                }
              }
            });

            yPosition += 2; // Small gap between portfolios
          });

          // Total row with emphasis
          if (yPosition > 260) {
            doc.addPage();
            yPosition = 30;
          }

          yPosition += 5;

          // Total row background
          doc.setFillColor(...colors.accent);
          doc.rect(20, yPosition, tableWidth, rowHeight + 2, 'F');

          doc.setTextColor(255, 255, 255);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');

          const totalRow = [
            'TOTAL ALLOCATION',
            '',
            `${this.calculateTotalAllocation().toFixed(1)}%`,
            '—',
            this.formatCurrency(this.calculateTotalAllocatedAmount())
          ];

          xPos = 20;
          totalRow.forEach((data, colIndex) => {
            const textX = columns[colIndex].align === 'right' ? xPos + columns[colIndex].width - 3 : xPos + 3;
            doc.text(data, textX, yPosition + 6, { align: columns[colIndex].align });
            xPos += columns[colIndex].width;
          });

          // Footer
          const pageHeight = doc.internal.pageSize.height;
          doc.setTextColor(...colors.secondary);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.text('Generated by Portfolio Rebalancer', 20, pageHeight - 10);

          // Save the PDF
          const filename = `allocation_summary_${new Date().toISOString().slice(0, 10)}.pdf`;
          doc.save(filename);

          // Show success notification
          portfolioManager.showNotification('Allocation summary PDF downloaded successfully!', 'is-success');

        } catch (error) {
          console.error('Error generating PDF:', error);
          portfolioManager.showNotification('Failed to generate PDF. Please try again.', 'is-danger');
        }
      },

      // Save allocation state
      async saveAllocation() {
        try {
          this.loadingState = true;
          this.autoSaveIndicator = true;

          const data = {
            page: 'build',
            budgetData: JSON.stringify(this.budgetData),
            rules: JSON.stringify(this.rules),
            portfolios: JSON.stringify(this.portfolios),
            expandedPortfolios: JSON.stringify(this.expandedPortfolios),
            expandedAllocations: JSON.stringify(this.expandedAllocations),
            sortOptions: JSON.stringify(this.sortOptions)
          };

          await axios.post('/portfolio/api/state', data);

          setTimeout(() => {
            this.autoSaveIndicator = false;
          }, 1000);

          this.loadingState = false;
        } catch (error) {
          console.error('Error saving allocation:', error);
          portfolioManager.showNotification('Failed to save allocation', 'is-danger');
          this.autoSaveIndicator = false;
          this.loadingState = false;
        }
      }
    },
    // Create debounced save method
    created() {
      this.debouncedSave = debounce(this.saveAllocation, 500);
      // Initialize editing flag
      this.isEditingWeight = false;
    },
    // Watch for changes to trigger auto-save
    watch: {
      budgetData: {
        handler() {
          this.debouncedSave();
        },
        deep: true
      },
      rules: {
        handler() {
          // Recalculate minimum positions when rules change
          this.portfolios.forEach((portfolio, index) => {
            // Update current positions count (in case companies were added/removed)
            portfolio.currentPositions = this.portfolioCompanies[portfolio.id]?.length || 0;
            this.calculateMinimumPositions(portfolio);
            this.ensureMinimumPositions(portfolio);
          });
          this.debouncedSave();
        },
        deep: true
      },
      portfolios: {
        handler() {
          this.debouncedSave();
        },
        deep: true
      }
    }
  });
});