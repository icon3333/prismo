/**
 * Allocation Simulator
 *
 * Shows portfolio allocation with simulated additions,
 * real-time percentage breakdowns by country and sector.
 * Supports saving/loading simulations and scope toggling.
 */

class AllocationSimulator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('Simulator container not found:', containerId);
      return;
    }

    // Data stores
    this.items = [];                   // Simulated items
    this.portfolioData = null;         // Portfolio baseline data
    this.portfolios = [];              // Available portfolios for selection
    this.savedSimulations = [];        // List of saved simulations
    this.currentSimulationId = null;   // Currently loaded simulation ID
    this.currentSimulationName = null; // Currently loaded simulation name
    this.saveAsMode = false;           // true when "Save As" was clicked

    // Investment targets from Builder (for "Remaining to Invest" display)
    this.investmentTargets = null;     // Investment target data from Builder
    this.hasBuilderConfig = false;     // Whether Builder has been configured

    // Settings
    this.scope = 'global';             // 'global' or 'portfolio'
    this.portfolioId = null;           // Selected portfolio ID (if scope='portfolio')

    // DOM references (will be set after render)
    this.tableBody = null;
    this.countryChart = null;
    this.sectorChart = null;

    // Expanded chart bar state (one at a time per chart type)
    this.expandedCountryBar = null;   // Label of expanded country bar
    this.expandedSectorBar = null;  // Label of expanded sector bar

    // Auto-expand tracking for newly added items
    this.pendingExpandSector = null;
    this.pendingExpandCountry = null;

    // Debounced chart update for real-time feedback
    this.debouncedChartUpdate = this.debounce(() => this.updateCharts(), 300);

    // Initialize
    this.render();
    this.bindEvents();
    this.initializeScope();
    this.loadSavedSimulations();
    this.loadPortfolioAllocations();
  }

  // Debounce utility
  debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initializeScope() {
    // Load portfolios for dropdown (with IDs and values for display)
    try {
      const response = await fetch('/portfolio/api/portfolios?include_ids=true&include_values=true');
      const result = await response.json();
      if (result && result.length > 0) {
        this.portfolios = result;
        this.populatePortfolioDropdown();
      }
    } catch (error) {
      console.error('Failed to load portfolios:', error);
    }

    // Bind scope toggle events
    const scopeRadios = document.querySelectorAll('input[name="simulator-scope"]');
    scopeRadios.forEach(radio => {
      radio.addEventListener('change', () => this.handleScopeChange(radio.value));
    });

    // Bind portfolio select event
    const portfolioSelect = document.getElementById('simulator-portfolio-select');
    if (portfolioSelect) {
      portfolioSelect.addEventListener('change', () => {
        this.portfolioId = portfolioSelect.value ? parseInt(portfolioSelect.value) : null;
        this.loadPortfolioAllocations();
      });
    }
  }

  populatePortfolioDropdown() {
    const select = document.getElementById('simulator-portfolio-select');
    if (!select) return;

    select.innerHTML = '<option value="">Select portfolio...</option>';
    this.portfolios.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      // Show portfolio name with value if available
      const valueStr = p.total_value ? ` (€${this.formatNumber(p.total_value)})` : '';
      option.textContent = `${p.name}${valueStr}`;
      select.appendChild(option);
    });
  }

  formatNumber(value) {
    const num = parseFloat(value) || 0;
    // Format with thousands separator (German locale)
    return num.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  // Normalize sector/country labels to lowercase for consistent matching
  normalizeLabel(label) {
    if (!label || label === '—') return label;
    return label.toLowerCase().trim();
  }

  handleScopeChange(scope) {
    this.scope = scope;
    const portfolioWrapper = document.getElementById('simulator-portfolio-select-wrapper');

    if (scope === 'portfolio') {
      portfolioWrapper.style.display = 'block';
      // Don't load until portfolio is selected
      if (this.portfolioId) {
        this.loadPortfolioAllocations();
      }
    } else {
      portfolioWrapper.style.display = 'none';
      this.portfolioId = null;
      this.loadPortfolioAllocations();
    }
  }

  // ============================================================================
  // Portfolio Data Loading
  // ============================================================================

  async loadPortfolioAllocations() {
    try {
      let url = '/portfolio/api/simulator/portfolio-allocations?scope=' + this.scope;
      if (this.scope === 'portfolio' && this.portfolioId) {
        url += '&portfolio_id=' + this.portfolioId;
      }

      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        this.portfolioData = result.data;

        // Recalculate percentage-based items when baseline changes
        this.recalculateAllPercentageItems();
        this.renderTable();
        this.updateCharts();
      } else {
        console.error('Failed to load portfolio allocations:', result.error);
        this.portfolioData = { countries: [], sectors: [], positions: [], total_value: 0 };
        this.recalculateAllPercentageItems();
        this.renderTable();
        this.updateCharts();
      }
    } catch (error) {
      console.error('Error loading portfolio allocations:', error);
      this.portfolioData = { countries: [], sectors: [], positions: [], total_value: 0 };
      this.recalculateAllPercentageItems();
      this.renderTable();
      this.updateCharts();
    }
  }

  // ============================================================================
  // Saved Simulations
  // ============================================================================

  async loadSavedSimulations() {
    try {
      const response = await fetch('/portfolio/api/simulator/simulations');
      const result = await response.json();

      if (result.success) {
        this.savedSimulations = result.data.simulations || [];
        this.populateSimulationsDropdown();
      }
    } catch (error) {
      console.error('Failed to load saved simulations:', error);
    }
  }

  populateSimulationsDropdown() {
    const select = document.getElementById('simulator-load-select');
    if (!select) return;

    // Keep the "New Simulation" option
    select.innerHTML = '<option value="">New Simulation</option>';

    this.savedSimulations.forEach(sim => {
      const option = document.createElement('option');
      option.value = sim.id;
      option.textContent = sim.name;
      select.appendChild(option);
    });

    // Update delete button visibility
    this.updateDeleteButtonVisibility();
  }

  updateDeleteButtonVisibility() {
    const deleteBtn = document.getElementById('simulator-delete-btn');
    if (deleteBtn) {
      deleteBtn.style.display = this.currentSimulationId ? 'inline-flex' : 'none';
    }
  }

  updateSaveButtonVisibility() {
    const saveBtn = document.getElementById('simulator-save-btn');
    if (saveBtn) {
      // Show Save button only when editing an existing simulation
      saveBtn.style.display = this.currentSimulationId ? 'inline-flex' : 'none';
    }
  }

  async loadSimulation(simulationId) {
    if (!simulationId) {
      // "New Simulation" selected - reset
      this.resetSimulation();
      return;
    }

    try {
      const response = await fetch(`/portfolio/api/simulator/simulations/${simulationId}`);
      const result = await response.json();

      if (result.success) {
        const simulation = result.data.simulation;
        this.currentSimulationId = simulation.id;
        this.currentSimulationName = simulation.name;
        this.scope = simulation.scope || 'global';
        this.portfolioId = simulation.portfolio_id;
        this.items = simulation.items || [];

        // Update UI to reflect loaded simulation
        this.updateScopeUI();
        this.renderTable();
        this.loadPortfolioAllocations();
        this.updateDeleteButtonVisibility();
        this.updateSaveButtonVisibility();

        this.showToast(`Loaded "${simulation.name}"`, 'success');
      } else {
        this.showToast(result.error || 'Failed to load simulation', 'danger');
      }
    } catch (error) {
      console.error('Error loading simulation:', error);
      this.showToast('Failed to load simulation', 'danger');
    }
  }

  resetSimulation() {
    this.currentSimulationId = null;
    this.currentSimulationName = null;
    this.items = [];
    this.renderTable();
    this.updateCharts();
    this.updateDeleteButtonVisibility();
    this.updateSaveButtonVisibility();

    // Reset load dropdown
    const select = document.getElementById('simulator-load-select');
    if (select) select.value = '';
  }

  updateScopeUI() {
    // Update scope radio buttons
    const scopeRadios = document.querySelectorAll('input[name="simulator-scope"]');
    scopeRadios.forEach(radio => {
      radio.checked = radio.value === this.scope;
    });

    // Update portfolio select visibility and value
    const portfolioWrapper = document.getElementById('simulator-portfolio-select-wrapper');
    const portfolioSelect = document.getElementById('simulator-portfolio-select');

    if (this.scope === 'portfolio') {
      portfolioWrapper.style.display = 'block';
      if (portfolioSelect && this.portfolioId) {
        portfolioSelect.value = this.portfolioId;
      }
    } else {
      portfolioWrapper.style.display = 'none';
    }
  }

  /**
   * Save changes to the current simulation (only available when editing existing)
   */
  saveSimulation() {
    if (!this.currentSimulationId) return;  // Safety check

    this.saveAsMode = false;
    const modal = document.getElementById('save-simulation-modal');
    const nameInput = document.getElementById('simulation-name-input');

    nameInput.value = this.currentSimulationName;
    modal.style.display = 'flex';
    nameInput.focus();
  }

  /**
   * Save as a new simulation (creates a copy/fork)
   */
  saveAsSimulation() {
    this.saveAsMode = true;
    const modal = document.getElementById('save-simulation-modal');
    const nameInput = document.getElementById('simulation-name-input');

    // Suggest name based on current simulation
    const suggestedName = this.currentSimulationName
      ? `Copy of ${this.currentSimulationName}`
      : '';

    nameInput.value = suggestedName;
    modal.style.display = 'flex';
    nameInput.focus();
    nameInput.select();
  }

  async confirmSaveSimulation() {
    const nameInput = document.getElementById('simulation-name-input');
    const name = nameInput.value.trim();

    if (!name) {
      this.showToast('Please enter a simulation name', 'warning');
      return;
    }

    const simulationData = {
      name: name,
      scope: this.scope,
      portfolio_id: this.scope === 'portfolio' ? this.portfolioId : null,
      items: this.items
    };

    try {
      let response;
      // If editing existing AND NOT in saveAs mode → update existing
      if (this.currentSimulationId && !this.saveAsMode) {
        // Update existing simulation
        response = await fetch(`/portfolio/api/simulator/simulations/${this.currentSimulationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(simulationData)
        });
      } else {
        // Create new simulation
        response = await fetch('/portfolio/api/simulator/simulations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(simulationData)
        });
      }

      const result = await response.json();

      if (result.success) {
        const simulation = result.data.simulation;
        this.currentSimulationId = simulation.id;
        this.currentSimulationName = simulation.name;

        // Close modal
        document.getElementById('save-simulation-modal').style.display = 'none';

        // Refresh simulations list
        await this.loadSavedSimulations();

        // Update dropdown selection
        const select = document.getElementById('simulator-load-select');
        if (select) select.value = simulation.id;

        this.updateDeleteButtonVisibility();
        this.updateSaveButtonVisibility();
        this.showToast(`Saved "${name}"`, 'success');
      } else {
        this.showToast(result.error || 'Failed to save simulation', 'danger');
      }
    } catch (error) {
      console.error('Error saving simulation:', error);
      this.showToast('Failed to save simulation', 'danger');
    }
  }

  async deleteSimulation() {
    if (!this.currentSimulationId) return;

    const confirmed = confirm(`Delete simulation "${this.currentSimulationName}"?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/portfolio/api/simulator/simulations/${this.currentSimulationId}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        this.showToast(`Deleted "${this.currentSimulationName}"`, 'success');
        this.resetSimulation();
        await this.loadSavedSimulations();
      } else {
        this.showToast(result.error || 'Failed to delete simulation', 'danger');
      }
    } catch (error) {
      console.error('Error deleting simulation:', error);
      this.showToast('Failed to delete simulation', 'danger');
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  render() {
    this.container.innerHTML = `
      <!-- Input Forms -->
      <div class="simulator-input-forms">
        <div class="simulator-input-form">
          <label class="label">Add Identifier</label>
          <div class="input-row">
            <input type="text" class="input" id="simulator-ticker-input"
                   placeholder="e.g., AAPL, MSFT">
            <button class="btn btn-sm simulator-btn-secondary" id="simulator-add-ticker-btn">
              <span class="btn-text">Add</span>
              <span class="btn-spinner" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i>
              </span>
            </button>
          </div>
        </div>
        <div class="simulator-input-form">
          <label class="label">Add Sector</label>
          <div class="input-row">
            <div class="combobox-wrapper" id="simulator-sector-combobox">
              <input type="text" class="input combobox-input" id="simulator-sector-input"
                     placeholder="Select or type sector..." autocomplete="off">
              <button class="combobox-toggle" type="button" tabindex="-1">
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="combobox-dropdown" id="simulator-sector-dropdown"></div>
            </div>
            <button class="btn btn-sm simulator-btn-secondary" id="simulator-add-sector-btn">Add</button>
          </div>
        </div>
        <div class="simulator-input-form">
          <label class="label">Add Country</label>
          <div class="input-row">
            <div class="combobox-wrapper" id="simulator-country-combobox">
              <input type="text" class="input combobox-input" id="simulator-country-input"
                     placeholder="Select or type country..." autocomplete="off">
              <button class="combobox-toggle" type="button" tabindex="-1">
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="combobox-dropdown" id="simulator-country-dropdown"></div>
            </div>
            <button class="btn btn-sm simulator-btn-secondary" id="simulator-add-country-btn">Add</button>
          </div>
        </div>
      </div>

      <!-- Data Table -->
      <div class="simulator-table-wrapper">
        <table class="unified-table simulator-table">
          <thead>
            <tr>
              <th class="col-ticker">Identifier</th>
              <th class="col-name">Name</th>
              <th class="col-portfolio">Portfolio</th>
              <th class="col-sector">Sector</th>
              <th class="col-country">Country</th>
              <th class="col-value">Value <span class="col-value-hint">(€ or %)</span></th>
              <th class="col-delete"></th>
            </tr>
          </thead>
          <tbody id="simulator-table-body">
            <tr class="empty-state-row">
              <td colspan="7" class="empty-state">
                <i class="fas fa-chart-pie"></i>
                <span>No items added yet. Use the forms above to add positions.</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Aggregation Charts -->
      <div class="simulator-charts">
        <div class="simulator-chart-panel">
          <div class="chart-header">
            <h4 class="chart-title">
              <i class="fas fa-globe"></i>
              Distribution by Country
            </h4>
          </div>
          <div class="chart-content" id="simulator-country-chart">
            <div class="chart-empty">Loading portfolio data...</div>
          </div>
        </div>
        <div class="simulator-chart-panel">
          <div class="chart-header">
            <h4 class="chart-title">
              <i class="fas fa-tags"></i>
              Distribution by Sector
            </h4>
          </div>
          <div class="chart-content" id="simulator-sector-chart">
            <div class="chart-empty">Loading portfolio data...</div>
          </div>
        </div>
      </div>
    `;

    // Store DOM references
    this.tableBody = document.getElementById('simulator-table-body');
    this.countryChart = document.getElementById('simulator-country-chart');
    this.sectorChart = document.getElementById('simulator-sector-chart');
  }

  bindEvents() {
    // Add Ticker
    const tickerInput = document.getElementById('simulator-ticker-input');
    const tickerBtn = document.getElementById('simulator-add-ticker-btn');

    if (tickerBtn && tickerInput) {
      tickerBtn.addEventListener('click', () => this.handleAddTicker());
      tickerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAddTicker();
      });
    }

    // Add Sector with combobox
    const sectorInput = document.getElementById('simulator-sector-input');
    const sectorBtn = document.getElementById('simulator-add-sector-btn');
    const sectorCombobox = document.getElementById('simulator-sector-combobox');

    if (sectorBtn && sectorInput) {
      sectorBtn.addEventListener('click', () => this.handleAddSector());
      sectorInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAddSector();
      });
      this.initCombobox(sectorCombobox, sectorInput, 'sector');
    }

    // Add Country with combobox
    const countryInput = document.getElementById('simulator-country-input');
    const countryBtn = document.getElementById('simulator-add-country-btn');
    const countryCombobox = document.getElementById('simulator-country-combobox');

    if (countryBtn && countryInput) {
      countryBtn.addEventListener('click', () => this.handleAddCountry());
      countryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAddCountry();
      });
      this.initCombobox(countryCombobox, countryInput, 'country');
    }

    // Table event delegation (for edit and delete)
    this.tableBody.addEventListener('click', (e) => this.handleTableClick(e));
    this.tableBody.addEventListener('blur', (e) => this.handleTableBlur(e), true);
    this.tableBody.addEventListener('keydown', (e) => this.handleTableKeydown(e));
    this.tableBody.addEventListener('input', (e) => this.handleTableInput(e));
    this.tableBody.addEventListener('change', (e) => this.handleTableChange(e));

    // Save/Load simulation events
    const loadSelect = document.getElementById('simulator-load-select');
    if (loadSelect) {
      loadSelect.addEventListener('change', () => this.loadSimulation(loadSelect.value));
    }

    const saveBtn = document.getElementById('simulator-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveSimulation());
    }

    const saveAsBtn = document.getElementById('simulator-saveas-btn');
    if (saveAsBtn) {
      saveAsBtn.addEventListener('click', () => this.saveAsSimulation());
    }

    const deleteBtn = document.getElementById('simulator-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteSimulation());
    }

    // Save modal events
    const saveConfirmBtn = document.getElementById('save-simulation-confirm');
    const saveCancelBtn = document.getElementById('save-simulation-cancel');
    const saveCloseBtn = document.getElementById('save-simulation-close');
    const saveModal = document.getElementById('save-simulation-modal');

    if (saveConfirmBtn) {
      saveConfirmBtn.addEventListener('click', () => this.confirmSaveSimulation());
    }

    if (saveCancelBtn) {
      saveCancelBtn.addEventListener('click', () => {
        saveModal.style.display = 'none';
      });
    }

    if (saveCloseBtn) {
      saveCloseBtn.addEventListener('click', () => {
        saveModal.style.display = 'none';
      });
    }

    // Close modal on overlay click
    if (saveModal) {
      saveModal.addEventListener('click', (e) => {
        if (e.target === saveModal) {
          saveModal.style.display = 'none';
        }
      });
    }

    // Enter key in save modal
    const nameInput = document.getElementById('simulation-name-input');
    if (nameInput) {
      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.confirmSaveSimulation();
      });
    }
  }

  // ============================================================================
  // Add Handlers
  // ============================================================================

  async handleAddTicker() {
    const input = document.getElementById('simulator-ticker-input');
    const btn = document.getElementById('simulator-add-ticker-btn');
    const ticker = input.value.trim().toUpperCase();

    if (!ticker) {
      this.showToast('Please enter a ticker symbol', 'warning');
      return;
    }

    // Show loading state
    btn.querySelector('.btn-text').style.display = 'none';
    btn.querySelector('.btn-spinner').style.display = 'inline';
    btn.disabled = true;

    try {
      const response = await fetch('/portfolio/api/simulator/ticker-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker })
      });

      const result = await response.json();

      if (result.success) {
        const data = result.data;
        this.addItem({
          id: this.generateId(),
          ticker: data.ticker,
          sector: this.normalizeLabel(data.sector) || '—',
          country: this.normalizeLabel(data.country) || '—',
          value: 0,
          valueMode: 'absolute', // Default to absolute mode
          source: 'ticker',
          name: data.name,
          existsInPortfolio: data.existsInPortfolio || false,
          portfolioData: data.portfolioData || null,
          portfolio_id: (this.scope === 'portfolio' && this.portfolioId) ? this.portfolioId : null
        });
        input.value = '';

        const existsMsg = data.existsInPortfolio ? ' (exists in portfolio)' : '';
        this.showToast(`Added ${data.ticker} (${data.name})${existsMsg}`, 'success');
      } else {
        this.showToast(result.error || 'Ticker not found', 'danger');
      }
    } catch (error) {
      console.error('Ticker lookup error:', error);
      this.showToast('Failed to fetch ticker data', 'danger');
    } finally {
      // Reset button state
      btn.querySelector('.btn-text').style.display = 'inline';
      btn.querySelector('.btn-spinner').style.display = 'none';
      btn.disabled = false;
    }
  }

  handleAddSector() {
    const input = document.getElementById('simulator-sector-input');
    const sector = input.value.trim();

    if (!sector) {
      this.showToast('Please enter a sector name', 'warning');
      return;
    }

    const normalizedSector = this.normalizeLabel(sector);

    // Set pending expand so the chart auto-expands this sector
    this.pendingExpandSector = normalizedSector;

    this.addItem({
      id: this.generateId(),
      ticker: '—',
      sector: normalizedSector,
      country: '—',
      value: 0,
      valueMode: 'absolute', // Default to absolute mode
      source: 'sector',
      portfolio_id: (this.scope === 'portfolio' && this.portfolioId) ? this.portfolioId : null
    });
    input.value = '';

    // Hide dropdown
    const dropdown = document.getElementById('simulator-sector-dropdown');
    if (dropdown) dropdown.classList.remove('show');
  }

  handleAddCountry() {
    const input = document.getElementById('simulator-country-input');
    const country = input.value.trim();

    if (!country) {
      this.showToast('Please enter a country name', 'warning');
      return;
    }

    const normalizedCountry = this.normalizeLabel(country);

    // Set pending expand so the chart auto-expands this country
    this.pendingExpandCountry = normalizedCountry;

    this.addItem({
      id: this.generateId(),
      ticker: '—',
      sector: '—',
      country: normalizedCountry,
      value: 0,
      valueMode: 'absolute', // Default to absolute mode
      source: 'country',
      portfolio_id: (this.scope === 'portfolio' && this.portfolioId) ? this.portfolioId : null
    });
    input.value = '';

    // Hide dropdown
    const dropdown = document.getElementById('simulator-country-dropdown');
    if (dropdown) dropdown.classList.remove('show');
  }

  // ============================================================================
  // Data Management
  // ============================================================================

  addItem(item) {
    this.items.push(item);
    this.renderTable();
    this.updateCharts();

    // Focus the value input for the new row
    setTimeout(() => {
      const valueInput = this.tableBody.querySelector(`[data-id="${item.id}"] .value-input`);
      if (valueInput) valueInput.focus();
    }, 50);
  }

  updateItem(id, field, value) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item[field] = value;
      this.updateCharts();
    }
  }

  deleteItem(id) {
    const index = this.items.findIndex(i => i.id === id);
    if (index !== -1) {
      this.items.splice(index, 1);
      this.renderTable();
      this.updateCharts();
    }
  }

  generateId() {
    return 'sim_' + Math.random().toString(36).substr(2, 9);
  }

  // ============================================================================
  // Table Rendering
  // ============================================================================

  renderTable() {
    if (this.items.length === 0) {
      this.tableBody.innerHTML = `
        <tr class="empty-state-row">
          <td colspan="7" class="empty-state">
            <i class="fas fa-chart-pie"></i>
            <span>No items added yet. Use the forms above to add positions.</span>
          </td>
        </tr>
      `;
      return;
    }

    this.tableBody.innerHTML = this.items.map(item => {
      // Determine value mode display
      const isPercentMode = item.valueMode === 'percentage';
      const displayValue = isPercentMode ? (item.targetPercent || 0) : item.value;
      const modeSymbol = isPercentMode ? '%' : '€';
      const formattedValue = isPercentMode
        ? (item.targetPercent || 0).toFixed(1)
        : this.formatValue(item.value);

      // Show calculated € value for percentage mode items
      const calculatedHint = isPercentMode && item.value > 0
        ? `<span class="value-calculated-hint sensitive-value" title="Calculated amount to reach target">= €${this.formatValue(item.value)}</span>`
        : '';

      // Warning if target is below current
      const warningHint = item.targetWarning
        ? `<span class="value-warning-hint" title="${this.escapeHtml(item.targetWarning)}"><i class="fas fa-exclamation-triangle"></i></span>`
        : '';

      return `
        <tr data-id="${item.id}">
          <td class="col-ticker">
            ${item.source === 'ticker'
              ? `<span class="ticker-badge">${item.ticker}</span>
                 ${item.existsInPortfolio ? '<span class="existing-badge" title="Exists in portfolio"><i class="fas fa-check"></i> Existing</span>' : ''}`
              : `<input type="text" class="editable-cell ticker-input" value="${this.escapeHtml(item.ticker)}"
                       data-field="ticker" placeholder="—">`
            }
          </td>
          <td class="col-name">
            <span class="name-display">${this.escapeHtml(item.name || '—')}</span>
          </td>
          <td class="col-portfolio">
            <select class="editable-cell portfolio-select" data-field="portfolio_id">
              <option value="">—</option>
              ${this.portfolios.map(p =>
                `<option value="${p.id}" ${item.portfolio_id == p.id ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`
              ).join('')}
            </select>
          </td>
          <td class="col-sector">
            <input type="text" class="editable-cell sector-input" value="${this.escapeHtml(item.sector === '—' ? item.sector : (item.sector || '').toLowerCase())}"
                   data-field="sector" placeholder="—">
          </td>
          <td class="col-country">
            <input type="text" class="editable-cell country-input" value="${this.escapeHtml(item.country === '—' ? item.country : (item.country || '').toLowerCase())}"
                   data-field="country" placeholder="—">
          </td>
          <td class="col-value">
            <div class="value-input-wrapper">
              <button class="value-mode-toggle ${isPercentMode ? 'mode-percent' : 'mode-euro'}"
                      data-field="valueMode" title="Toggle between € amount and % target">
                ${modeSymbol}
              </button>
              <input type="text" class="editable-cell value-input sensitive-value ${isPercentMode ? 'percent-mode' : ''}"
                     value="${formattedValue}"
                     data-field="value" placeholder="0">
              ${calculatedHint}
              ${warningHint}
            </div>
          </td>
          <td class="col-delete">
            <button class="btn-delete" title="Remove">
              <i class="fas fa-times"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ============================================================================
  // Table Event Handlers
  // ============================================================================

  handleTableClick(e) {
    // Delete button
    if (e.target.closest('.btn-delete')) {
      const row = e.target.closest('tr');
      if (row) {
        const id = row.dataset.id;
        // Fade out animation
        row.style.opacity = '0';
        row.style.transform = 'translateX(10px)';
        setTimeout(() => this.deleteItem(id), 200);
      }
      return;
    }

    // Value mode toggle button
    if (e.target.closest('.value-mode-toggle')) {
      const row = e.target.closest('tr');
      if (row) {
        const id = row.dataset.id;
        this.toggleValueMode(id);
      }
    }
  }

  toggleValueMode(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    const wasPercentMode = item.valueMode === 'percentage';

    if (wasPercentMode) {
      // Switching to absolute euro mode
      item.valueMode = 'absolute';
      // Keep the calculated value as the new absolute value
    } else {
      // Switching to percentage mode
      item.valueMode = 'percentage';
      // Calculate target percentage based on current value
      const { baselineValue, baselineTotal } = this.getBaselineForItem(item);
      const combinedTotal = baselineTotal + item.value;
      if (combinedTotal > 0) {
        // Current allocation would be: (baselineValue + item.value) / combinedTotal * 100
        const currentPercent = ((baselineValue + item.value) / combinedTotal) * 100;
        item.targetPercent = parseFloat(currentPercent.toFixed(1));
      } else {
        item.targetPercent = 0;
      }
    }

    // Recalculate if now in percentage mode
    if (item.valueMode === 'percentage') {
      this.recalculatePercentageItem(item);
    }

    this.renderTable();
    this.updateCharts();
  }

  handleTableBlur(e) {
    if (e.target.classList.contains('editable-cell')) {
      this.saveCell(e.target);
    }
  }

  handleTableKeydown(e) {
    if (e.target.classList.contains('editable-cell')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === 'Escape') {
        // Revert to original value
        const row = e.target.closest('tr');
        const id = row.dataset.id;
        const field = e.target.dataset.field;
        const item = this.items.find(i => i.id === id);
        if (item) {
          e.target.value = field === 'value' ? this.formatValue(item[field]) : item[field];
        }
        e.target.blur();
      }
    }
  }

  handleTableInput(e) {
    // Convert sector/country to lowercase as user types
    if (e.target.classList.contains('sector-input') || e.target.classList.contains('country-input')) {
      const cursorPos = e.target.selectionStart;
      e.target.value = e.target.value.toLowerCase();
      e.target.setSelectionRange(cursorPos, cursorPos);
    }

    // Real-time chart updates with debounce (only for value inputs)
    if (e.target.classList.contains('value-input')) {
      const row = e.target.closest('tr');
      if (!row) return;

      const id = row.dataset.id;
      const item = this.items.find(i => i.id === id);
      if (item) {
        if (item.valueMode === 'percentage') {
          // For percentage mode, update target percent and recalculate
          const cleanedValue = e.target.value.replace('%', '').trim();
          const percentValue = parseFloat(cleanedValue);
          if (!isNaN(percentValue)) {
            item.targetPercent = Math.min(Math.max(0, percentValue), 99.9);
            this.recalculatePercentageItem(item);
          }
        } else {
          // For absolute mode, update value directly
          const newValue = this.parseValue(e.target.value);
          item.value = newValue;
        }
        this.debouncedChartUpdate();
      }
    }
  }

  saveCell(input) {
    const row = input.closest('tr');
    if (!row) return;

    const id = row.dataset.id;
    const field = input.dataset.field;
    let value = input.value.trim();
    const item = this.items.find(i => i.id === id);

    if (field === 'value') {
      // Check if item is in percentage mode
      if (item && item.valueMode === 'percentage') {
        // Parse as percentage target
        const cleanedValue = value.replace('%', '').trim();
        const percentValue = parseFloat(cleanedValue);

        if (!isNaN(percentValue)) {
          item.targetPercent = Math.min(Math.max(0, percentValue), 99.9);
          input.value = item.targetPercent.toFixed(1);

          // Recalculate the € value needed
          this.recalculatePercentageItem(item);
        }
      } else {
        // Parse numeric euro value
        value = this.parseValue(value);
        input.value = this.formatValue(value);
        this.updateItem(id, 'value', value);
      }
    } else if (field === 'portfolio_id') {
      // Parse portfolio_id as number or null
      value = value ? parseInt(value) : null;
      this.updateItem(id, field, value);
    } else if (field === 'sector' || field === 'country') {
      // Normalize sector/country to lowercase
      if (value && value !== '—') {
        value = this.normalizeLabel(value);
        input.value = value;
      }
      // Update if value is empty, set to placeholder
      if (value === '') {
        value = '—';
        input.value = '—';
      }
      this.updateItem(id, field, value);

      // If sector or country changes, recalculate percentage items
      if (item && item.valueMode === 'percentage') {
        this.recalculatePercentageItem(item);
      }
    } else {
      // Update if value is empty, set to placeholder
      if (value === '' && field !== 'value' && field !== 'portfolio_id') {
        value = '—';
        input.value = '—';
      }
      this.updateItem(id, field, value);
    }

    // Re-render table to show calculated values
    if (item && item.valueMode === 'percentage') {
      this.renderTable();
    }

    this.updateCharts();

    // Visual feedback
    input.classList.add('cell-saved');
    setTimeout(() => input.classList.remove('cell-saved'), 500);
  }

  handleTableChange(e) {
    // Handle select element changes (e.g., portfolio dropdown)
    if (e.target.classList.contains('portfolio-select')) {
      this.saveCell(e.target);
      // Explicitly update charts when portfolio assignment changes
      this.updateCharts();
    }
  }

  // ============================================================================
  // Chart Rendering with Combined Allocations
  // ============================================================================

  updateCharts() {
    const combined = this.calculateCombinedAllocations();
    // Store for position detail access
    this.lastCombinedData = combined;

    this.renderBarChart(this.countryChart, combined.byCountry, combined.combinedTotal, combined.baselineByCountry, combined.baselineTotal, 'country');
    this.renderBarChart(this.sectorChart, combined.byCategory, combined.combinedTotal, combined.baselineByCategory, combined.baselineTotal, 'sector');

    // Handle pending auto-expand for newly added items
    this.handlePendingExpand();
  }

  /**
   * Auto-expand chart bars for newly added categories/countries
   */
  handlePendingExpand() {
    if (this.pendingExpandSector) {
      // Set the expanded sector bar
      this.expandedSectorBar = this.pendingExpandSector;
      // Re-render the sector chart to show expanded state
      const combined = this.lastCombinedData || this.calculateCombinedAllocations();
      this.renderBarChart(this.sectorChart, combined.byCategory, combined.combinedTotal, combined.baselineByCategory, combined.baselineTotal, 'sector');
      this.pendingExpandSector = null;
    }

    if (this.pendingExpandCountry) {
      // Set the expanded country bar
      this.expandedCountryBar = this.pendingExpandCountry;
      // Re-render the country chart to show expanded state
      const combined = this.lastCombinedData || this.calculateCombinedAllocations();
      this.renderBarChart(this.countryChart, combined.byCountry, combined.combinedTotal, combined.baselineByCountry, combined.baselineTotal, 'country');
      this.pendingExpandCountry = null;
    }
  }

  calculateCombinedAllocations() {
    const byCountry = {};
    const byCategory = {};
    const baselineByCountry = {};
    const baselineByCategory = {};

    // Add portfolio baseline data
    const portfolioTotal = this.portfolioData?.total_value || 0;

    if (this.portfolioData) {
      // Store baseline for delta calculations (normalize labels to lowercase)
      (this.portfolioData.countries || []).forEach(c => {
        const normalizedName = (c.name || 'unknown').toLowerCase().trim();
        baselineByCountry[normalizedName] = (baselineByCountry[normalizedName] || 0) + c.value;
        byCountry[normalizedName] = (byCountry[normalizedName] || 0) + c.value;
      });

      (this.portfolioData.sectors || []).forEach(c => {
        const normalizedName = (c.name || 'unknown').toLowerCase().trim();
        baselineByCategory[normalizedName] = (baselineByCategory[normalizedName] || 0) + c.value;
        byCategory[normalizedName] = (byCategory[normalizedName] || 0) + c.value;
      });
    }

    // Add simulated items (only those matching selected portfolio when in portfolio scope)
    let simulatedTotal = 0;
    this.items.forEach(item => {
      // Skip items that don't match the selected portfolio (when in portfolio scope)
      if (this.scope === 'portfolio' && this.portfolioId) {
        if (item.portfolio_id !== this.portfolioId) {
          return; // Skip this item - not assigned to selected portfolio
        }
      }

      const value = parseFloat(item.value) || 0;
      simulatedTotal += value;

      // Country aggregation (normalize to lowercase)
      const country = item.country === '—' || !item.country ? 'unknown' : item.country.toLowerCase();
      byCountry[country] = (byCountry[country] || 0) + value;

      // Sector aggregation (normalize to lowercase)
      const sector = item.sector === '—' || !item.sector ? 'unknown' : item.sector.toLowerCase();
      byCategory[sector] = (byCategory[sector] || 0) + value;
    });

    const combinedTotal = portfolioTotal + simulatedTotal;

    return {
      byCountry,
      byCategory,
      baselineByCountry,
      baselineByCategory,
      combinedTotal,
      baselineTotal: portfolioTotal,
      simulatedTotal
    };
  }

  renderBarChart(container, data, total, baseline, baselineTotal, chartType) {
    if (total === 0 || Object.keys(data).length === 0) {
      container.innerHTML = '<div class="chart-empty">No data to display</div>';
      return;
    }

    // Sort by value descending
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1]);

    // Determine which bar is currently expanded for this chart type
    const expandedLabel = chartType === 'country' ? this.expandedCountryBar : this.expandedSectorBar;

    container.innerHTML = sorted.map(([label, value]) => {
      const percentage = (value / total * 100).toFixed(1);
      const isUnknown = label === 'unknown';
      const isExpanded = label === expandedLabel;

      // Calculate delta from baseline
      const baselineValue = baseline?.[label] || 0;
      const baselinePercentage = baselineTotal > 0 ? (baselineValue / baselineTotal * 100) : 0;
      const deltaPercentage = parseFloat(percentage) - baselinePercentage;

      let deltaHtml = '';
      if (Math.abs(deltaPercentage) >= 0.1) {
        const deltaClass = deltaPercentage > 0 ? 'delta-positive' : 'delta-negative';
        const deltaSign = deltaPercentage > 0 ? '+' : '';
        deltaHtml = `<span class="delta-indicator ${deltaClass}">(${deltaSign}${deltaPercentage.toFixed(1)}%)</span>`;
      }

      // Generate position details if expanded
      const positionDetailsHtml = isExpanded ? this.renderPositionDetails(chartType, label, total) : '';

      return `
        <div class="chart-bar-item ${isExpanded ? 'chart-bar-expanded' : ''}"
             data-chart-type="${chartType}"
             data-label="${this.escapeHtml(label)}"
             title="${label}: €${this.formatValue(value)} (${percentage}%)">
          <div class="bar-label">
            <span class="bar-expand-icon">${isExpanded ? '▼' : '▶'}</span>
            ${this.escapeHtml(label)}
          </div>
          <div class="bar-track">
            <div class="bar-fill ${isUnknown ? 'bar-fill-unknown' : ''}"
                 style="width: ${percentage}%"></div>
          </div>
          <div class="bar-percentage">${percentage}% ${deltaHtml}</div>
        </div>
        ${positionDetailsHtml}
      `;
    }).join('');

    // Bind click events to chart bars
    this.bindChartBarEvents(container, chartType);
  }

  // ============================================================================
  // Chart Bar Click Handlers
  // ============================================================================

  bindChartBarEvents(container, chartType) {
    const barItems = container.querySelectorAll('.chart-bar-item');
    barItems.forEach(barItem => {
      barItem.addEventListener('click', (e) => {
        const label = barItem.dataset.label;
        this.togglePositionDetails(chartType, label);
      });
    });
  }

  togglePositionDetails(chartType, label) {
    if (chartType === 'country') {
      // Toggle: if clicking same bar, collapse; otherwise expand new one
      if (this.expandedCountryBar === label) {
        this.expandedCountryBar = null;
      } else {
        this.expandedCountryBar = label;
      }
    } else if (chartType === 'sector') {
      if (this.expandedSectorBar === label) {
        this.expandedSectorBar = null;
      } else {
        this.expandedSectorBar = label;
      }
    }

    // Re-render the chart to reflect expansion state
    const combined = this.lastCombinedData || this.calculateCombinedAllocations();
    if (chartType === 'country') {
      this.renderBarChart(this.countryChart, combined.byCountry, combined.combinedTotal, combined.baselineByCountry, combined.baselineTotal, 'country');
    } else {
      this.renderBarChart(this.sectorChart, combined.byCategory, combined.combinedTotal, combined.baselineByCategory, combined.baselineTotal, 'sector');
    }
  }

  /**
   * Calculate the global total from all portfolios
   * Used for global % calculation even when in portfolio scope
   */
  getGlobalTotal() {
    // Sum up all portfolio values
    const portfolioSum = this.portfolios.reduce((sum, p) => sum + (parseFloat(p.total_value) || 0), 0);
    // Add simulated items (all of them, regardless of portfolio assignment)
    const simulatedSum = this.items.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
    return portfolioSum + simulatedSum;
  }

  renderPositionDetails(chartType, label, totalValue) {
    // Get all positions (portfolio + simulated) that match the label
    const positions = this.getPositionsForLabel(chartType, label);

    if (positions.length === 0) {
      return `
        <div class="position-details-panel">
          <div class="position-details-empty">No positions found</div>
        </div>
      `;
    }

    // Sort positions by value descending
    positions.sort((a, b) => b.value - a.value);

    // Calculate segment total for percentage within segment
    const segmentTotal = positions.reduce((sum, p) => sum + p.value, 0);

    // Calculate totals for multi-level percentages
    const portfolioTotal = totalValue; // Combined total for current scope (portfolio + simulated)
    const globalTotal = this.getGlobalTotal(); // All portfolios combined + all simulated

    // Determine which columns to show based on scope
    // Global scope: segment % + global % (portfolio % would be redundant)
    // Portfolio scope: segment % + portfolio % + global %
    const isGlobalScope = this.scope === 'global';

    const positionRows = positions.map(pos => {
      const percentOfSegment = segmentTotal > 0 ? ((pos.value / segmentTotal) * 100).toFixed(1) : '0.0';
      const percentOfPortfolio = portfolioTotal > 0 ? ((pos.value / portfolioTotal) * 100).toFixed(1) : '0.0';
      const percentOfGlobal = globalTotal > 0 ? ((pos.value / globalTotal) * 100).toFixed(1) : '0.0';

      // Add visual distinction for simulated items
      const isSimulated = pos.source === 'simulated';
      const simulatedClass = isSimulated ? 'position-simulated' : '';
      const simulatedBadge = isSimulated ? '<span class="simulated-badge">+ Simulated</span>' : '';
      const tickerDisplay = isSimulated
        ? `${simulatedBadge}`
        : `${this.escapeHtml(pos.ticker || '—')}`;

      if (isGlobalScope) {
        // 2 columns: segment % (bold) + global % (smallest)
        return `
          <div class="position-detail-row position-detail-row-2col ${simulatedClass}">
            <span class="position-detail-ticker">${tickerDisplay}</span>
            <span class="position-detail-name">${this.escapeHtml(pos.name || '—')}</span>
            <span class="position-detail-value sensitive-value">€${this.formatValue(pos.value)}</span>
            <span class="position-detail-percent position-detail-percent-seg">${percentOfSegment}%</span>
            <span class="position-detail-percent position-detail-percent-glob">${percentOfGlobal}%</span>
          </div>
        `;
      } else {
        // 3 columns: segment % (bold) + portfolio % (muted) + global % (smallest)
        return `
          <div class="position-detail-row position-detail-row-3col ${simulatedClass}">
            <span class="position-detail-ticker">${tickerDisplay}</span>
            <span class="position-detail-name">${this.escapeHtml(pos.name || '—')}</span>
            <span class="position-detail-value sensitive-value">€${this.formatValue(pos.value)}</span>
            <span class="position-detail-percent position-detail-percent-seg">${percentOfSegment}%</span>
            <span class="position-detail-percent position-detail-percent-port">${percentOfPortfolio}%</span>
            <span class="position-detail-percent position-detail-percent-glob">${percentOfGlobal}%</span>
          </div>
        `;
      }
    }).join('');

    return `
      <div class="position-details-panel">
        <div class="position-details-header">
          <span class="position-details-count">${positions.length} position${positions.length !== 1 ? 's' : ''}</span>
          <span class="position-details-total sensitive-value">€${this.formatValue(segmentTotal)}</span>
        </div>
        <div class="position-details-list">
          ${positionRows}
        </div>
      </div>
    `;
  }

  getPositionsForLabel(chartType, label) {
    const positions = [];
    const normalizedLabel = label.toLowerCase().trim();

    // Add portfolio positions
    if (this.portfolioData && this.portfolioData.positions) {
      this.portfolioData.positions.forEach(pos => {
        const matchField = chartType === 'country' ? pos.country : pos.sector;
        const normalizedField = (matchField || 'unknown').toLowerCase().trim();

        if (normalizedField === normalizedLabel) {
          positions.push({
            ticker: pos.ticker || pos.identifier || '—',
            name: pos.name || '—',
            value: pos.value || 0,
            source: 'portfolio'
          });
        }
      });
    }

    // Add simulated items (respecting portfolio scope)
    this.items.forEach(item => {
      // Skip items that don't match the selected portfolio (when in portfolio scope)
      if (this.scope === 'portfolio' && this.portfolioId) {
        if (item.portfolio_id !== this.portfolioId) {
          return;
        }
      }

      const matchField = chartType === 'country' ? item.country : item.sector;
      const normalizedField = (matchField === '—' || !matchField) ? 'unknown' : matchField.toLowerCase().trim();

      if (normalizedField === normalizedLabel) {
        positions.push({
          ticker: item.ticker || '—',
          name: item.name || '—',
          value: parseFloat(item.value) || 0,
          source: 'simulated'
        });
      }
    });

    return positions;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  // ============================================================================
  // Combobox Functionality
  // ============================================================================

  initCombobox(wrapper, input, type) {
    if (!wrapper || !input) return;

    const toggle = wrapper.querySelector('.combobox-toggle');
    const dropdown = wrapper.querySelector('.combobox-dropdown');

    // Toggle dropdown on button click
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleComboboxDropdown(wrapper, type);
      });
    }

    // Filter on input
    input.addEventListener('input', () => {
      this.populateComboboxDropdown(dropdown, type, input.value);
      dropdown.classList.add('show');
    });

    // Show dropdown on focus
    input.addEventListener('focus', () => {
      this.populateComboboxDropdown(dropdown, type, input.value);
      dropdown.classList.add('show');
    });

    // Hide dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });

    // Handle keyboard navigation
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.classList.remove('show');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstOption = dropdown.querySelector('.combobox-option');
        if (firstOption) firstOption.focus();
      }
    });

    // Handle option selection via event delegation
    dropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.combobox-option');
      if (option) {
        input.value = option.dataset.value;
        dropdown.classList.remove('show');
        input.focus();
      }
    });
  }

  toggleComboboxDropdown(wrapper, type) {
    const dropdown = wrapper.querySelector('.combobox-dropdown');
    const input = wrapper.querySelector('.combobox-input');
    const isVisible = dropdown.classList.contains('show');

    if (isVisible) {
      dropdown.classList.remove('show');
    } else {
      this.populateComboboxDropdown(dropdown, type, input.value);
      dropdown.classList.add('show');
    }
  }

  populateComboboxDropdown(dropdown, type, filter = '') {
    if (!this.portfolioData) {
      dropdown.innerHTML = '<div class="combobox-empty">Loading portfolio data...</div>';
      return;
    }

    const sourceData = type === 'sector'
      ? this.portfolioData.sectors || []
      : this.portfolioData.countries || [];

    const totalValue = this.portfolioData.total_value || 0;
    const filterLower = filter.toLowerCase().trim();

    // Sort by value (largest first) and filter
    const filtered = sourceData
      .filter(item => {
        if (!filterLower) return true;
        return (item.name || '').toLowerCase().includes(filterLower);
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    if (filtered.length === 0) {
      dropdown.innerHTML = filterLower
        ? `<div class="combobox-empty">No matches. Press Enter to add "${this.escapeHtml(filter)}"</div>`
        : '<div class="combobox-empty">No existing data</div>';
      return;
    }

    dropdown.innerHTML = filtered.map(item => {
      const name = item.name || 'Unknown';
      const value = item.value || 0;
      const percent = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : '0.0';

      return `
        <div class="combobox-option" data-value="${this.escapeHtml(name.toLowerCase())}" tabindex="-1">
          <span class="combobox-option-name">${this.escapeHtml(name)}</span>
          <span class="combobox-option-percent">${percent}%</span>
        </div>
      `;
    }).join('');
  }

  // ============================================================================
  // Percentage Mode Calculation
  // ============================================================================

  /**
   * Get baseline value and total for an item based on its sector/country
   * Used for percentage target calculations
   */
  getBaselineForItem(item) {
    const portfolioTotal = this.portfolioData?.total_value || 0;
    let baselineValue = 0;

    // Determine which baseline to use based on item source
    if (item.source === 'sector' && item.sector && item.sector !== '—') {
      const normalizedSector = item.sector.toLowerCase();
      const sectorData = (this.portfolioData?.sectors || [])
        .find(c => (c.name || '').toLowerCase() === normalizedSector);
      baselineValue = sectorData?.value || 0;
    } else if (item.source === 'country' && item.country && item.country !== '—') {
      const normalizedCountry = item.country.toLowerCase();
      const countryData = (this.portfolioData?.countries || [])
        .find(c => (c.name || '').toLowerCase() === normalizedCountry);
      baselineValue = countryData?.value || 0;
    } else if (item.source === 'ticker') {
      // For ticker items, the baseline is the existing value in portfolio if exists
      if (item.existsInPortfolio && item.portfolioData) {
        baselineValue = item.portfolioData.value || 0;
      }
    }

    return { baselineValue, baselineTotal: portfolioTotal };
  }

  /**
   * Calculate the € amount needed to achieve a target percentage allocation
   *
   * Formula:
   * Let X = amount to add
   * (baseline + X) / (total + X) = targetPercent / 100
   *
   * Solving for X:
   * baseline + X = (targetPercent / 100) * (total + X)
   * baseline + X = (targetPercent / 100) * total + (targetPercent / 100) * X
   * X - (targetPercent / 100) * X = (targetPercent / 100) * total - baseline
   * X * (1 - targetPercent / 100) = (targetPercent / 100) * total - baseline
   * X = ((targetPercent / 100) * total - baseline) / (1 - targetPercent / 100)
   */
  recalculatePercentageItem(item) {
    if (item.valueMode !== 'percentage' || !item.targetPercent) {
      return;
    }

    const targetPercent = item.targetPercent;
    const { baselineValue, baselineTotal } = this.getBaselineForItem(item);

    // Edge cases
    if (targetPercent >= 100) {
      item.targetWarning = 'Target cannot be 100% or more';
      item.value = 0;
      return;
    }

    if (targetPercent <= 0) {
      item.targetWarning = null;
      item.value = 0;
      return;
    }

    // Current percentage (before adding anything)
    const currentPercent = baselineTotal > 0 ? (baselineValue / baselineTotal) * 100 : 0;

    if (targetPercent <= currentPercent && baselineValue > 0) {
      item.targetWarning = `Already at ${currentPercent.toFixed(1)}%, can't add to reach ${targetPercent}%`;
      item.value = 0;
      return;
    }

    // Calculate required addition
    const targetFraction = targetPercent / 100;
    const numerator = (targetFraction * baselineTotal) - baselineValue;
    const denominator = 1 - targetFraction;

    if (denominator <= 0) {
      item.targetWarning = 'Invalid target percentage';
      item.value = 0;
      return;
    }

    const requiredAddition = numerator / denominator;

    if (requiredAddition < 0) {
      item.targetWarning = `Would need to remove €${this.formatValue(Math.abs(requiredAddition))}`;
      item.value = 0;
      return;
    }

    item.targetWarning = null;
    item.value = Math.round(requiredAddition * 100) / 100;
  }

  /**
   * Recalculate all percentage-based items
   * Called when portfolio baseline changes
   */
  recalculateAllPercentageItems() {
    this.items.forEach(item => {
      if (item.valueMode === 'percentage') {
        this.recalculatePercentageItem(item);
      }
    });
  }

  formatValue(value) {
    const num = parseFloat(value) || 0;
    // Round to 2 decimal places for consistency with parser
    const rounded = Math.round(num * 100) / 100;
    return rounded.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  parseValue(str) {
    if (!str) return 0;
    // Remove currency symbols, spaces, and handle European format (1.000,50 -> 1000.50)
    const cleaned = str.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    // Clamp to valid range: 0 to 999,999,999 (reasonable portfolio limit)
    const clamped = Math.min(Math.max(0, num), 999999999);
    // Round to 2 decimal places for consistency
    return Math.round(clamped * 100) / 100;
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `simulator-toast simulator-toast-${type}`;
    const iconMap = {
      danger: 'exclamation-circle',
      warning: 'exclamation-triangle',
      success: 'check-circle',
      info: 'info-circle'
    };
    toast.innerHTML = `
      <i class="fas fa-${iconMap[type] || 'info-circle'}"></i>
      <span>${message}</span>
    `;

    // Add to page
    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after delay
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize when DOM is ready (will be called from allocate.js or inline)
window.AllocationSimulator = AllocationSimulator;
