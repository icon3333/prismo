/**
 * Allocation Simulator
 *
 * Shows portfolio allocation with simulated additions,
 * real-time percentage breakdowns by country and sector.
 * Supports saving/loading simulations and scope toggling.
 *
 * Two modes:
 * - Overlay: Simulated positions layered on top of real portfolio data
 * - Portfolio: Standalone simulated portfolio (no baseline)
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
    this.currentSimulationType = null; // Currently loaded simulation type
    this.currentClonedFromName = null; // Source portfolio name if cloned
    // Auto-save state
    this.autoSaveStatus = 'idle';       // 'idle' | 'saving' | 'saved' | 'error'
    this.autoSaveErrorCount = 0;
    this.autoSaveStatusTimeout = null;

    // Investment targets from Builder (for "Remaining to Invest" display)
    this.investmentTargets = null;     // Investment target data from Builder
    this.hasBuilderConfig = false;     // Whether Builder has been configured

    // Settings
    this.mode = 'overlay';             // 'overlay' or 'portfolio'
    this.scope = 'global';             // 'global' or 'portfolio'
    this.portfolioId = null;           // Selected portfolio ID (if scope='portfolio')

    // Sandbox total amount (portfolio mode only)
    this.totalAmount = 0;              // Total portfolio amount for % calculations

    // DOM references (will be set after render)
    this.tableBody = null;
    this.countryChart = null;
    this.sectorChart = null;

    // Category mode for sector chart (sector or thesis)
    this.categoryMode = 'thesis';     // 'sector' or 'thesis'

    // Expanded chart bar state (one at a time per chart type)
    this.expandedCountryBar = null;   // Label of expanded country bar
    this.expandedSectorBar = null;  // Label of expanded sector bar (also used for thesis)

    // Auto-expand tracking for newly added items
    this.pendingExpandSector = null;
    this.pendingExpandCountry = null;

    // Historical performance chart (sandbox mode only)
    this.historicalChartInstance = null;   // ApexCharts instance
    this.historicalDataCache = new Map();  // cache key → API response
    this.chartAbortController = null;     // AbortController for canceling
    this.currentChartPeriod = '5y';       // Selected period
    this.historicalChartMode = 'aggregate'; // 'aggregate' or 'detail'
    this.debouncedHistoricalUpdate = this.debounce(() => this.updateHistoricalChart(), 500);

    // Debounced chart update for real-time feedback
    this.debouncedChartUpdate = this.debounce(() => this.updateCharts(), 300);

    // Cancellable debounced auto-save (800ms after last change)
    this._autoSaveTimeoutId = null;
    this.debouncedAutoSave = () => {
      clearTimeout(this._autoSaveTimeoutId);
      this._autoSaveTimeoutId = setTimeout(() => this.autoSave(), 800);
    };

    // Deploy section state (DCA calculator)
    this.deployManualMode = false;
    this.deployLumpSum = 0;
    this.deployMonthly = 0;
    this.deployMonths = 1;
    this.deployManualItems = [];

    // Ticker autocomplete state
    this._tickerSearchTimeout = null;
    this._tickerDropdownVisible = false;

    // Initialize
    this.render();
    this.bindEvents();
    this.initialize();
  }

  async initialize() {
    await this.initializeScope();
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
  // State Persistence (localStorage)
  // ============================================================================

  saveState() {
    // Build state with per-mode simulation IDs
    const existing = this.loadState() || {};
    const modeKey = this.mode === 'portfolio' ? 'portfolioSimulationId' : 'overlaySimulationId';
    const state = {
      mode: this.mode,
      scope: this.scope,
      portfolioId: this.portfolioId,
      // Persist simulation ID for the current mode; preserve the other mode's ID
      overlaySimulationId: existing.overlaySimulationId || null,
      portfolioSimulationId: existing.portfolioSimulationId || null,
    };
    state[modeKey] = this.currentSimulationId;
    localStorage.setItem('simulator_state', JSON.stringify(state));
  }

  loadState() {
    try {
      const saved = localStorage.getItem('simulator_state');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error('Failed to load simulator state:', e);
      return null;
    }
  }

  // ============================================================================
  // Mode Management
  // ============================================================================

  isPortfolioMode() {
    return this.mode === 'portfolio';
  }

  switchMode(newMode) {
    if (newMode === this.mode) return;

    // Flush any pending auto-save before switching
    this.cancelPendingAutoSave();
    if (this.currentSimulationId) {
      this.autoSave();
    }

    // Save current mode's simulation ID before switching
    this.saveState();

    // Read the target mode's saved simulation ID
    const savedState = this.loadState();
    const targetSimId = newMode === 'portfolio'
      ? (savedState && savedState.portfolioSimulationId)
      : (savedState && savedState.overlaySimulationId);

    this.mode = newMode;

    // Reset simulation state
    this.currentSimulationId = null;
    this.currentSimulationName = null;
    this.currentSimulationType = null;
    this.currentClonedFromName = null;
    this.totalAmount = 0;
    this.items = [];
    this.setAutoSaveStatus('idle');

    // Cleanup historical chart
    if (this.historicalChartInstance) {
      this.historicalChartInstance.destroy();
      this.historicalChartInstance = null;
    }
    this.historicalDataCache.clear();

    // Update UI
    this.updateModeUI();
    this.updateSandboxControls();
    this.saveState();

    // Refresh dropdown (all simulations already loaded, no re-fetch needed)
    this.populateSimulationsDropdown();

    // Restore target mode's simulation if one was previously selected
    if (targetSimId) {
      const exists = this.savedSimulations.some(s => s.id === targetSimId);
      if (exists) {
        const select = document.getElementById('simulator-load-select');
        if (select) select.value = targetSimId;
        this.loadSimulationSilent(targetSimId);
        return; // loadSimulationSilent will handle rendering
      }
    }

    // No saved simulation for this mode — render empty state
    this.renderTable();
    this.updateCharts();
    this.updateInvestmentProgress();
  }

  updateModeUI() {
    // Update toggle buttons
    const toggle = document.getElementById('simulator-mode-toggle');
    if (toggle) {
      toggle.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === this.mode);
      });
    }

    // Show/hide portfolio scope dropdown (overlay mode only)
    const portfolioControl = document.getElementById('simulator-portfolio-control');
    if (portfolioControl) {
      portfolioControl.style.visibility = this.isPortfolioMode() ? 'hidden' : 'visible';
      portfolioControl.style.pointerEvents = this.isPortfolioMode() ? 'none' : 'auto';
    }

    // Show/hide clone button (portfolio mode only)
    const cloneBtn = document.getElementById('simulator-clone-btn');
    if (cloneBtn) {
      cloneBtn.style.visibility = this.isPortfolioMode() ? 'visible' : 'hidden';
      cloneBtn.style.pointerEvents = this.isPortfolioMode() ? 'auto' : 'none';
    }

    // Show/hide historical chart section (portfolio/sandbox mode only)
    if (this.historicalSection) {
      this.historicalSection.style.display = this.isPortfolioMode() ? '' : 'none';
    }

    // Update cloned-from label
    this.updateClonedFromLabel();

    // Update delete button visibility
    this.updateDeleteButtonVisibility();

    // Reset simulation dropdown
    const select = document.getElementById('simulator-load-select');
    if (select) select.value = '';
  }

  updateClonedFromLabel() {
    const label = document.getElementById('simulator-cloned-from');
    if (!label) return;

    if (this.currentClonedFromName && this.isPortfolioMode()) {
      label.innerHTML = `<i class="fas fa-link"></i> Cloned from: ${this.escapeHtml(this.currentClonedFromName)}`;
      label.style.display = 'inline-flex';
    } else {
      label.style.display = 'none';
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initializeScope() {
    // Load saved state from localStorage
    const savedState = this.loadState();

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

    // Restore saved state
    if (savedState) {
      if (savedState.mode && (savedState.mode === 'overlay' || savedState.mode === 'portfolio')) {
        this.mode = savedState.mode;
      }
      if (savedState.scope) {
        this.scope = savedState.scope;
      }
      if (savedState.portfolioId) {
        this.portfolioId = savedState.portfolioId;
      }
    }

    // For portfolio scope, also check global state (cross-page persistence)
    if (this.scope === 'portfolio' && typeof PortfolioState !== 'undefined') {
      const globalPortfolioId = await PortfolioState.getSelectedPortfolio();
      if (globalPortfolioId) {
        const numericId = parseInt(globalPortfolioId);
        if (!isNaN(numericId)) {
          this.portfolioId = numericId;
        }
      }
    }

    // Update UI to reflect restored state
    this.updateModeUI();
    this.updateScopeUI();

    // Bind portfolio select event (combined Global + portfolios dropdown)
    const portfolioSelect = document.getElementById('simulator-portfolio-select');
    if (portfolioSelect) {
      portfolioSelect.addEventListener('change', async () => {
        const value = portfolioSelect.value;
        if (value) {
          this.scope = 'portfolio';
          this.portfolioId = parseInt(value);
        } else {
          this.scope = 'global';
          this.portfolioId = null;
        }
        this.saveState();
        // Save to global state for cross-page persistence
        if (typeof PortfolioState !== 'undefined' && this.portfolioId) {
          await PortfolioState.setSelectedPortfolio(this.portfolioId);
        }
        await this.refreshPortfolios();
        await this.loadPortfolioAllocations();
      });
    }

    // Bind mode toggle
    const modeToggle = document.getElementById('simulator-mode-toggle');
    if (modeToggle) {
      modeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        this.switchMode(btn.dataset.mode);
      });
    }
  }

  populatePortfolioDropdown() {
    const select = document.getElementById('simulator-portfolio-select');
    if (!select) return;

    select.innerHTML = '<option value="">Global</option>';
    this.portfolios.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
  }

  async refreshPortfolios() {
    try {
      const response = await fetch('/portfolio/api/portfolios?include_ids=true&include_values=true');
      const result = await response.json();
      if (result && result.length > 0) {
        this.portfolios = result;
        // Preserve current selection
        const currentValue = this.portfolioId;
        this.populatePortfolioDropdown();
        // Restore selection
        const select = document.getElementById('simulator-portfolio-select');
        if (select && currentValue) {
          select.value = String(currentValue);
        }
      }
    } catch (error) {
      console.error('Failed to refresh portfolios:', error);
    }
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

        // Extract investment targets from Builder (for "Remaining to Invest" display)
        if (result.data.investmentTargets) {
          this.investmentTargets = result.data.investmentTargets;
          this.hasBuilderConfig = result.data.investmentTargets.hasBuilderConfig || false;
        } else {
          this.investmentTargets = null;
          this.hasBuilderConfig = false;
        }

        // Recalculate percentage-based items when baseline changes
        this.recalculateAllPercentageItems();
        this.renderTable();
        this.updateCharts();
        this.updateInvestmentProgress();
      } else {
        console.error('Failed to load portfolio allocations:', result.error);
        this.portfolioData = { countries: [], sectors: [], theses: [], positions: [], total_value: 0 };
        this.investmentTargets = null;
        this.hasBuilderConfig = false;
        this.recalculateAllPercentageItems();
        this.renderTable();
        this.updateCharts();
        this.updateInvestmentProgress();
      }
    } catch (error) {
      console.error('Error loading portfolio allocations:', error);
      this.portfolioData = { countries: [], sectors: [], theses: [], positions: [], total_value: 0 };
      this.investmentTargets = null;
      this.hasBuilderConfig = false;
      this.recalculateAllPercentageItems();
      this.renderTable();
      this.updateCharts();
      this.updateInvestmentProgress();
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

        // Restore saved simulation from localStorage (per-mode key)
        const savedState = this.loadState();
        if (savedState) {
          // Per-mode keys; fall back to legacy `simulationId` for backward compat
          const simId = this.mode === 'portfolio'
            ? (savedState.portfolioSimulationId || null)
            : (savedState.overlaySimulationId || savedState.simulationId || null);
          if (simId) {
            const exists = this.savedSimulations.some(s => s.id === simId);
            if (exists) {
              const select = document.getElementById('simulator-load-select');
              if (select) select.value = simId;
              await this.loadSimulationSilent(simId);
            }
          }
        }
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
      const typeLabel = sim.type === 'portfolio' ? '[Sandbox]' : '[Overlay]';
      option.textContent = `${sim.name}  ${typeLabel}`;
      select.appendChild(option);
    });

    // Update delete button visibility
    this.updateDeleteButtonVisibility();
  }

  updateDeleteButtonVisibility() {
    const hasSimulation = !!this.currentSimulationId;
    const deleteBtn = document.getElementById('simulator-delete-btn');
    if (deleteBtn) {
      deleteBtn.style.display = hasSimulation ? 'inline-flex' : 'none';
    }
    const renameBtn = document.getElementById('simulator-rename-btn');
    if (renameBtn) {
      renameBtn.style.display = hasSimulation ? 'inline-flex' : 'none';
    }
  }

  async loadSimulation(simulationId) {
    if (!simulationId) {
      // "New Simulation" selected - reset
      this.resetSimulation();
      return;
    }

    this.cancelPendingAutoSave();

    try {
      const response = await fetch(`/portfolio/api/simulator/simulations/${simulationId}`);
      const result = await response.json();

      if (result.success) {
        const simulation = result.data.simulation;

        // Auto-switch mode if simulation type doesn't match current mode
        const targetMode = simulation.type === 'portfolio' ? 'portfolio' : 'overlay';
        if (targetMode !== this.mode) {
          this.mode = targetMode;
          this.updateModeUI();
          this.updateSandboxControls();
          this.saveState();
        }

        this.currentSimulationId = simulation.id;
        this.currentSimulationName = simulation.name;
        this.currentSimulationType = simulation.type;
        this.currentClonedFromName = simulation.cloned_from_name;
        this.totalAmount = simulation.total_amount || 0;
        // Don't override scope/portfolioId - keep user's current selection
        this.items = simulation.items || [];

        // Restore deploy data
        this.loadDeployData(simulation);

        // Ensure all sandbox items have targetPercent derived if missing
        if (this.isPortfolioMode()) {
          this.ensureItemPercentages();
        }

        this.renderTable();
        this.updateSandboxControls();
        this.loadPortfolioAllocations();
        this.updateDeleteButtonVisibility();
        this.updateClonedFromLabel();
        this.saveState();

        this.showToast(`Loaded "${simulation.name}"`, 'success');
      } else {
        this.showToast(result.error || 'Failed to load simulation', 'danger');
      }
    } catch (error) {
      console.error('Error loading simulation:', error);
      this.showToast('Failed to load simulation', 'danger');
    }
  }

  // Silent version for auto-restore (no toast notifications)
  // Note: Does NOT override scope/portfolioId - keeps user's current selection from localStorage
  async loadSimulationSilent(simulationId) {
    if (!simulationId) return;

    this.cancelPendingAutoSave();

    try {
      const response = await fetch(`/portfolio/api/simulator/simulations/${simulationId}`);
      const result = await response.json();

      if (result.success) {
        const simulation = result.data.simulation;

        // Auto-switch mode if simulation type doesn't match current mode
        const targetMode = simulation.type === 'portfolio' ? 'portfolio' : 'overlay';
        if (targetMode !== this.mode) {
          this.mode = targetMode;
          this.updateModeUI();
          this.updateSandboxControls();
          this.saveState();
        }

        this.currentSimulationId = simulation.id;
        this.currentSimulationName = simulation.name;
        this.currentSimulationType = simulation.type;
        this.currentClonedFromName = simulation.cloned_from_name;
        this.totalAmount = simulation.total_amount || 0;
        // Don't override scope/portfolioId - keep user's current selection from localStorage
        this.items = simulation.items || [];

        // Restore deploy data
        this.loadDeployData(simulation);

        // Ensure all sandbox items have targetPercent derived if missing
        if (this.isPortfolioMode()) {
          this.ensureItemPercentages();
        }

        // Render table and load allocations (scope UI already set by initializeScope)
        this.renderTable();
        this.updateSandboxControls();
        this.loadPortfolioAllocations();
        this.updateDeleteButtonVisibility();
        this.updateClonedFromLabel();
      }
    } catch (error) {
      console.error('Error loading simulation:', error);
    }
  }

  resetSimulation() {
    this.cancelPendingAutoSave();
    this.setAutoSaveStatus('idle');
    this.currentSimulationId = null;
    this.currentSimulationName = null;
    this.currentSimulationType = null;
    this.currentClonedFromName = null;
    this.totalAmount = 0;
    this.items = [];
    this.resetDeployData();
    this.renderTable();
    this.updateSandboxControls();
    this.updateCharts();
    this.updateDeleteButtonVisibility();
    this.updateClonedFromLabel();
    this.saveState();

    // Reset load dropdown
    const select = document.getElementById('simulator-load-select');
    if (select) select.value = '';
  }

  updateScopeUI() {
    const portfolioSelect = document.getElementById('simulator-portfolio-select');
    if (!portfolioSelect) return;

    if (this.scope === 'portfolio' && this.portfolioId) {
      portfolioSelect.value = String(this.portfolioId);
    } else {
      portfolioSelect.value = '';
    }
  }

  /**
   * Save as a new simulation (creates a copy/fork)
   */
  saveAsSimulation() {
    this.isRenameMode = false;
    const modal = document.getElementById('save-simulation-modal');
    const nameInput = document.getElementById('simulation-name-input');
    modal.querySelector('.modal-title').textContent = 'Save Simulation';

    // Suggest name based on current simulation
    const suggestedName = this.currentSimulationName
      ? `Copy of ${this.currentSimulationName}`
      : '';

    nameInput.value = suggestedName;
    modal.style.display = 'flex';
    nameInput.focus();
    nameInput.select();
  }

  /**
   * Rename the currently loaded simulation
   */
  renameSimulation() {
    if (!this.currentSimulationId) return;
    this.isRenameMode = true;
    const modal = document.getElementById('save-simulation-modal');
    const nameInput = document.getElementById('simulation-name-input');
    modal.querySelector('.modal-title').textContent = 'Rename Simulation';

    nameInput.value = this.currentSimulationName || '';
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

    // Rename mode: PUT with name only
    if (this.isRenameMode) {
      try {
        const response = await fetch(`/portfolio/api/simulator/simulations/${this.currentSimulationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });

        const result = await response.json();

        if (result.success) {
          this.currentSimulationName = name;
          document.getElementById('save-simulation-modal').style.display = 'none';
          this.isRenameMode = false;

          await this.loadSavedSimulations();
          const select = document.getElementById('simulator-load-select');
          if (select) select.value = this.currentSimulationId;

          this.saveState();
          this.showToast(`Renamed to "${name}"`, 'success');
        } else {
          this.showToast(result.error || 'Failed to rename simulation', 'danger');
        }
      } catch (error) {
        console.error('Error renaming simulation:', error);
        this.showToast('Failed to rename simulation', 'danger');
      }
      return;
    }

    // Save As mode: create new simulation
    const simulationData = {
      name: name,
      scope: this.scope,
      portfolio_id: this.scope === 'portfolio' ? this.portfolioId : null,
      items: this.items,
      type: this.isPortfolioMode() ? 'portfolio' : 'overlay',
      global_value_mode: 'euro',
      total_amount: this.totalAmount,
      ...this.getDeployDataForSave()
    };

    try {
      // Always create a new simulation (auto-save handles updates)
      const response = await fetch('/portfolio/api/simulator/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simulationData)
      });

      const result = await response.json();

      if (result.success) {
        const simulation = result.data.simulation;
        this.currentSimulationId = simulation.id;
        this.currentSimulationName = simulation.name;
        this.currentSimulationType = simulation.type;

        // Close modal
        document.getElementById('save-simulation-modal').style.display = 'none';

        // Refresh simulations list
        await this.loadSavedSimulations();

        // Update dropdown selection
        const select = document.getElementById('simulator-load-select');
        if (select) select.value = simulation.id;

        this.updateDeleteButtonVisibility();
        this.saveState();
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
  // Clone Portfolio
  // ============================================================================

  openCloneModal() {
    const modal = document.getElementById('clone-portfolio-modal');
    const select = document.getElementById('clone-portfolio-select');
    const nameInput = document.getElementById('clone-name-input');

    // Populate portfolio dropdown
    select.innerHTML = '';
    this.portfolios.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });

    // Pre-fill name
    if (this.portfolios.length > 0) {
      nameInput.value = `Clone of ${this.portfolios[0].name}`;
    }

    // Update name when portfolio selection changes
    select.onchange = () => {
      const selected = this.portfolios.find(p => p.id == select.value);
      if (selected) {
        nameInput.value = `Clone of ${selected.name}`;
      }
    };

    modal.style.display = 'flex';
    nameInput.focus();
    nameInput.select();
  }

  async confirmClonePortfolio() {
    const select = document.getElementById('clone-portfolio-select');
    const nameInput = document.getElementById('clone-name-input');
    const confirmBtn = document.getElementById('clone-portfolio-confirm');
    const zeroValues = document.querySelector('input[name="clone-values"]:checked')?.value === 'zeroed';

    const portfolioId = parseInt(select.value);
    const name = nameInput.value.trim();

    if (!portfolioId) {
      this.showToast('Please select a portfolio', 'warning');
      return;
    }
    if (!name) {
      this.showToast('Please enter a simulation name', 'warning');
      return;
    }

    // Show loading state
    confirmBtn.querySelector('.btn-text').style.display = 'none';
    confirmBtn.querySelector('.btn-spinner').style.display = 'inline';
    confirmBtn.disabled = true;

    try {
      const response = await fetch('/portfolio/api/simulator/clone-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          name: name,
          zero_values: zeroValues
        })
      });

      const result = await response.json();

      if (result.success) {
        const simulation = result.data.simulation;
        this.currentSimulationId = simulation.id;
        this.currentSimulationName = simulation.name;
        this.currentSimulationType = simulation.type;
        this.currentClonedFromName = simulation.cloned_from_name;
        this.items = simulation.items || [];

        // Derive targetPercent for cloned items
        if (this.isPortfolioMode()) {
          this.ensureItemPercentages();
        }

        // Close modal
        document.getElementById('clone-portfolio-modal').style.display = 'none';

        // Refresh simulations list
        await this.loadSavedSimulations();

        // Update dropdown selection
        const loadSelect = document.getElementById('simulator-load-select');
        if (loadSelect) loadSelect.value = simulation.id;

        this.renderTable();
        this.updateCharts();
        this.updateDeleteButtonVisibility();
        this.updateClonedFromLabel();
        this.saveState();

        const posCount = this.items.length;
        this.showToast(`Cloned "${simulation.cloned_from_name}" (${posCount} positions)`, 'success');
      } else {
        this.showToast(result.error || 'Failed to clone portfolio', 'danger');
      }
    } catch (error) {
      console.error('Error cloning portfolio:', error);
      this.showToast('Failed to clone portfolio', 'danger');
    } finally {
      confirmBtn.querySelector('.btn-text').style.display = 'inline';
      confirmBtn.querySelector('.btn-spinner').style.display = 'none';
      confirmBtn.disabled = false;
    }
  }

  // ============================================================================
  // Auto-Save
  // ============================================================================

  async autoSave() {
    if (!this.currentSimulationId) return;

    this.setAutoSaveStatus('saving');

    try {
      const response = await fetch(`/portfolio/api/simulator/simulations/${this.currentSimulationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: this.items,
          global_value_mode: 'euro',
          total_amount: this.totalAmount,
          ...this.getDeployDataForSave()
        })
      });

      const result = await response.json();

      if (result.success) {
        this.autoSaveErrorCount = 0;
        this.setAutoSaveStatus('saved');
      } else {
        this.autoSaveErrorCount++;
        this.setAutoSaveStatus('error');
        if (this.autoSaveErrorCount >= 3) {
          this.showToast('Auto-save failed repeatedly. Check your connection.', 'danger');
          this.autoSaveErrorCount = 0;
        }
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      this.autoSaveErrorCount++;
      this.setAutoSaveStatus('error');
      if (this.autoSaveErrorCount >= 3) {
        this.showToast('Auto-save failed repeatedly. Check your connection.', 'danger');
        this.autoSaveErrorCount = 0;
      }
    }
  }

  triggerAutoSave() {
    if (!this.currentSimulationId) return;
    this.debouncedAutoSave();
  }

  cancelPendingAutoSave() {
    clearTimeout(this._autoSaveTimeoutId);
  }

  setAutoSaveStatus(status) {
    this.autoSaveStatus = status;
    clearTimeout(this.autoSaveStatusTimeout);

    const el = document.getElementById('simulator-autosave-status');
    if (!el) return;

    el.classList.remove('autosave-saving', 'autosave-saved', 'autosave-error');

    if (status === 'idle') {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'inline-flex';
    el.style.opacity = '1';

    if (status === 'saving') {
      el.classList.add('autosave-saving');
      el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving';
    } else if (status === 'saved') {
      el.classList.add('autosave-saved');
      el.innerHTML = '<i class="fas fa-check"></i> Saved';
      this.autoSaveStatusTimeout = setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => { el.style.display = 'none'; }, 300);
      }, 2000);
    } else if (status === 'error') {
      el.classList.add('autosave-error');
      el.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Save failed';
      this.autoSaveStatusTimeout = setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => { el.style.display = 'none'; }, 300);
      }, 4000);
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  render() {
    const emptyStateMessage = 'Add positions to build a simulated portfolio.';
    const emptyStateIcon = 'fa-briefcase';

    this.container.innerHTML = `
      <!-- Input Forms -->
      <div class="simulator-input-forms">
        <div class="simulator-input-form">
          <label class="label">Add Identifier</label>
          <div class="input-row" style="position: relative;">
            <input type="text" class="input" id="simulator-ticker-input"
                   placeholder="e.g., AAPL, MSFT" autocomplete="off">
            <button class="button is-small" id="simulator-add-ticker-btn">
              <span class="btn-text">Add</span>
              <span class="btn-spinner" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i>
              </span>
            </button>
            <div class="ticker-autocomplete-dropdown" id="simulator-ticker-dropdown"></div>
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
            <button class="button is-small" id="simulator-add-sector-btn">Add</button>
          </div>
        </div>
        <div class="simulator-input-form">
          <label class="label">Add Thesis</label>
          <div class="input-row">
            <div class="combobox-wrapper" id="simulator-thesis-combobox">
              <input type="text" class="input combobox-input" id="simulator-thesis-input"
                     placeholder="Select or type thesis..." autocomplete="off">
              <button class="combobox-toggle" type="button" tabindex="-1">
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="combobox-dropdown" id="simulator-thesis-dropdown"></div>
            </div>
            <button class="button is-small" id="simulator-add-thesis-btn">Add</button>
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
            <button class="button is-small" id="simulator-add-country-btn">Add</button>
          </div>
        </div>
      </div>

      <!-- Data Table -->
      <div class="table-responsive">
        <table class="table table-hover unified-table simulator-table">
          <thead id="simulator-table-head">
            <tr>
              <th class="col-ticker">Identifier</th>
              <th class="col-name">Name</th>
              <th class="col-portfolio">Portfolio</th>
              <th class="col-sector">Sector</th>
              <th class="col-thesis">Thesis</th>
              <th class="col-country">Country</th>
              <th class="col-value-eur">€</th>
              <th class="col-value-pct">% <span class="sandbox-allocation-summary" id="sandbox-allocation-summary"></span></th>
              <th class="col-delete"></th>
            </tr>
          </thead>
          <tbody id="simulator-table-body">
            <tr class="empty-state-row">
              <td colspan="9" class="empty-state">
                <i class="fas ${emptyStateIcon}"></i>
                <span>${emptyStateMessage}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Investment Progress (Remaining to Invest from Builder) - overlay mode only -->
      <div class="investment-progress-section" id="simulator-investment-progress">
        <div class="progress-loading">Loading investment targets...</div>
      </div>

      <!-- Aggregation Charts -->
      <div class="simulator-charts">
        <div class="simulator-chart-panel">
          <div class="simulator-chart-header">
            <h5 class="simulator-chart-label">Country Allocation</h5>
          </div>
          <div class="chart-content" id="simulator-country-chart">
            <div class="chart-empty">Loading portfolio data...</div>
          </div>
        </div>
        <div class="simulator-chart-panel">
          <div class="simulator-chart-header">
            <h5 class="simulator-chart-label" id="simulator-category-title">Thesis Allocation</h5>
            <div class="toggle-group" id="simulator-category-toggle">
              <button class="toggle-btn" data-mode="sector">Sector</button>
              <button class="toggle-btn active" data-mode="thesis">Thesis</button>
            </div>
          </div>
          <div class="chart-content" id="simulator-sector-chart">
            <div class="chart-empty">Loading portfolio data...</div>
          </div>
        </div>
      </div>

      <!-- Historical Performance Chart (sandbox mode only) -->
      <div class="simulator-historical-section" id="simulator-historical-section" style="display: none;">
        <div class="simulator-chart-header">
          <h5 class="simulator-chart-label"><i class="fas fa-chart-line"></i> Historical Performance</h5>
          <div class="simulator-historical-controls">
            <div class="toggle-group" id="simulator-chart-mode-toggle">
              <button class="toggle-btn active" data-mode="aggregate">Aggregate</button>
              <button class="toggle-btn" data-mode="detail">Detail</button>
            </div>
            <div class="toggle-group" id="simulator-period-toggle">
              <button class="toggle-btn" data-period="3y">3Y</button>
              <button class="toggle-btn active" data-period="5y">5Y</button>
              <button class="toggle-btn" data-period="10y">10Y</button>
              <button class="toggle-btn" data-period="max">MAX</button>
            </div>
          </div>
        </div>
        <div id="simulator-historical-chart" style="display: none;"></div>
        <div id="simulator-historical-loading" style="display: none;" class="chart-empty">
          <i class="fas fa-spinner fa-spin"></i>&nbsp; Loading historical data...
        </div>
        <div id="simulator-historical-empty" style="display: none;" class="chart-empty">
          Add positions with tickers to see historical performance.
        </div>
      </div>

      <!-- Deploy Section (DCA Calculator - sandbox mode only) -->
      <div id="simulator-deploy-section"></div>
    `;

    // Store DOM references
    this.tableBody = document.getElementById('simulator-table-body');
    this.countryChart = document.getElementById('simulator-country-chart');
    this.sectorChart = document.getElementById('simulator-sector-chart');
    this.investmentProgressContainer = document.getElementById('simulator-investment-progress');
    this.historicalSection = document.getElementById('simulator-historical-section');
    this.historicalChartEl = document.getElementById('simulator-historical-chart');
    this.deployContainer = document.getElementById('simulator-deploy-section');
  }

  bindEvents() {
    // Add Ticker
    const tickerInput = document.getElementById('simulator-ticker-input');
    const tickerBtn = document.getElementById('simulator-add-ticker-btn');

    if (tickerBtn && tickerInput) {
      tickerBtn.addEventListener('click', () => this.handleAddTicker());
      tickerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.hideTickerDropdown();
          this.handleAddTicker();
        }
      });
      // Ticker autocomplete
      tickerInput.addEventListener('input', () => this.handleTickerSearch());
      tickerInput.addEventListener('focus', () => {
        if (tickerInput.value.trim().length >= 2) {
          this.handleTickerSearch();
        }
      });
      // Hide dropdown on click outside
      document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('simulator-ticker-dropdown');
        const inputRow = tickerInput.closest('.input-row');
        if (dropdown && inputRow && !inputRow.contains(e.target)) {
          this.hideTickerDropdown();
        }
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

    // Add Thesis with combobox
    const thesisInput = document.getElementById('simulator-thesis-input');
    const thesisBtn = document.getElementById('simulator-add-thesis-btn');
    const thesisCombobox = document.getElementById('simulator-thesis-combobox');

    if (thesisBtn && thesisInput) {
      thesisBtn.addEventListener('click', () => this.handleAddThesis());
      thesisInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAddThesis();
      });
      this.initCombobox(thesisCombobox, thesisInput, 'thesis');
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

    // Sandbox total amount input (in header)
    const totalAmountInput = document.getElementById('sandbox-total-amount-input');
    if (totalAmountInput) {
      totalAmountInput.addEventListener('input', () => {
        const oldTotal = this.totalAmount;
        const newTotal = this.parseValue(totalAmountInput.value);
        this.totalAmount = newTotal;
        this.onTotalAmountChanged(oldTotal, newTotal);
        this.updateTableValues();
        this.debouncedChartUpdate();
        this.renderAllocationSummary();
        this.debouncedAutoSave();
      });
      totalAmountInput.addEventListener('blur', () => {
        totalAmountInput.value = this.totalAmount > 0 ? this.formatValue(this.totalAmount) : '';
      });
    }

    // Category toggle (sector/thesis)
    const categoryToggle = document.getElementById('simulator-category-toggle');
    if (categoryToggle) {
      categoryToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;

        const mode = btn.dataset.mode;
        if (mode === this.categoryMode) return; // No change

        // Update active state
        categoryToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update title
        const titleEl = document.getElementById('simulator-category-title');
        if (titleEl) {
          titleEl.textContent = mode === 'thesis' ? 'Thesis Allocation' : 'Sector Allocation';
        }

        // Update mode and re-render chart
        this.categoryMode = mode;
        this.expandedSectorBar = null; // Reset expanded bar when switching modes
        this.updateCharts();
      });
    }

    // Historical performance period toggle
    const periodToggle = document.getElementById('simulator-period-toggle');
    if (periodToggle) {
      periodToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;

        const period = btn.dataset.period;
        if (period === this.currentChartPeriod) return;

        periodToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.currentChartPeriod = period;
        this.updateHistoricalChart();
      });
    }

    // Historical chart mode toggle (aggregate vs detail)
    const chartModeToggle = document.getElementById('simulator-chart-mode-toggle');
    if (chartModeToggle) {
      chartModeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;

        const mode = btn.dataset.mode;
        if (mode === this.historicalChartMode) return;

        chartModeToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.historicalChartMode = mode;
        this.updateHistoricalChart();
      });
    }

    // Save/Load simulation events
    const loadSelect = document.getElementById('simulator-load-select');
    if (loadSelect) {
      loadSelect.addEventListener('change', () => this.loadSimulation(loadSelect.value));
    }

    const saveAsBtn = document.getElementById('simulator-saveas-btn');
    if (saveAsBtn) {
      saveAsBtn.addEventListener('click', () => this.saveAsSimulation());
    }

    const deleteBtn = document.getElementById('simulator-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteSimulation());
    }

    const renameBtn = document.getElementById('simulator-rename-btn');
    if (renameBtn) {
      renameBtn.addEventListener('click', () => this.renameSimulation());
    }

    // Clone button
    const cloneBtn = document.getElementById('simulator-clone-btn');
    if (cloneBtn) {
      cloneBtn.addEventListener('click', () => this.openCloneModal());
    }

    // Save modal events
    const saveConfirmBtn = document.getElementById('save-simulation-confirm');
    const saveCancelBtn = document.getElementById('save-simulation-cancel');
    const saveCloseBtn = document.getElementById('save-simulation-close');
    const saveModal = document.getElementById('save-simulation-modal');

    if (saveConfirmBtn) {
      saveConfirmBtn.addEventListener('click', () => this.confirmSaveSimulation());
    }

    const dismissSaveModal = () => {
      saveModal.style.display = 'none';
      this.isRenameMode = false;
    };

    if (saveCancelBtn) {
      saveCancelBtn.addEventListener('click', dismissSaveModal);
    }

    if (saveCloseBtn) {
      saveCloseBtn.addEventListener('click', dismissSaveModal);
    }

    // Close modal on overlay click
    if (saveModal) {
      saveModal.addEventListener('click', (e) => {
        if (e.target === saveModal) dismissSaveModal();
      });
    }

    // Enter key in save modal
    const nameInput = document.getElementById('simulation-name-input');
    if (nameInput) {
      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.confirmSaveSimulation();
      });
    }

    // Clone modal events
    const cloneConfirmBtn = document.getElementById('clone-portfolio-confirm');
    const cloneCancelBtn = document.getElementById('clone-portfolio-cancel');
    const cloneCloseBtn = document.getElementById('clone-portfolio-close');
    const cloneModal = document.getElementById('clone-portfolio-modal');

    if (cloneConfirmBtn) {
      cloneConfirmBtn.addEventListener('click', () => this.confirmClonePortfolio());
    }

    if (cloneCancelBtn) {
      cloneCancelBtn.addEventListener('click', () => {
        cloneModal.style.display = 'none';
      });
    }

    if (cloneCloseBtn) {
      cloneCloseBtn.addEventListener('click', () => {
        cloneModal.style.display = 'none';
      });
    }

    if (cloneModal) {
      cloneModal.addEventListener('click', (e) => {
        if (e.target === cloneModal) {
          cloneModal.style.display = 'none';
        }
      });
    }

    // Enter key in clone modal
    const cloneNameInput = document.getElementById('clone-name-input');
    if (cloneNameInput) {
      cloneNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.confirmClonePortfolio();
      });
    }
  }

  // ============================================================================
  // Ticker Autocomplete
  // ============================================================================

  handleTickerSearch() {
    const input = document.getElementById('simulator-ticker-input');
    const query = input.value.trim();

    clearTimeout(this._tickerSearchTimeout);

    if (query.length < 2) {
      this.hideTickerDropdown();
      return;
    }

    this._tickerSearchTimeout = setTimeout(() => this.fetchTickerSuggestions(query), 300);
  }

  async fetchTickerSuggestions(query) {
    try {
      const response = await fetch(`/portfolio/api/simulator/search-investments?q=${encodeURIComponent(query)}&limit=10`);
      const result = await response.json();

      if (result.success) {
        this.renderTickerDropdown(result.data.results);
      }
    } catch (error) {
      console.error('Ticker search error:', error);
    }
  }

  renderTickerDropdown(results) {
    const dropdown = document.getElementById('simulator-ticker-dropdown');
    if (!dropdown) return;

    if (results.length === 0) {
      dropdown.innerHTML = '<div class="ticker-autocomplete-empty">No matches — press Enter for yfinance lookup</div>';
      dropdown.classList.add('show');
      return;
    }

    dropdown.innerHTML = results.map(r => `
      <div class="ticker-autocomplete-option" data-identifier="${this.escapeHtml(r.identifier || '')}">
        <span class="ac-identifier">${this.escapeHtml(r.identifier || '—')}</span>
        <span class="ac-name">${this.escapeHtml(r.name)}</span>
        <span class="ac-portfolio">${this.escapeHtml(r.portfolio_name)}</span>
        <span class="ac-value sensitive-value">€${this.formatValue(r.value)}</span>
      </div>
    `).join('');

    // Bind click handlers
    dropdown.querySelectorAll('.ticker-autocomplete-option').forEach(option => {
      option.addEventListener('click', () => {
        const identifier = option.dataset.identifier;
        const input = document.getElementById('simulator-ticker-input');
        if (input && identifier) {
          input.value = identifier;
        }
        this.hideTickerDropdown();
        this.handleAddTicker();
      });
    });

    dropdown.classList.add('show');
  }

  hideTickerDropdown() {
    const dropdown = document.getElementById('simulator-ticker-dropdown');
    if (dropdown) {
      dropdown.classList.remove('show');
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
          thesis: this.normalizeLabel(data.thesis) || '—',
          country: this.normalizeLabel(data.country) || '—',
          value: 0,
          targetPercent: 0,
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
      thesis: '—',
      country: '—',
      value: 0,
      targetPercent: 0,
      source: 'sector',
      portfolio_id: (this.scope === 'portfolio' && this.portfolioId) ? this.portfolioId : null
    });
    input.value = '';

    // Hide dropdown
    const dropdown = document.getElementById('simulator-sector-dropdown');
    if (dropdown) dropdown.classList.remove('show');
  }

  handleAddThesis() {
    const input = document.getElementById('simulator-thesis-input');
    const thesis = input.value.trim();

    if (!thesis) {
      this.showToast('Please enter a thesis name', 'warning');
      return;
    }

    const normalizedThesis = this.normalizeLabel(thesis);

    // Set pending expand so the chart auto-expands this thesis (when in thesis mode)
    if (this.categoryMode === 'thesis') {
      this.pendingExpandSector = normalizedThesis;
    }

    this.addItem({
      id: this.generateId(),
      ticker: '—',
      sector: '—',
      thesis: normalizedThesis,
      country: '—',
      value: 0,
      targetPercent: 0,
      source: 'thesis',
      portfolio_id: (this.scope === 'portfolio' && this.portfolioId) ? this.portfolioId : null
    });
    input.value = '';

    // Hide dropdown
    const dropdown = document.getElementById('simulator-thesis-dropdown');
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
      thesis: '—',
      country: normalizedCountry,
      value: 0,
      targetPercent: 0,
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
    // In sandbox mode, new items start at 0 with targetPercent 0
    if (this.isPortfolioMode()) {
      item.targetPercent = item.targetPercent || 0;
    }
    this.items.push(item);
    this.renderTable();
    this.updateCharts();
    this.renderAllocationSummary();
    this.triggerAutoSave();

    // Focus the euro value input for the new row
    setTimeout(() => {
      const eurInput = this.tableBody.querySelector(`[data-id="${item.id}"] .value-eur-input`);
      if (eurInput) eurInput.focus();
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
      this.renderAllocationSummary();
      this.triggerAutoSave();
    }
  }

  generateId() {
    return 'sim_' + Math.random().toString(36).substr(2, 9);
  }

  // ============================================================================
  // Table Rendering
  // ============================================================================

  renderTable() {
    const isSandbox = this.isPortfolioMode();

    // Update table headers dynamically
    this.updateTableHeaders(isSandbox);

    if (this.items.length === 0) {
      const emptyStateMessage = 'Add positions to build a simulated portfolio.';
      const emptyStateIcon = 'fa-briefcase';
      this.tableBody.innerHTML = `
        <tr class="empty-state-row">
          <td colspan="9" class="empty-state">
            <i class="fas ${emptyStateIcon}"></i>
            <span>${emptyStateMessage}</span>
          </td>
        </tr>
      `;
      return;
    }

    this.tableBody.innerHTML = this.items.map(item => {
      // Common cells
      const tickerCell = item.source === 'ticker'
        ? `<div class="ticker-cell-stack"><span class="ticker-badge">${item.ticker}</span>${item.existsInPortfolio ? '<span class="existing-badge" title="Exists in portfolio"><i class="fas fa-check"></i> Existing</span>' : ''}</div>`
        : `<input type="text" class="editable-cell ticker-input" value="${this.escapeHtml(item.ticker)}"
                 data-field="ticker" placeholder="—">`;

      const commonCells = `
          <td class="col-ticker">${tickerCell}</td>
          <td class="col-name">
            <span class="name-display" title="${this.escapeHtml(item.name || '')}">${this.escapeHtml(item.name || '—')}</span>
          </td>
          <td class="col-portfolio">
            <select class="editable-cell portfolio-select" data-field="portfolio_id">
              ${this.portfolios.map(p =>
                `<option value="${p.id}" ${item.portfolio_id == p.id ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`
              ).join('')}
            </select>
          </td>
          <td class="col-sector">
            <input type="text" class="editable-cell sector-input${item.source === 'sector' ? ' source-highlight' : ''}" value="${this.escapeHtml(item.sector === '—' ? item.sector : (item.sector || '').toLowerCase())}"
                   data-field="sector" placeholder="—">
          </td>
          <td class="col-thesis">
            <input type="text" class="editable-cell thesis-input${item.source === 'thesis' ? ' source-highlight' : ''}" value="${this.escapeHtml(item.thesis === '—' ? item.thesis : (item.thesis || '').toLowerCase())}"
                   data-field="thesis" placeholder="—">
          </td>
          <td class="col-country">
            <input type="text" class="editable-cell country-input${item.source === 'country' ? ' source-highlight' : ''}" value="${this.escapeHtml(item.country === '—' ? item.country : (item.country || '').toLowerCase())}"
                   data-field="country" placeholder="—">
          </td>`;

      const warningHint = item.targetWarning
        ? `<span class="value-warning-hint" title="${this.escapeHtml(item.targetWarning)}"><i class="fas fa-exclamation-triangle"></i></span>`
        : '';

      return `
      <tr data-id="${item.id}">
        ${commonCells}
        <td class="col-value-eur">
          <input type="text" class="editable-cell value-input value-eur-input sensitive-value"
                 value="${this.formatValue(item.value)}"
                 data-field="value-eur" placeholder="0">
        </td>
        <td class="col-value-pct">
          <input type="text" class="editable-cell value-input value-pct-input"
                 value="${(item.targetPercent || 0).toFixed(1)}"
                 data-field="value-pct" placeholder="0">
          ${warningHint}
        </td>
        <td class="col-delete">
          <button class="btn-delete" title="Remove">
            <i class="fas fa-times"></i>
          </button>
        </td>
      </tr>`;
    }).join('');

    // Re-render deploy section (reacts to sandbox item changes)
    this.renderDeploySection();
  }

  updateTableHeaders() {
    // Headers are static in the HTML — no dynamic update needed
  }

  /**
   * Update value input fields in-place without rebuilding the table DOM.
   * Used when totalAmount changes to avoid expensive full re-render.
   */
  updateTableValues() {
    if (!this.tableBody) return;

    this.items.forEach(item => {
      const row = this.tableBody.querySelector(`[data-id="${item.id}"]`);
      if (!row) return;

      const eurInput = row.querySelector('.value-eur-input');
      if (eurInput && document.activeElement !== eurInput) {
        eurInput.value = this.formatValue(item.value);
      }

      const pctInput = row.querySelector('.value-pct-input');
      if (pctInput && document.activeElement !== pctInput) {
        pctInput.value = (item.targetPercent || 0).toFixed(1);
      }
    });
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
          if (field === 'value-eur') {
            e.target.value = this.formatValue(item.value);
          } else if (field === 'value-pct') {
            e.target.value = (item.targetPercent || 0).toFixed(1);
          } else {
            e.target.value = item[field];
          }
        }
        e.target.blur();
      }
    }
  }

  handleTableInput(e) {
    // Convert sector/thesis/country to lowercase as user types
    if (e.target.classList.contains('sector-input') ||
        e.target.classList.contains('thesis-input') ||
        e.target.classList.contains('country-input')) {
      const cursorPos = e.target.selectionStart;
      e.target.value = e.target.value.toLowerCase();
      e.target.setSelectionRange(cursorPos, cursorPos);
    }

    // Real-time chart updates with debounce (for value inputs)
    if (e.target.classList.contains('value-input')) {
      const row = e.target.closest('tr');
      if (!row) return;

      const id = row.dataset.id;
      const item = this.items.find(i => i.id === id);
      if (!item) return;

      const field = e.target.dataset.field;

      if (field === 'value-pct') {
        const cleanedValue = e.target.value.replace('%', '').trim();
        const percentValue = parseFloat(cleanedValue);
        if (!isNaN(percentValue)) {
          item.targetPercent = Math.min(Math.max(0, percentValue), 999);
          // Derive EUR from %
          if (this.isPortfolioMode()) {
            if (this.totalAmount > 0) {
              item.value = Math.round((item.targetPercent / 100) * this.totalAmount * 100) / 100;
            }
          } else {
            this.recalculatePercentageItem(item);
          }
          // Update EUR input in-place
          const eurInput = row.querySelector('.value-eur-input');
          if (eurInput && document.activeElement !== eurInput) {
            eurInput.value = this.formatValue(item.value);
          }
        }
      } else if (field === 'value-eur') {
        const newValue = this.parseValue(e.target.value);
        item.value = newValue;
        // Derive % from EUR
        const denominator = this.getPercentDenominator();
        if (denominator > 0) {
          item.targetPercent = parseFloat((newValue / denominator * 100).toFixed(1));
        }
        // Update % input in-place
        const pctInput = row.querySelector('.value-pct-input');
        if (pctInput && document.activeElement !== pctInput) {
          pctInput.value = (item.targetPercent || 0).toFixed(1);
        }
      }
      this.debouncedChartUpdate();
      this.renderAllocationSummary();
    }
  }

  saveCell(input) {
    const row = input.closest('tr');
    if (!row) return;

    const id = row.dataset.id;
    const field = input.dataset.field;
    let value = input.value.trim();
    const item = this.items.find(i => i.id === id);

    if (field === 'value-eur') {
      value = this.parseValue(value);
      input.value = this.formatValue(value);
      this.updateItem(id, 'value', value);

      // Derive % from EUR
      const denominator = this.getPercentDenominator();
      if (denominator > 0) {
        item.targetPercent = parseFloat((value / denominator * 100).toFixed(1));
      }

      // Update % input in-place
      const row = input.closest('tr');
      const pctInput = row ? row.querySelector('.value-pct-input') : null;
      if (pctInput && document.activeElement !== pctInput) {
        pctInput.value = (item.targetPercent || 0).toFixed(1);
      }
    } else if (field === 'value-pct') {
      const cleanedValue = value.replace('%', '').trim();
      const percentValue = parseFloat(cleanedValue);
      if (!isNaN(percentValue)) {
        item.targetPercent = Math.min(Math.max(0, percentValue), 999);
        input.value = item.targetPercent.toFixed(1);

        // Derive EUR from %
        if (this.isPortfolioMode()) {
          if (this.totalAmount > 0) {
            item.value = Math.round((item.targetPercent / 100) * this.totalAmount * 100) / 100;
          }
          // If totalAmount === 0, can't derive EUR — just store %
        } else {
          // Overlay: use existing recalculate logic
          this.recalculatePercentageItem(item);
        }

        // Update EUR input in-place
        const row = input.closest('tr');
        const eurInput = row ? row.querySelector('.value-eur-input') : null;
        if (eurInput && document.activeElement !== eurInput) {
          eurInput.value = this.formatValue(item.value);
        }
      }
    } else if (field === 'portfolio_id') {
      // Parse portfolio_id as number or null
      value = value ? parseInt(value) : null;
      this.updateItem(id, field, value);
    } else if (field === 'sector' || field === 'thesis' || field === 'country') {
      // Normalize sector/thesis/country to lowercase
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

      // If sector, thesis, or country changes in overlay mode, recalculate
      // (baseline depends on the dimension values)
      if (item && !this.isPortfolioMode()) {
        this.recalculatePercentageItem(item);
        // Update both inputs in-place
        const row = input.closest('tr');
        if (row) {
          const eurInput = row.querySelector('.value-eur-input');
          if (eurInput && document.activeElement !== eurInput) eurInput.value = this.formatValue(item.value);
          const pctInput = row.querySelector('.value-pct-input');
          if (pctInput && document.activeElement !== pctInput) pctInput.value = (item.targetPercent || 0).toFixed(1);
        }
      }
    } else {
      // Update if value is empty, set to placeholder
      if (value === '' && field !== 'value-eur' && field !== 'value-pct' && field !== 'portfolio_id') {
        value = '—';
        input.value = '—';
      }
      this.updateItem(id, field, value);
    }

    this.updateCharts();

    // Visual feedback
    input.classList.add('cell-saved');
    setTimeout(() => input.classList.remove('cell-saved'), 500);

    this.triggerAutoSave();
  }

  handleTableChange(e) {
    // Handle select element changes (e.g., portfolio dropdown)
    if (e.target.classList.contains('portfolio-select')) {
      this.saveCell(e.target);
      this.updateCharts();
    }
  }

  // ============================================================================
  // Investment Progress Display (Remaining to Invest from Builder)
  // ============================================================================

  updateInvestmentProgress() {
    const container = this.investmentProgressContainer;
    if (!container) return;

    // Hide investment progress in portfolio mode
    if (this.isPortfolioMode()) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    if (!this.hasBuilderConfig || !this.investmentTargets) {
      container.innerHTML = this.renderNoBuilderConfig();
      return;
    }

    const data = this.investmentTargets;
    const currentValue = this.portfolioData?.total_value || 0;
    const targetAmount = data.targetAmount || 0;

    // Calculate simulated total (only items matching current scope/portfolio)
    let simulatedTotal = 0;
    this.items.forEach(item => {
      if (this.scope === 'portfolio' && this.portfolioId) {
        if (item.portfolio_id !== this.portfolioId) return;
      }
      simulatedTotal += parseFloat(item.value) || 0;
    });

    const projectedValue = currentValue + simulatedTotal;
    const percentComplete = targetAmount > 0 ? Math.min(100, (currentValue / targetAmount) * 100) : 0;
    const projectedPercent = targetAmount > 0 ? (projectedValue / targetAmount) * 100 : 0;
    const remaining = Math.max(0, targetAmount - currentValue);
    const projectedRemaining = Math.max(0, targetAmount - projectedValue);
    const isOverTarget = currentValue > targetAmount;
    const projectedOverTarget = projectedValue > targetAmount;

    // Segment percentages for legend
    const clampedExisting = Math.min(100, percentComplete);
    const simulatedPercent = targetAmount > 0 ? Math.min(100 - clampedExisting, (simulatedTotal / targetAmount) * 100) : 0;
    const remainingPercent = Math.max(0, 100 - clampedExisting - simulatedPercent);

    // Determine scope label
    let scopeLabel = 'Global';
    let allocationInfo = '';
    if (this.scope === 'portfolio' && data.portfolioName) {
      scopeLabel = data.portfolioName;
      if (data.allocationPercent) {
        allocationInfo = ` (${data.allocationPercent}%)`;
      }
    }

    // Status class
    const statusClass = isOverTarget ? 'over-target' : percentComplete >= 100 ? 'complete' : '';

    container.innerHTML = `
      <div class="progress-header">
        <div class="progress-title">
          <i class="fas fa-bullseye"></i>
          <span class="label">Investment Progress</span>
          <span class="scope-badge">${scopeLabel}${allocationInfo}</span>
        </div>
        <div class="progress-values">
          <span class="current-value">${this.formatCurrency(currentValue)}</span>
          <span class="separator">/</span>
          <span class="target-value">${this.formatCurrency(targetAmount)}</span>
        </div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-track">
          <div class="progress-fill ${statusClass}" style="width: ${percentComplete.toFixed(1)}%"></div>
          ${simulatedTotal > 0 ? `
            <div class="progress-simulated" style="left: ${Math.min(100, percentComplete).toFixed(1)}%; width: ${Math.min(100 - percentComplete, (simulatedTotal / targetAmount) * 100).toFixed(1)}%"></div>
          ` : ''}
        </div>
        <div class="progress-legend">
          <div class="legend-item">
            <span class="legend-swatch existing ${statusClass}"></span>
            <span class="legend-text">Existing ${clampedExisting.toFixed(1)}%</span>
          </div>
          ${simulatedTotal > 0 && !isOverTarget ? `
            <div class="legend-item">
              <span class="legend-swatch simulated"></span>
              <span class="legend-text">Simulated +${simulatedPercent.toFixed(1)}%</span>
            </div>
          ` : ''}
          ${!isOverTarget && remainingPercent > 0 ? `
            <div class="legend-item">
              <span class="legend-swatch remaining"></span>
              <span class="legend-text">Remaining ${remainingPercent.toFixed(1)}%</span>
            </div>
          ` : ''}
          ${isOverTarget ? `
            <div class="legend-item">
              <span class="legend-text">${this.formatCurrency(currentValue - targetAmount)} over target</span>
            </div>
          ` : ''}
        </div>
      </div>

      ${simulatedTotal > 0 ? `
        <div class="simulated-impact ${projectedOverTarget ? 'over-target' : ''}">
          <span class="simulated-label">With simulated additions:</span>
          <span class="simulated-value">${this.formatCurrency(projectedValue)}</span>
          <span class="simulated-percent">(${projectedPercent.toFixed(1)}%)</span>
          ${!projectedOverTarget && projectedRemaining > 0 ? `
            <span class="simulated-remaining">— ${this.formatCurrency(projectedRemaining)} still needed</span>
          ` : ''}
          ${projectedOverTarget ? `
            <span class="simulated-over">— exceeds target</span>
          ` : ''}
        </div>
      ` : ''}
    `;
  }

  renderNoBuilderConfig() {
    return `
      <div class="no-builder-config">
        <i class="fas fa-info-circle"></i>
        <span>Set up your investment targets in the <a href="/portfolio/builder">Builder</a> to see your progress here.</span>
      </div>
    `;
  }

  formatCurrency(value) {
    const num = parseFloat(value) || 0;
    const formatted = '€' + num.toLocaleString('de-DE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
    return `<span class="sensitive-value">${formatted}</span>`;
  }

  // ============================================================================
  // Chart Rendering with Combined Allocations
  // ============================================================================

  updateCharts() {
    const combined = this.calculateCombinedAllocations();
    // Store for position detail access
    this.lastCombinedData = combined;

    this.renderBarChart(this.countryChart, combined.byCountry, combined.combinedTotal, combined.baselineByCountry, combined.baselineTotal, 'country');

    // For the category chart, use sector or thesis based on categoryMode
    const categoryData = this.categoryMode === 'thesis' ? combined.byThesis : combined.bySector;
    const baselineData = this.categoryMode === 'thesis' ? combined.baselineByThesis : combined.baselineBySector;
    this.renderBarChart(this.sectorChart, categoryData, combined.combinedTotal, baselineData, combined.baselineTotal, 'sector');

    // Handle pending auto-expand for newly added items
    this.handlePendingExpand();

    // Update investment progress (simulated items impact remaining-to-invest)
    this.updateInvestmentProgress();

    // Update historical performance chart (sandbox mode, debounced)
    this.debouncedHistoricalUpdate();
  }

  // ============================================================================
  // Historical Performance Chart (Sandbox Mode)
  // ============================================================================

  getChartIdentifiers() {
    const tickerMap = new Map(); // ticker → { weight, names[] }

    for (const item of this.items) {
      const ticker = (item.ticker || '').trim();
      if (!ticker) continue;

      // Calculate weight: use EUR value, or convert from % if totalAmount is set
      let weight = parseFloat(item.value) || 0;
      if (weight === 0 && this.totalAmount > 0 && item.targetPercent) {
        weight = (parseFloat(item.targetPercent) || 0) * this.totalAmount / 100;
      }

      if (tickerMap.has(ticker)) {
        const existing = tickerMap.get(ticker);
        existing.weight += weight;
        if (!existing.names.includes(item.name || ticker)) {
          existing.names.push(item.name || ticker);
        }
      } else {
        tickerMap.set(ticker, {
          weight: weight,
          names: [item.name || ticker]
        });
      }
    }

    const identifiers = [];
    const weights = [];
    const names = [];

    for (const [ticker, info] of tickerMap) {
      identifiers.push(ticker);
      weights.push(info.weight);
      names.push(info.names[0]); // Use first name for display
    }

    return { identifiers, weights, names };
  }

  async updateHistoricalChart() {
    if (!this.isPortfolioMode()) {
      if (this.historicalSection) this.historicalSection.style.display = 'none';
      return;
    }

    const { identifiers, weights, names } = this.getChartIdentifiers();

    const chartEl = this.historicalChartEl;
    const loadingEl = document.getElementById('simulator-historical-loading');
    const emptyEl = document.getElementById('simulator-historical-empty');

    if (identifiers.length === 0) {
      if (this.historicalSection) this.historicalSection.style.display = '';
      if (chartEl) chartEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

    // Show section
    if (this.historicalSection) this.historicalSection.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';

    // Check cache
    const sortedIds = [...identifiers].sort();
    const cacheKey = sortedIds.join(',') + '|' + this.currentChartPeriod;

    if (this.historicalDataCache.has(cacheKey)) {
      this.renderHistoricalChart(this.historicalDataCache.get(cacheKey), identifiers, weights, names);
      return;
    }

    // Show loading
    if (chartEl) chartEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = '';

    // Abort previous in-flight request
    if (this.chartAbortController) {
      this.chartAbortController.abort();
    }
    this.chartAbortController = new AbortController();

    try {
      const params = new URLSearchParams({
        identifiers: identifiers.join(','),
        period: this.currentChartPeriod
      });
      const response = await fetch(`/portfolio/api/historical_prices?${params}`, {
        signal: this.chartAbortController.signal
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      this.historicalDataCache.set(cacheKey, data);
      this.renderHistoricalChart(data, identifiers, weights, names);
    } catch (err) {
      if (err.name === 'AbortError') return; // Cancelled, ignore
      console.error('Failed to fetch historical prices:', err);
      if (chartEl) chartEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.textContent = 'Failed to load historical data.';
        emptyEl.style.display = '';
      }
    }
  }

  renderHistoricalChart(data, identifiers, weights, names) {
    const chartEl = this.historicalChartEl;
    const loadingEl = document.getElementById('simulator-historical-loading');
    const emptyEl = document.getElementById('simulator-historical-empty');

    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    const seriesData = data.series || {};
    const themeColors = ChartConfig.getThemeColors();

    // Build series: normalize each to base 100
    const allSeries = [];

    for (let i = 0; i < identifiers.length; i++) {
      const id = identifiers[i];
      const name = names[i] || id;
      const points = seriesData[id];
      if (!points || points.length === 0) continue;

      const basePrice = points[0].close;
      if (basePrice === 0) continue;

      allSeries.push({
        name: name,
        identifier: id,
        value: (weights && weights[i]) || 0,
        data: points.map(p => ({
          x: new Date(p.date).getTime(),
          y: parseFloat(((p.close / basePrice) * 100).toFixed(2))
        }))
      });
    }

    if (allSeries.length === 0) {
      if (chartEl) chartEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.textContent = 'No historical data available for these positions.';
        emptyEl.style.display = '';
      }
      return;
    }

    // Build display series based on mode
    const displaySeries = [];
    if (this.historicalChartMode === 'detail') {
      allSeries.forEach(s => displaySeries.push({ name: s.name, data: s.data }));
    }

    // Aggregate always present (solo in aggregate mode, reference line in detail)
    const aggSeries = this.computeSimulatorAggregate(allSeries);
    if (aggSeries) {
      displaySeries.push(aggSeries);
    }

    // Colors — aggregate is yellow; individual lines use palette only (no colorMapping)
    const palette = ChartConfig.oceanDepthColors.palette;
    let paletteIdx = 0;
    const colors = displaySeries.map(s => {
      if (s.name === 'Weighted Avg') return '#eab308'; // yellow — aggregate
      return palette[paletteIdx++ % palette.length];
    });

    // Stroke config
    const strokeWidths = displaySeries.map(s => {
      if (s.name === 'Weighted Avg') return 3;
      return displaySeries.length > 8 ? 1.5 : 2;
    });
    const dashArray = displaySeries.map(s => s.name === 'Weighted Avg' ? 5 : 0);

    // Destroy previous instance
    if (this.historicalChartInstance) {
      this.historicalChartInstance.destroy();
      this.historicalChartInstance = null;
    }

    if (chartEl) chartEl.style.display = '';

    const options = {
      series: displaySeries,
      chart: {
        type: 'area',
        height: 350,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        toolbar: { show: false },
        zoom: { enabled: false },
        background: 'transparent',
        animations: { enabled: false }
      },
      colors: colors,
      stroke: {
        width: strokeWidths,
        curve: 'smooth',
        dashArray: dashArray
      },
      fill: {
        type: this.historicalChartMode === 'aggregate' ? 'solid' : 'gradient',
        opacity: this.historicalChartMode === 'aggregate' ? 0 : 0.05,
        gradient: {
          shade: 'light',
          type: 'vertical',
          opacityFrom: 0.08,
          opacityTo: 0.01
        }
      },
      dataLabels: { enabled: false },
      grid: {
        show: true,
        borderColor: themeColors.textMuted + '20',
        strokeDashArray: 4,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } }
      },
      xaxis: {
        type: 'datetime',
        labels: {
          style: { colors: themeColors.textTertiary, fontSize: '11px' }
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: {
          style: { colors: themeColors.textTertiary, fontSize: '11px' },
          formatter: v => v.toFixed(0),
          offsetX: -8
        }
      },
      tooltip: {
        theme: themeColors.tooltipTheme,
        x: { format: 'MMM yyyy' },
        y: {
          formatter: function(val) {
            const change = val - 100;
            const sign = change >= 0 ? '+' : '';
            return val.toFixed(1) + ' (' + sign + change.toFixed(1) + '%)';
          }
        }
      },
      legend: { show: false },
      annotations: {
        yaxis: [{
          y: 100,
          borderColor: themeColors.textMuted + '40',
          strokeDashArray: 2,
          label: { show: false }
        }]
      }
    };

    this.historicalChartInstance = new ApexCharts(chartEl, options);
    this.historicalChartInstance.render();
  }

  computeSimulatorAggregate(allSeries) {
    if (allSeries.length === 0) return null;

    // Weighted average by item value/weight
    const totalValue = allSeries.reduce((sum, s) => sum + (s.value || 1), 0);
    const seriesWeights = allSeries.map(s => totalValue > 0 ? (s.value || 1) / totalValue : 1 / allSeries.length);

    // Collect all unique dates across all series
    const dateMap = new Map();
    allSeries.forEach((s, idx) => {
      s.data.forEach(point => {
        if (!dateMap.has(point.x)) {
          dateMap.set(point.x, new Array(allSeries.length).fill(null));
        }
        dateMap.get(point.x)[idx] = point.y;
      });
    });

    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => a - b);

    // Forward-fill and compute weighted average
    const lastKnown = new Array(allSeries.length).fill(100);
    const hasData = new Array(allSeries.length).fill(false);
    const aggData = [];

    for (const date of sortedDates) {
      const vals = dateMap.get(date);
      let weightedSum = 0;
      let weightSum = 0;

      for (let i = 0; i < vals.length; i++) {
        if (vals[i] !== null) { lastKnown[i] = vals[i]; hasData[i] = true; }
        if (!hasData[i]) continue;
        weightedSum += lastKnown[i] * seriesWeights[i];
        weightSum += seriesWeights[i];
      }

      aggData.push({
        x: date,
        y: parseFloat((weightedSum / weightSum).toFixed(2))
      });
    }

    return { name: 'Weighted Avg', data: aggData };
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
      const categoryData = this.categoryMode === 'thesis' ? combined.byThesis : combined.bySector;
      const baselineData = this.categoryMode === 'thesis' ? combined.baselineByThesis : combined.baselineBySector;
      this.renderBarChart(this.sectorChart, categoryData, combined.combinedTotal, baselineData, combined.baselineTotal, 'sector');
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
    const bySector = {};
    const byThesis = {};
    const baselineByCountry = {};
    const baselineBySector = {};
    const baselineByThesis = {};

    // In portfolio mode, don't include baseline data
    const includeBaseline = !this.isPortfolioMode();

    // Add portfolio baseline data (overlay mode only)
    // Use total_value (holdings only, excludes cash) so percentages sum to 100%
    const portfolioTotal = includeBaseline ? (this.portfolioData?.total_value || 0) : 0;

    if (includeBaseline && this.portfolioData) {
      // Store baseline for delta calculations (normalize labels to lowercase)
      (this.portfolioData.countries || []).forEach(c => {
        const normalizedName = (c.name || 'unknown').toLowerCase().trim();
        baselineByCountry[normalizedName] = (baselineByCountry[normalizedName] || 0) + c.value;
        byCountry[normalizedName] = (byCountry[normalizedName] || 0) + c.value;
      });

      (this.portfolioData.sectors || []).forEach(c => {
        const normalizedName = (c.name || 'unknown').toLowerCase().trim();
        baselineBySector[normalizedName] = (baselineBySector[normalizedName] || 0) + c.value;
        bySector[normalizedName] = (bySector[normalizedName] || 0) + c.value;
      });

      (this.portfolioData.theses || []).forEach(c => {
        const normalizedName = (c.name || 'unassigned').toLowerCase().trim();
        baselineByThesis[normalizedName] = (baselineByThesis[normalizedName] || 0) + c.value;
        byThesis[normalizedName] = (byThesis[normalizedName] || 0) + c.value;
      });
    }

    // Add simulated items (only those matching selected portfolio when in overlay + portfolio scope)
    let simulatedTotal = 0;
    this.items.forEach(item => {
      // In overlay mode with portfolio scope, skip items not matching selected portfolio
      if (!this.isPortfolioMode() && this.scope === 'portfolio' && this.portfolioId) {
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
      bySector[sector] = (bySector[sector] || 0) + value;

      // Thesis aggregation (normalize to lowercase)
      const thesis = item.thesis === '—' || !item.thesis ? 'unassigned' : item.thesis.toLowerCase();
      byThesis[thesis] = (byThesis[thesis] || 0) + value;
    });

    // In sandbox mode with totalAmount set, use totalAmount as the denominator for chart percentages
    const isSandboxWithTotal = this.isPortfolioMode() && this.totalAmount > 0;
    const combinedTotal = isSandboxWithTotal ? this.totalAmount : (portfolioTotal + simulatedTotal);

    // Return data for both sector and thesis (the chart renderer will choose based on categoryMode)
    return {
      byCountry,
      bySector,
      byThesis,
      // Legacy aliases for compatibility
      byCategory: this.categoryMode === 'thesis' ? byThesis : bySector,
      baselineByCountry,
      baselineBySector,
      baselineByThesis,
      baselineByCategory: this.categoryMode === 'thesis' ? baselineByThesis : baselineBySector,
      combinedTotal,
      baselineTotal: portfolioTotal,
      simulatedTotal
    };
  }

  renderBarChart(container, data, total, baseline, baselineTotal, chartType) {
    if (total === 0 || Object.keys(data).length === 0) {
      const emptyMsg = this.isPortfolioMode()
        ? 'Add positions to see allocations'
        : 'No data to display';
      container.innerHTML = `<div class="chart-empty">${emptyMsg}</div>`;
      return;
    }

    // Sort by value descending
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1]);

    // Determine which bar is currently expanded for this chart type
    const expandedLabel = chartType === 'country' ? this.expandedCountryBar : this.expandedSectorBar;

    // In portfolio mode, don't show delta indicators
    const showDelta = !this.isPortfolioMode();

    container.innerHTML = sorted.map(([label, value]) => {
      const percentage = (value / total * 100).toFixed(1);
      const isUnknown = label === 'unknown';
      const isExpanded = label === expandedLabel;

      // Calculate delta from baseline (overlay mode only)
      let deltaHtml = '';
      if (showDelta) {
        const baselineValue = baseline?.[label] || 0;
        const baselinePercentage = baselineTotal > 0 ? (baselineValue / baselineTotal * 100) : 0;
        const deltaPercentage = parseFloat(percentage) - baselinePercentage;

        if (Math.abs(deltaPercentage) >= 0.1) {
          const deltaClass = deltaPercentage > 0 ? 'delta-positive' : 'delta-negative';
          const deltaSign = deltaPercentage > 0 ? '+' : '';
          deltaHtml = `<span class="delta-indicator ${deltaClass}">(${deltaSign}${deltaPercentage.toFixed(1)}%)</span>`;
        }
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
    if (this.isPortfolioMode()) {
      // In sandbox mode with totalAmount, use it as the denominator
      if (this.totalAmount > 0) {
        return this.totalAmount;
      }
      // In portfolio mode, global total = simulated items total
      return this.items.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
    }
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
    // In portfolio mode or global scope: segment % + global % (portfolio % would be redundant)
    const isGlobalScope = this.scope === 'global' || this.isPortfolioMode();

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

    // Determine which field to match based on chart type and category mode
    // For 'sector' chart type, use thesis or sector depending on categoryMode
    const getMatchField = (pos) => {
      if (chartType === 'country') {
        return pos.country;
      } else {
        // 'sector' chart type - can show sector or thesis data
        return this.categoryMode === 'thesis' ? pos.thesis : pos.sector;
      }
    };

    // Default value for unassigned items
    const getDefaultValue = () => {
      if (chartType === 'country') {
        return 'unknown';
      } else {
        return this.categoryMode === 'thesis' ? 'unassigned' : 'unknown';
      }
    };

    // Add portfolio positions (overlay mode only)
    if (!this.isPortfolioMode() && this.portfolioData && this.portfolioData.positions) {
      this.portfolioData.positions.forEach(pos => {
        const matchField = getMatchField(pos);
        const defaultVal = getDefaultValue();
        const normalizedField = (matchField || defaultVal).toLowerCase().trim();

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

    // Add simulated items (respecting portfolio scope in overlay mode)
    this.items.forEach(item => {
      // In overlay mode with portfolio scope, skip items not matching
      if (!this.isPortfolioMode() && this.scope === 'portfolio' && this.portfolioId) {
        if (item.portfolio_id !== this.portfolioId) {
          return;
        }
      }

      const matchField = getMatchField(item);
      const defaultVal = getDefaultValue();
      const normalizedField = (matchField === '—' || !matchField) ? defaultVal : matchField.toLowerCase().trim();

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

    let sourceData;
    if (type === 'sector') {
      sourceData = this.portfolioData.sectors || [];
    } else if (type === 'thesis') {
      sourceData = this.portfolioData.theses || [];
    } else {
      sourceData = this.portfolioData.countries || [];
    }

    // Use portfolio_total (includes cash) for percentage calculations
    const totalValue = this.portfolioData.portfolio_total || this.portfolioData.total_value || 0;
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
    // In portfolio mode, there's no baseline
    if (this.isPortfolioMode()) {
      return { baselineValue: 0, baselineTotal: 0 };
    }

    // Use portfolio_total (includes cash) for percentage calculations
    const portfolioTotal = this.portfolioData?.portfolio_total || this.portfolioData?.total_value || 0;
    let baselineValue = 0;

    // Determine which baseline to use based on item source
    if (item.source === 'sector' && item.sector && item.sector !== '—') {
      const normalizedSector = item.sector.toLowerCase();
      const sectorData = (this.portfolioData?.sectors || [])
        .find(c => (c.name || '').toLowerCase() === normalizedSector);
      baselineValue = sectorData?.value || 0;
    } else if (item.source === 'thesis' && item.thesis && item.thesis !== '—') {
      const normalizedThesis = item.thesis.toLowerCase();
      const thesisData = (this.portfolioData?.theses || [])
        .find(c => (c.name || '').toLowerCase() === normalizedThesis);
      baselineValue = thesisData?.value || 0;
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
  /**
   * Recalculate item values for overlay mode (% → EUR derivation).
   * In overlay mode, % represents target allocation of (baseline + addition),
   * so EUR is the required addition to reach that target.
   */
  recalculatePercentageItem(item) {
    if (!item.targetPercent) {
      item.targetWarning = null;
      return;
    }

    const targetPercent = item.targetPercent;

    // Sandbox mode: handled by saveCell/handleTableInput directly
    if (this.isPortfolioMode()) {
      item.targetWarning = null;
      return;
    }

    // Overlay mode: calculate required addition against portfolio baseline
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
    // Portfolio/sandbox mode uses totalAmount-based derivation, not baseline overlay
    if (this.isPortfolioMode()) return;

    this.items.forEach(item => {
      this.recalculatePercentageItem(item);
    });
  }

  // ============================================================================
  // Sandbox Controls
  // ============================================================================

  /**
   * Update sandbox controls visibility and state
   */
  updateSandboxControls() {
    const isPortfolio = this.isPortfolioMode();

    // Show/hide total amount control in header (only in sandbox mode)
    const totalAmountControl = document.getElementById('simulator-total-amount-control');
    if (totalAmountControl) {
      totalAmountControl.style.display = isPortfolio ? '' : 'none';
    }

    // Update total amount input value
    const totalInput = document.getElementById('sandbox-total-amount-input');
    if (totalInput) {
      totalInput.value = this.totalAmount > 0 ? this.formatValue(this.totalAmount) : '';
    }

    this.renderAllocationSummary();
  }

  /**
   * Handle total amount changing. When going from 0→non-zero, derive %
   * from existing € values first. Otherwise, derive € from %.
   */
  onTotalAmountChanged(oldTotal, newTotal) {
    if (oldTotal === 0 && newTotal > 0) {
      // Transition 0→non-zero: derive % from existing € values
      this.items.forEach(item => {
        const euroVal = parseFloat(item.value) || 0;
        item.targetPercent = euroVal > 0
          ? parseFloat((euroVal / newTotal * 100).toFixed(1))
          : (parseFloat(item.targetPercent) || 0);
      });
    } else if (newTotal > 0) {
      // Normal: derive € from %
      this.items.forEach(item => {
        const pct = parseFloat(item.targetPercent) || 0;
        item.value = Math.round((pct / 100) * newTotal * 100) / 100;
      });
    }
    // When newTotal === 0: keep € values as-is, % values as-is
  }

  /**
   * Ensure all items have targetPercent derived from their EUR values.
   * Called when loading saved simulations to handle backward compatibility.
   */
  ensureItemPercentages() {
    // If totalAmount is set, derive from it. Otherwise derive from sum of values.
    const denominator = this.totalAmount > 0
      ? this.totalAmount
      : this.items.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);

    this.items.forEach(item => {
      if (item.targetPercent === undefined || item.targetPercent === null) {
        const val = parseFloat(item.value) || 0;
        item.targetPercent = denominator > 0
          ? parseFloat((val / denominator * 100).toFixed(1))
          : 0;
      }
    });

  }

  /**
   * Get the denominator for EUR → % calculations.
   * In sandbox with totalAmount: use totalAmount.
   * Otherwise: sum of all EUR values.
   */
  getPercentDenominator() {
    if (this.isPortfolioMode() && this.totalAmount > 0) {
      return this.totalAmount;
    }
    // Fallback: sum of all EUR values
    return this.items.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
  }

  /**
   * Render the allocation summary (X% allocated / Y% remaining)
   * Now renders into the % column header instead of the header bar.
   */
  renderAllocationSummary() {
    const el = document.getElementById('sandbox-allocation-summary');
    if (!el) return;

    if (this.items.length === 0) {
      el.innerHTML = '';
      return;
    }

    if (this.isPortfolioMode()) {
      if (this.totalAmount <= 0) {
        // Show total from sum of EUR values
        const totalEuro = this.items.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
        if (totalEuro > 0) {
          el.innerHTML = `<span class="allocation-full">Σ €${this.formatValue(totalEuro)}</span>`;
        } else {
          el.innerHTML = '';
        }
        // Clear over-budget when no total is set
        const totalWrapper = document.querySelector('.sandbox-total-input-wrapper');
        if (totalWrapper) totalWrapper.classList.remove('over-budget');
        return;
      }

      const totalPercent = this.items.reduce((sum, item) => sum + (parseFloat(item.targetPercent) || 0), 0);
      const rounded = Math.round(totalPercent * 10) / 10;

      let statusClass, statusText;
      if (rounded === 100) {
        statusClass = 'allocation-full';
        statusText = '✓ 100%';
      } else if (rounded > 100) {
        statusClass = 'allocation-over';
        statusText = `${rounded}%`;
      } else {
        statusClass = 'allocation-under';
        statusText = `${rounded}%`;
      }

      el.innerHTML = `<span class="${statusClass}">${statusText}</span>`;

      // Toggle over-budget styling on the total input wrapper
      const totalWrapper = document.querySelector('.sandbox-total-input-wrapper');
      if (totalWrapper) {
        totalWrapper.classList.toggle('over-budget', rounded > 100);
      }
    } else {
      // Overlay mode: show total simulated amount
      const totalSimulated = this.items.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
      if (totalSimulated > 0) {
        el.innerHTML = `<span class="allocation-full">Σ €${this.formatValue(totalSimulated)}</span>`;
      } else {
        el.innerHTML = '';
      }
    }
  }

  // ============================================================================
  // Deploy Section (DCA Calculator)
  // ============================================================================

  renderDeploySection() {
    if (!this.deployContainer) return;

    // Only show in portfolio/sandbox mode with a loaded simulation
    if (!this.isPortfolioMode() || !this.currentSimulationId) {
      this.deployContainer.innerHTML = '';
      return;
    }

    // Auto mode: sync lump sum from sandbox totalAmount
    if (!this.deployManualMode) {
      this.deployLumpSum = this.totalAmount;
    }

    const dca = this.calculateDCA();
    const positions = this.getDeployPositions();
    const hasParams = this.deployLumpSum > 0 || this.deployMonthly > 0;

    this.deployContainer.innerHTML = `
      <div class="deploy-section">
        <div class="simulator-chart-header">
          <h5 class="simulator-chart-label"><i class="fas fa-rocket"></i> Deploy</h5>
          <div class="deploy-controls">
            <div class="toggle-group">
              <button class="toggle-btn${!this.deployManualMode ? ' active' : ''}" data-deploy-mode="auto">Auto</button>
              <button class="toggle-btn${this.deployManualMode ? ' active' : ''}" data-deploy-mode="manual">Manual</button>
            </div>
          </div>
        </div>
        ${this.renderDeployParams()}
        ${hasParams ? this.renderDeploySummary(dca) : '<div class="deploy-empty-hint">Enter a lump sum or monthly savings to calculate your deployment schedule.</div>'}
        ${hasParams && positions.length > 0 ? this.renderDeployPositionsTable(positions, dca) : ''}
      </div>
    `;

    this.bindDeployEvents();
  }

  calculateDCA() {
    const months = Math.max(1, this.deployMonths);
    const lumpPortion = this.deployLumpSum / months;
    const monthlyInvestment = lumpPortion + this.deployMonthly;
    const totalDeployed = monthlyInvestment * months;
    return { lumpPortion, monthlyInvestment, totalDeployed, months };
  }

  getDeployPositions() {
    if (this.deployManualMode && this.deployManualItems.length > 0) {
      return this.deployManualItems;
    }
    // Auto mode: derive from sandbox items
    return this.items
      .filter(item => (parseFloat(item.targetPercent) || 0) > 0)
      .map(item => ({
        name: item.name || item.ticker || '—',
        ticker: item.ticker || '',
        percent: parseFloat(item.targetPercent) || 0
      }));
  }

  renderDeployParams() {
    const isAuto = !this.deployManualMode;
    return `
      <div class="deploy-params">
        <div class="deploy-param-group">
          <label>Lump Sum</label>
          <input type="text" id="deploy-lump-sum" class="sensitive-value"
                 value="${this.deployLumpSum > 0 ? this.formatValue(this.deployLumpSum) : ''}"
                 placeholder="0"${isAuto ? ' readonly' : ''}>
        </div>
        <div class="deploy-param-group">
          <label>Monthly Savings</label>
          <input type="text" id="deploy-monthly" class="sensitive-value"
                 value="${this.deployMonthly > 0 ? this.formatValue(this.deployMonthly) : ''}"
                 placeholder="0">
        </div>
        <div class="deploy-param-group">
          <label>Months</label>
          <input type="number" id="deploy-months"
                 value="${this.deployMonths}"
                 min="1" max="120" step="1">
        </div>
      </div>
    `;
  }

  renderDeploySummary(dca) {
    return `
      <div class="deploy-summary">
        <div class="deploy-hero-block">
          <div class="deploy-hero-label">Monthly Investment</div>
          <div class="deploy-hero-value sensitive-value">€${this.formatValue(dca.monthlyInvestment)}</div>
        </div>
        <div class="deploy-details">
          <div class="deploy-detail-row">
            <span class="detail-label">Lump portion</span>
            <span class="detail-value sensitive-value">€${this.formatValue(dca.lumpPortion)}/mo</span>
          </div>
          <div class="deploy-detail-row">
            <span class="detail-label">Monthly savings</span>
            <span class="detail-value sensitive-value">€${this.formatValue(this.deployMonthly)}/mo</span>
          </div>
          <div class="deploy-detail-row">
            <span class="detail-label">Total deployed (${dca.months} months)</span>
            <span class="detail-value sensitive-value">€${this.formatValue(dca.totalDeployed)}</span>
          </div>
        </div>
      </div>
    `;
  }

  renderDeployPositionsTable(positions, dca) {
    const totalPercent = positions.reduce((sum, p) => sum + p.percent, 0);
    const rows = positions.map(pos => {
      const eurPerMonth = totalPercent > 0 ? dca.monthlyInvestment * (pos.percent / totalPercent) : 0;
      return `
        <tr>
          <td>${this.escapeHtml(pos.name)}</td>
          <td class="col-weight">${pos.percent.toFixed(1)}%</td>
          <td class="col-eur-mo sensitive-value">€${this.formatValue(eurPerMonth)}</td>
          ${this.deployManualMode ? `<td class="col-delete"><button class="btn-delete" data-deploy-remove="${this.escapeHtml(pos.name)}" title="Remove"><i class="fas fa-times"></i></button></td>` : ''}
        </tr>
      `;
    }).join('');

    return `
      <table class="deploy-positions-table">
        <thead>
          <tr>
            <th>Position</th>
            <th class="col-weight">Weight</th>
            <th class="col-eur-mo">EUR/mo</th>
            ${this.deployManualMode ? '<th class="col-delete"></th>' : ''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${this.deployManualMode ? this.renderDeployAddRow() : ''}
    `;
  }

  renderDeployAddRow() {
    return `
      <div class="deploy-add-row">
        <input type="text" id="deploy-add-name" placeholder="Position name">
        <input type="number" id="deploy-add-percent" placeholder="%" min="0" max="100" step="0.1" style="max-width: 80px;">
        <button id="deploy-add-btn">Add</button>
      </div>
    `;
  }

  bindDeployEvents() {
    // Mode toggle
    const modeButtons = this.deployContainer.querySelectorAll('[data-deploy-mode]');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newMode = btn.dataset.deployMode === 'manual';
        if (newMode === this.deployManualMode) return;
        this.toggleDeployManualMode(newMode);
      });
    });

    // Parameter inputs
    const lumpInput = document.getElementById('deploy-lump-sum');
    const monthlyInput = document.getElementById('deploy-monthly');
    const monthsInput = document.getElementById('deploy-months');

    if (lumpInput && !lumpInput.readOnly) {
      lumpInput.addEventListener('blur', (e) => {
        this.deployLumpSum = this.parseValue(e.target.value);
        e.target.value = this.deployLumpSum > 0 ? this.formatValue(this.deployLumpSum) : '';
        this.renderDeploySection();
        this.triggerAutoSave();
      });
      lumpInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') e.target.blur();
      });
    }

    if (monthlyInput) {
      monthlyInput.addEventListener('blur', (e) => {
        this.deployMonthly = this.parseValue(e.target.value);
        e.target.value = this.deployMonthly > 0 ? this.formatValue(this.deployMonthly) : '';
        this.renderDeploySection();
        this.triggerAutoSave();
      });
      monthlyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') e.target.blur();
      });
    }

    if (monthsInput) {
      monthsInput.addEventListener('blur', (e) => {
        let val = parseInt(e.target.value) || 1;
        val = Math.max(1, Math.min(120, val));
        this.deployMonths = val;
        e.target.value = val;
        this.renderDeploySection();
        this.triggerAutoSave();
      });
      monthsInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') e.target.blur();
      });
    }

    // Manual mode: remove position
    this.deployContainer.querySelectorAll('[data-deploy-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.deployRemove;
        this.deployManualItems = this.deployManualItems.filter(item => item.name !== name);
        this.renderDeploySection();
        this.triggerAutoSave();
      });
    });

    // Manual mode: add position
    const addBtn = document.getElementById('deploy-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.addDeployManualItem());
    }
    const addNameInput = document.getElementById('deploy-add-name');
    if (addNameInput) {
      addNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.addDeployManualItem();
      });
    }
  }

  toggleDeployManualMode(manual) {
    if (manual && !this.deployManualMode) {
      // Switching to manual: copy current positions
      if (this.deployManualItems.length === 0) {
        this.deployManualItems = this.getDeployPositions().map(p => ({ ...p }));
      }
    } else if (!manual && this.deployManualMode) {
      // Switching to auto: discard manual items if they exist
      if (this.deployManualItems.length > 0) {
        this.deployManualItems = [];
      }
    }
    this.deployManualMode = manual;
    this.renderDeploySection();
    this.triggerAutoSave();
  }

  addDeployManualItem() {
    const nameInput = document.getElementById('deploy-add-name');
    const pctInput = document.getElementById('deploy-add-percent');
    if (!nameInput) return;

    const name = nameInput.value.trim();
    const percent = parseFloat(pctInput?.value) || 0;

    if (!name) return;

    this.deployManualItems.push({ name, ticker: '', percent });
    this.renderDeploySection();
    this.triggerAutoSave();
  }

  getDeployDataForSave() {
    return {
      deploy_lump_sum: this.deployLumpSum,
      deploy_monthly: this.deployMonthly,
      deploy_months: this.deployMonths,
      deploy_manual_mode: this.deployManualMode ? 1 : 0,
      deploy_manual_items: this.deployManualMode ? this.deployManualItems : null
    };
  }

  loadDeployData(simulation) {
    this.deployLumpSum = simulation.deploy_lump_sum || 0;
    this.deployMonthly = simulation.deploy_monthly || 0;
    this.deployMonths = simulation.deploy_months || 1;
    this.deployManualMode = !!simulation.deploy_manual_mode;
    this.deployManualItems = simulation.deploy_manual_items || [];
  }

  resetDeployData() {
    this.deployLumpSum = 0;
    this.deployMonthly = 0;
    this.deployMonths = 1;
    this.deployManualMode = false;
    this.deployManualItems = [];
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

// Initialize when DOM is ready (will be called from simulator.js or inline)
window.AllocationSimulator = AllocationSimulator;
