/**
 * Allocation Simulator - Combined View
 *
 * Shows combined portfolio allocation (existing + simulated additions)
 * with real-time percentage breakdowns by country and category.
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

    // Settings
    this.scope = 'global';             // 'global' or 'portfolio'
    this.portfolioId = null;           // Selected portfolio ID (if scope='portfolio')

    // DOM references (will be set after render)
    this.tableBody = null;
    this.countryChart = null;
    this.categoryChart = null;

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

  // Normalize category/country labels to lowercase for consistent matching
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
        this.updateCharts();
      } else {
        console.error('Failed to load portfolio allocations:', result.error);
        this.portfolioData = { countries: [], categories: [], positions: [], total_value: 0 };
        this.updateCharts();
      }
    } catch (error) {
      console.error('Error loading portfolio allocations:', error);
      this.portfolioData = { countries: [], categories: [], positions: [], total_value: 0 };
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

  async saveSimulation() {
    const modal = document.getElementById('save-simulation-modal');
    const nameInput = document.getElementById('simulation-name-input');

    // Pre-fill with current name if editing
    if (this.currentSimulationName) {
      nameInput.value = this.currentSimulationName;
    } else {
      nameInput.value = '';
    }

    modal.style.display = 'flex';
    nameInput.focus();
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
      if (this.currentSimulationId) {
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
            <button class="btn btn-primary btn-sm" id="simulator-add-ticker-btn">
              <span class="btn-text">Add</span>
              <span class="btn-spinner" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i>
              </span>
            </button>
          </div>
        </div>
        <div class="simulator-input-form">
          <label class="label">Add Category</label>
          <div class="input-row">
            <input type="text" class="input" id="simulator-category-input"
                   placeholder="e.g., Healthcare">
            <button class="btn btn-primary btn-sm" id="simulator-add-category-btn">Add</button>
          </div>
        </div>
        <div class="simulator-input-form">
          <label class="label">Add Country</label>
          <div class="input-row">
            <input type="text" class="input" id="simulator-country-input"
                   placeholder="e.g., Germany">
            <button class="btn btn-primary btn-sm" id="simulator-add-country-btn">Add</button>
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
              <th class="col-category">Category</th>
              <th class="col-country">Country</th>
              <th class="col-value">Value (€)</th>
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

      <!-- Combined View Header -->
      <div class="combined-view-header" id="combined-view-header">
        <div class="combined-view-title" id="combined-view-title">
          Current Portfolio Allocation
        </div>
        <div class="combined-view-total" id="combined-view-total">
          €0
        </div>
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
              Distribution by Category
            </h4>
          </div>
          <div class="chart-content" id="simulator-category-chart">
            <div class="chart-empty">Loading portfolio data...</div>
          </div>
        </div>
      </div>
    `;

    // Store DOM references
    this.tableBody = document.getElementById('simulator-table-body');
    this.countryChart = document.getElementById('simulator-country-chart');
    this.categoryChart = document.getElementById('simulator-category-chart');
  }

  bindEvents() {
    // Add Ticker
    const tickerInput = document.getElementById('simulator-ticker-input');
    const tickerBtn = document.getElementById('simulator-add-ticker-btn');

    tickerBtn.addEventListener('click', () => this.handleAddTicker());
    tickerInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAddTicker();
    });

    // Add Category
    const categoryInput = document.getElementById('simulator-category-input');
    const categoryBtn = document.getElementById('simulator-add-category-btn');

    categoryBtn.addEventListener('click', () => this.handleAddCategory());
    categoryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAddCategory();
    });

    // Add Country
    const countryInput = document.getElementById('simulator-country-input');
    const countryBtn = document.getElementById('simulator-add-country-btn');

    countryBtn.addEventListener('click', () => this.handleAddCountry());
    countryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAddCountry();
    });

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
          category: this.normalizeLabel(data.category) || '—',
          country: this.normalizeLabel(data.country) || '—',
          value: 0,
          source: 'ticker',
          name: data.name,
          existsInPortfolio: data.existsInPortfolio || false,
          portfolioData: data.portfolioData || null,
          portfolio_id: null
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

  handleAddCategory() {
    const input = document.getElementById('simulator-category-input');
    const category = input.value.trim();

    if (!category) {
      this.showToast('Please enter a category name', 'warning');
      return;
    }

    this.addItem({
      id: this.generateId(),
      ticker: '—',
      category: this.normalizeLabel(category),
      country: '—',
      value: 0,
      source: 'category',
      portfolio_id: null
    });
    input.value = '';
  }

  handleAddCountry() {
    const input = document.getElementById('simulator-country-input');
    const country = input.value.trim();

    if (!country) {
      this.showToast('Please enter a country name', 'warning');
      return;
    }

    this.addItem({
      id: this.generateId(),
      ticker: '—',
      category: '—',
      country: this.normalizeLabel(country),
      value: 0,
      source: 'country',
      portfolio_id: null
    });
    input.value = '';
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

    this.tableBody.innerHTML = this.items.map(item => `
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
        <td class="col-category">
          <input type="text" class="editable-cell category-input" value="${this.escapeHtml(item.category === '—' ? item.category : (item.category || '').toLowerCase())}"
                 data-field="category" placeholder="—">
        </td>
        <td class="col-country">
          <input type="text" class="editable-cell country-input" value="${this.escapeHtml(item.country === '—' ? item.country : (item.country || '').toLowerCase())}"
                 data-field="country" placeholder="—">
        </td>
        <td class="col-value">
          <div class="value-input-wrapper">
            <span class="currency-symbol">€</span>
            <input type="text" class="editable-cell value-input" value="${this.formatValue(item.value)}"
                   data-field="value" placeholder="0">
          </div>
        </td>
        <td class="col-delete">
          <button class="btn-delete" title="Remove">
            <i class="fas fa-times"></i>
          </button>
        </td>
      </tr>
    `).join('');
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
    }
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
    // Convert category/country to lowercase as user types
    if (e.target.classList.contains('category-input') || e.target.classList.contains('country-input')) {
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
        // Temporarily update value for chart preview
        const newValue = this.parseValue(e.target.value);
        item.value = newValue;
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

    if (field === 'value') {
      // Parse numeric value
      value = this.parseValue(value);
      input.value = this.formatValue(value);
    } else if (field === 'portfolio_id') {
      // Parse portfolio_id as number or null
      value = value ? parseInt(value) : null;
    } else if (field === 'category' || field === 'country') {
      // Normalize category/country to lowercase
      if (value && value !== '—') {
        value = this.normalizeLabel(value);
        input.value = value;
      }
    }

    // Update if value is empty, set to placeholder
    if (value === '' && field !== 'value' && field !== 'portfolio_id') {
      value = '—';
      input.value = '—';
    }

    this.updateItem(id, field, value);

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
    this.renderBarChart(this.countryChart, combined.byCountry, combined.combinedTotal, combined.baselineByCountry, combined.baselineTotal);
    this.renderBarChart(this.categoryChart, combined.byCategory, combined.combinedTotal, combined.baselineByCategory, combined.baselineTotal);

    // Update header (use simulatedTotal from combined which respects portfolio filtering)
    const titleEl = document.getElementById('combined-view-title');
    const totalEl = document.getElementById('combined-view-total');

    if (titleEl) {
      titleEl.textContent = combined.simulatedTotal > 0
        ? 'Combined Allocation (Portfolio + Simulated)'
        : 'Current Portfolio Allocation';
    }

    if (totalEl) {
      totalEl.innerHTML = `€${this.formatValue(combined.combinedTotal)}`;
      if (combined.simulatedTotal > 0) {
        totalEl.innerHTML += ` <span class="delta-indicator delta-positive">(+€${this.formatValue(combined.simulatedTotal)})</span>`;
      }
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

      (this.portfolioData.categories || []).forEach(c => {
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

      // Category aggregation (normalize to lowercase)
      const category = item.category === '—' || !item.category ? 'unknown' : item.category.toLowerCase();
      byCategory[category] = (byCategory[category] || 0) + value;
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

  renderBarChart(container, data, total, baseline, baselineTotal) {
    if (total === 0 || Object.keys(data).length === 0) {
      container.innerHTML = '<div class="chart-empty">No data to display</div>';
      return;
    }

    // Sort by value descending
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1]);

    container.innerHTML = sorted.map(([label, value]) => {
      const percentage = (value / total * 100).toFixed(1);
      const isUnknown = label === 'unknown';

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

      return `
        <div class="chart-bar-item" title="${label}: €${this.formatValue(value)} (${percentage}%)">
          <div class="bar-label">${this.escapeHtml(label)}</div>
          <div class="bar-track">
            <div class="bar-fill ${isUnknown ? 'bar-fill-unknown' : ''}"
                 style="width: ${percentage}%"></div>
          </div>
          <div class="bar-percentage">${percentage}% ${deltaHtml}</div>
        </div>
      `;
    }).join('');
  }

  // ============================================================================
  // Utilities
  // ============================================================================

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
