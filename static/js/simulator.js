/**
 * Allocation Simulator - Sandbox Mode
 *
 * A lightweight sandbox for exploring portfolio allocations.
 * Add tickers, categories, or countries and see real-time percentage breakdowns.
 * No persistence - page refresh clears everything.
 */

class AllocationSimulator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('Simulator container not found:', containerId);
      return;
    }

    // Data store
    this.items = [];

    // DOM references (will be set after render)
    this.tableBody = null;
    this.countryChart = null;
    this.categoryChart = null;

    // Debounced chart update for real-time feedback
    this.debouncedChartUpdate = this.debounce(() => this.updateCharts(), 300);

    // Initialize
    this.render();
    this.bindEvents();
  }

  // Debounce utility - delays execution until pause in calls
  debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  render() {
    this.container.innerHTML = `
      <!-- Input Forms -->
      <div class="simulator-input-forms">
        <div class="simulator-input-form">
          <label class="label">Add Ticker</label>
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
              <th class="col-ticker">Ticker</th>
              <th class="col-category">Category</th>
              <th class="col-country">Country</th>
              <th class="col-value">Value (€)</th>
              <th class="col-delete"></th>
            </tr>
          </thead>
          <tbody id="simulator-table-body">
            <tr class="empty-state-row">
              <td colspan="5" class="empty-state">
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
            <div class="chart-empty">Add items to see distribution</div>
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
            <div class="chart-empty">Add items to see distribution</div>
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
          category: data.category || '—',
          country: data.country || '—',
          value: 0,
          source: 'ticker',
          name: data.name
        });
        input.value = '';
        this.showToast(`Added ${data.ticker} (${data.name})`, 'success');
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
      category: category,
      country: '—',
      value: 0,
      source: 'category'
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
      country: country,
      value: 0,
      source: 'country'
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
          <td colspan="5" class="empty-state">
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
            ? `<span class="ticker-badge" title="${item.name || item.ticker}">${item.ticker}</span>`
            : `<input type="text" class="editable-cell ticker-input" value="${this.escapeHtml(item.ticker)}"
                     data-field="ticker" placeholder="—">`
          }
        </td>
        <td class="col-category">
          <input type="text" class="editable-cell category-input" value="${this.escapeHtml(item.category)}"
                 data-field="category" placeholder="—">
        </td>
        <td class="col-country">
          <input type="text" class="editable-cell country-input" value="${this.escapeHtml(item.country)}"
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
    }

    // Update if value is empty, set to placeholder
    if (value === '' && field !== 'value') {
      value = '—';
      input.value = '—';
    }

    this.updateItem(id, field, value);

    // Visual feedback
    input.classList.add('cell-saved');
    setTimeout(() => input.classList.remove('cell-saved'), 500);
  }

  // ============================================================================
  // Chart Rendering
  // ============================================================================

  updateCharts() {
    const aggregates = this.calculateAggregates();
    this.renderBarChart(this.countryChart, aggregates.byCountry, aggregates.total);
    this.renderBarChart(this.categoryChart, aggregates.byCategory, aggregates.total);
  }

  calculateAggregates() {
    const byCountry = {};
    const byCategory = {};
    let total = 0;

    this.items.forEach(item => {
      const value = parseFloat(item.value) || 0;
      total += value;

      // Country aggregation
      const country = item.country === '—' || !item.country ? 'Unknown' : item.country;
      byCountry[country] = (byCountry[country] || 0) + value;

      // Category aggregation
      const category = item.category === '—' || !item.category ? 'Unknown' : item.category;
      byCategory[category] = (byCategory[category] || 0) + value;
    });

    return { byCountry, byCategory, total };
  }

  renderBarChart(container, data, total) {
    if (total === 0 || Object.keys(data).length === 0) {
      container.innerHTML = '<div class="chart-empty">Add items to see distribution</div>';
      return;
    }

    // Sort by value descending
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1]);

    container.innerHTML = sorted.map(([label, value]) => {
      const percentage = (value / total * 100).toFixed(1);
      const isUnknown = label === 'Unknown';

      return `
        <div class="chart-bar-item" title="${label}: €${this.formatValue(value)} (${percentage}%)">
          <div class="bar-label">${this.escapeHtml(label)}</div>
          <div class="bar-track">
            <div class="bar-fill ${isUnknown ? 'bar-fill-unknown' : ''}"
                 style="width: ${percentage}%"></div>
          </div>
          <div class="bar-percentage">${percentage}%</div>
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
