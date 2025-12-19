/**
 * Portfolio Simulator - Client-Side JavaScript
 * Chart.js setup and form interactions
 */

// =============================================================================
// Chart.js Configuration
// =============================================================================

// Color palette for charts - distinct, high-contrast colors for easy readability
// Colors are well-spaced on the color wheel with good saturation differences
const CHART_COLORS = {
  aqua: '#06B6D4',
  teal: '#14B8A6',
  crimson: '#c83647',
  coral: '#F97316',
  ocean: '#0F172A',
  palette: [
    '#3B82F6', // Blue - primary
    '#10B981', // Green - success
    '#F59E0B', // Amber - warning
    '#EF4444', // Red - danger
    '#8B5CF6', // Violet - distinct purple
    '#06B6D4', // Cyan - bright blue-green
    '#EC4899', // Pink - distinct from red
    '#14B8A6', // Teal - blue-green
    '#F97316', // Orange - warm
    '#6366F1', // Indigo - deep blue
    '#84CC16', // Lime - yellow-green
    '#F43F5E', // Rose - pink-red
    '#0EA5E9', // Sky - light blue
    '#A855F7', // Purple - lighter violet
    '#22C55E', // Emerald - bright green
    '#FB923C'  // Light orange - peachy
  ]
};

// Get current theme colors
function getThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    tooltipBg: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(248, 250, 252, 0.98)',
    tooltipText: isDark ? '#F8FAFC' : '#0F172A',
    tooltipBorder: isDark ? 'rgba(6, 182, 212, 0.3)' : 'rgba(6, 182, 212, 0.4)',
    legendColor: isDark ? '#E2E8F0' : '#334155'
  };
}

// Default Chart.js options
const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right',
      labels: {
        font: {
          family: "'Inter', sans-serif",
          size: 11,
          weight: '500'
        },
        padding: 10,
        usePointStyle: true,
        pointStyle: 'circle',
        boxWidth: 6,
        boxHeight: 6,
        color: getThemeColors().legendColor
      }
    },
    tooltip: {
      backgroundColor: getThemeColors().tooltipBg,
      titleColor: getThemeColors().tooltipText,
      bodyColor: getThemeColors().tooltipText,
      titleFont: {
        family: "'Inter', sans-serif",
        size: 12,
        weight: '600'
      },
      bodyFont: {
        family: "'JetBrains Mono', monospace",
        size: 11
      },
      padding: 10,
      cornerRadius: 6,
      borderColor: getThemeColors().tooltipBorder,
      borderWidth: 1,
      callbacks: {
        label: function(context) {
          let label = context.label || '';
          if (label) {
            label += ': ';
          }
          const value = context.parsed;
          const total = context.dataset.data.reduce((a, b) => a + b, 0);
          const percentage = ((value / total) * 100).toFixed(2);
          label += `€${value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${percentage}%)`;
          return label;
        }
      }
    }
  }
};

/**
 * Create a pie chart
 */
function createPieChart(canvasId, labels, data, title) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const themeColors = getThemeColors();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: CHART_COLORS.palette,
        borderColor: themeColors.borderColor,
        borderWidth: 2
      }]
    },
    options: {
      ...CHART_OPTIONS,
      layout: {
        padding: {
          top: 40,
          right: 40,
          bottom: 40,
          left: 40
        }
      },
      plugins: {
        ...CHART_OPTIONS.plugins,
        legend: {
          display: false  // Hide external legend
        },
        title: {
          display: false
        },
        datalabels: {
          color: isDark ? '#F8FAFC' : '#0F172A',
          font: {
            family: "'Inter', sans-serif",
            size: 12,
            weight: '600'
          },
          formatter: (value, context) => {
            const label = context.chart.data.labels[context.dataIndex];
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);

            // Show all labels at edges
            return `${label} (${percentage}%)`;
          },
          textAlign: 'center',
          anchor: 'end',        // Position at the outer edge of the slice
          align: 'end',         // Align label away from the pie
          offset: 8,            // Distance from the edge
          padding: 4,
          borderRadius: 4,
          backgroundColor: (context) => {
            // Semi-transparent background matching slice color
            const color = context.dataset.backgroundColor[context.dataIndex];
            return color + 'DD';  // Add opacity
          },
          borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
          borderWidth: 1
        }
      }
    },
    plugins: [ChartDataLabels]  // Register the datalabels plugin
  });
}

/**
 * Initialize charts on portfolio page
 */
function initializeCharts() {
  // Check if we're on portfolio page and chartData exists
  if (typeof chartData === 'undefined' || !chartData) {
    console.log('No chart data available');
    return;
  }

  // Ticker allocation chart
  if (chartData.ticker_allocation && Object.keys(chartData.ticker_allocation).length > 0) {
    const labels = Object.keys(chartData.ticker_allocation);
    const values = Object.values(chartData.ticker_allocation);
    if (labels.length > 0 && document.getElementById('tickerChart')) {
      createPieChart('tickerChart', labels, values, 'Allocation by Ticker');
    }
  }

  // Sector allocation chart
  if (chartData.sector_allocation && Object.keys(chartData.sector_allocation).length > 0) {
    const labels = Object.keys(chartData.sector_allocation);
    const values = Object.values(chartData.sector_allocation);
    if (labels.length > 0 && document.getElementById('sectorChart')) {
      createPieChart('sectorChart', labels, values, 'Allocation by Sector');
    }
  }
}

// Initialize charts when DOM is ready
document.addEventListener('DOMContentLoaded', initializeCharts);

// =============================================================================
// Position Form Allocation Type Toggle
// =============================================================================

function toggleAllocationType() {
  const percentageRadio = document.getElementById('type-percentage');
  const percentageInput = document.getElementById('percentage-input');
  const amountInput = document.getElementById('amount-input');
  const percentageField = document.getElementById('allocation_value_pct');
  const amountField = document.getElementById('allocation_value_amt');

  if (percentageRadio && percentageRadio.checked) {
    percentageInput.style.display = 'block';
    amountInput.style.display = 'none';
    percentageField.required = true;
    amountField.required = false;
    amountField.removeAttribute('name');
    percentageField.setAttribute('name', 'allocation_value');
  } else {
    percentageInput.style.display = 'none';
    amountInput.style.display = 'block';
    percentageField.required = false;
    amountField.required = true;
    percentageField.removeAttribute('name');
    amountField.setAttribute('name', 'allocation_value');
  }
}

// =============================================================================
// Refresh Portfolio Data
// =============================================================================

async function refreshPortfolioData(portfolioId) {
  const spinner = document.getElementById('refresh-spinner');
  const text = document.getElementById('refresh-text');

  // Show loading state
  if (spinner) spinner.style.display = 'inline-block';
  if (text) text.textContent = 'Refreshing...';

  try {
    const response = await fetch(`/api/portfolio/${portfolioId}/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      // Reload page to show updated data
      window.location.reload();
    } else {
      throw new Error('Refresh failed');
    }
  } catch (error) {
    console.error('Error refreshing data:', error);
    alert('Failed to refresh data. Please try again.');
  } finally {
    // Hide loading state
    if (spinner) spinner.style.display = 'none';
    if (text) text.textContent = 'Refresh Data';
  }
}

// =============================================================================
// Ticker Validation (Optional Enhancement)
// =============================================================================

let tickerValidationTimeout = null;

function validateTickerInput() {
  const tickerInput = document.getElementById('ticker');
  const validationMessage = document.getElementById('ticker-validation');

  if (!tickerInput || !validationMessage) return;

  tickerInput.addEventListener('input', function() {
    const ticker = this.value.trim().toUpperCase();

    // Clear previous timeout
    if (tickerValidationTimeout) {
      clearTimeout(tickerValidationTimeout);
    }

    if (ticker.length === 0) {
      validationMessage.textContent = '';
      validationMessage.className = 'text-muted';
      return;
    }

    validationMessage.textContent = 'Checking...';
    validationMessage.className = 'text-muted';

    // Debounce validation
    tickerValidationTimeout = setTimeout(async () => {
      try {
        const response = await fetch('/api/validate-ticker', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ticker: ticker })
        });

        const data = await response.json();

        if (data.valid) {
          validationMessage.textContent = '✓ ' + data.message;
          validationMessage.style.color = 'var(--color-gain)';
        } else {
          validationMessage.textContent = '✗ ' + data.message;
          validationMessage.style.color = 'var(--color-loss)';
        }
      } catch (error) {
        console.error('Validation error:', error);
        validationMessage.textContent = 'Unable to validate ticker';
        validationMessage.className = 'text-muted';
      }
    }, 800); // Wait 800ms after user stops typing
  });
}

// Initialize ticker validation when DOM is ready
document.addEventListener('DOMContentLoaded', validateTickerInput);

// =============================================================================
// Form Submission Handlers
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
  // Handle add position form
  const addPositionForm = document.getElementById('add-position-form');
  if (addPositionForm) {
    // Set up allocation type toggle
    const percentageRadio = document.getElementById('type-percentage');
    const amountRadio = document.getElementById('type-amount');

    if (percentageRadio) {
      percentageRadio.addEventListener('change', toggleAllocationType);
    }
    if (amountRadio) {
      amountRadio.addEventListener('change', toggleAllocationType);
    }

    // Initialize visibility
    toggleAllocationType();
  }

});

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format number as currency
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Format number as percentage
 */
function formatPercentage(value) {
  return value.toFixed(2) + '%';
}

/**
 * Debounce function for input validation
 */
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

// =============================================================================
// Dark/Light Mode Toggle
// =============================================================================

/**
 * Toggle between light and dark theme
 */
function toggleTheme() {
  const html = document.documentElement;
  const themeIcon = document.getElementById('theme-icon');
  const currentTheme = html.getAttribute('data-theme');

  if (currentTheme === 'dark') {
    html.setAttribute('data-theme', 'light');
    html.style.backgroundColor = '#F8FAFC';
    themeIcon.textContent = '🌙';
    localStorage.setItem('theme', 'light');
  } else {
    html.setAttribute('data-theme', 'dark');
    html.style.backgroundColor = '#020617';
    themeIcon.textContent = '☀️';
    localStorage.setItem('theme', 'dark');
  }
}

/**
 * Initialize theme from localStorage or system preference
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  const html = document.documentElement;
  const themeIcon = document.getElementById('theme-icon');

  if (savedTheme) {
    // Use saved theme (already set by inline script)
    themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  } else {
    // Check system preference (already set by inline script)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = prefersDark ? 'dark' : 'light';
    themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('theme', theme);
  }
}

// Initialize theme icon when DOM is ready
document.addEventListener('DOMContentLoaded', initializeTheme);

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  // Only auto-switch if user hasn't manually set a preference
  if (!localStorage.getItem('theme')) {
    const theme = e.matches ? 'dark' : 'light';
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    html.style.backgroundColor = theme === 'dark' ? '#020617' : '#F8FAFC';
    document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
  }
});

// =============================================================================
// Notes Functionality
// =============================================================================

/**
 * Update character count for textarea
 * @param {string} textareaId - ID of the textarea element
 * @param {string} counterId - ID of the counter span element
 * @param {number} maxLength - Maximum allowed characters
 */
function updateCharCount(textareaId, counterId, maxLength) {
  const textarea = document.getElementById(textareaId);
  const counter = document.getElementById(counterId);

  if (!textarea || !counter) return;

  const length = textarea.value.length;
  counter.textContent = length;

  // Visual feedback for character limit
  if (length > maxLength) {
    counter.style.color = 'var(--error, #EF4444)';
    textarea.style.borderColor = 'var(--error, #EF4444)';
  } else if (length > maxLength * 0.9) {
    counter.style.color = 'var(--warning, #F59E0B)';
    textarea.style.borderColor = 'var(--border-default)';
  } else {
    counter.style.color = 'var(--text-tertiary)';
    textarea.style.borderColor = 'var(--border-default)';
  }
}

// =============================================================================
// Notes Editor
// =============================================================================

let currentEditingPositionId = null;
let notesAutoSaveTimeout = null;

/**
 * Open notes editor modal
 * @param {number} positionId - ID of the position
 * @param {string} ticker - Ticker symbol
 * @param {string} notes - Current notes content
 */
function openNotesEditor(positionId, ticker, notes = '') {
  currentEditingPositionId = positionId;

  const modal = new bootstrap.Modal(document.getElementById('editNotesModal'));
  const editor = document.getElementById('notes-editor');
  const tickerSpan = document.getElementById('notes-ticker');

  // Set ticker display
  tickerSpan.textContent = ticker;

  // Set notes content
  editor.value = notes || '';

  // Update character count
  updateCharCount('notes-editor', 'notes-editor-char-count', 2000);

  // Clear save status
  document.getElementById('notes-save-status').textContent = '';

  // Show modal
  modal.show();
}

/**
 * Auto-save notes with debouncing
 */
function autoSaveNotes() {
  // Clear existing timeout
  if (notesAutoSaveTimeout) {
    clearTimeout(notesAutoSaveTimeout);
  }

  // Set new timeout to save after 1 second of inactivity
  notesAutoSaveTimeout = setTimeout(() => {
    saveNotes();
  }, 1000);
}

/**
 * Escape a string for safe use in JavaScript template literals
 * @param {string} str - String to escape
 * @returns {string} - Escaped string safe for template literals
 */
function escapeJS(str) {
  if (!str) return '';

  return str
    .replace(/\\/g, '\\\\')   // Backslash first
    .replace(/`/g, '\\`')      // Backtick
    .replace(/\$/g, '\\$')     // Dollar sign (template interpolation)
    .replace(/\r\n/g, '\\n')   // Windows newline
    .replace(/\r/g, '\\n')     // Old Mac newline
    .replace(/\n/g, '\\n')     // Unix newline
    .replace(/\t/g, '\\t');    // Tab
}

/**
 * Update notes preview in the table without reloading
 * @param {number} positionId - ID of the position
 * @param {string} notes - Updated notes content
 */
function updateNotesPreview(positionId, notes) {
  // Find the table row for this position
  const row = document.querySelector(`tr[data-position-id="${positionId}"]`);
  if (!row) return;

  // Find the notes input within this row
  const notesInput = row.querySelector('.notes-input');
  if (!notesInput) return;

  // Get ticker from the row for the onclick handler
  const tickerCell = row.querySelector('.ticker input');
  const ticker = tickerCell ? tickerCell.value : '';

  // Escape notes for onclick handler (use safe escaping function)
  const escapedNotes = escapeJS(notes);

  // Update onclick handler with new notes
  notesInput.setAttribute('onclick', `openNotesEditor(${positionId}, '${ticker}', \`${escapedNotes}\`)`);

  if (notes && notes.trim().length > 0) {
    // Show first 50 characters as preview
    const preview = notes.length > 50 ? notes.substring(0, 50) + '...' : notes;
    notesInput.value = preview;
  } else {
    // No notes - show the "Add note" placeholder
    notesInput.value = '+ Add note';
  }
}

/**
 * Save notes to server
 */
async function saveNotes() {
  if (!currentEditingPositionId) return;

  const editor = document.getElementById('notes-editor');
  const statusSpan = document.getElementById('notes-save-status');
  const notes = editor.value;

  // Show saving status
  statusSpan.textContent = 'Saving...';
  statusSpan.style.color = 'var(--text-tertiary)';

  try {
    const response = await fetch(`/portfolio/${portfolioId}/position/${currentEditingPositionId}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `notes=${encodeURIComponent(notes)}`
    });

    if (response.ok) {
      // Show saved status
      statusSpan.textContent = '✓ Saved';
      statusSpan.style.color = 'var(--success, #10B981)';

      // Update the notes preview in the table without reloading
      updateNotesPreview(currentEditingPositionId, notes);
    } else {
      // Show error status
      statusSpan.textContent = '✗ Error saving';
      statusSpan.style.color = 'var(--error, #EF4444)';
    }
  } catch (error) {
    console.error('Error saving notes:', error);
    statusSpan.textContent = '✗ Error saving';
    statusSpan.style.color = 'var(--error, #EF4444)';
  }
}

// ============================================================================
// Backup UI Functionality
// ============================================================================

let selectedBackupId = null;

// Load portfolios with backups on page load
async function loadBackupPortfolios() {
  try {
    const response = await fetch('/api/backups/portfolios');
    const portfolios = await response.json();

    const select = document.getElementById('restorePortfolioSelect');
    if (!select) return; // Not on index page

    select.innerHTML = '<option value="">-- Choose portfolio --</option>';

    for (const [portfolioId, info] of Object.entries(portfolios)) {
      const option = document.createElement('option');
      option.value = portfolioId;
      option.textContent = `${info.portfolio_name} (${info.backup_count} backups)`;
      select.appendChild(option);
    }
  } catch (error) {
    console.error('Failed to load backup portfolios:', error);
  }
}

// Load backups for selected portfolio
async function loadPortfolioBackups(portfolioId) {
  const select = document.getElementById('restoreBackupSelect');
  select.innerHTML = '<option value="">-- Loading... --</option>';
  select.disabled = true;

  try {
    const response = await fetch(`/api/portfolio/${portfolioId}/backups`);
    const backups = await response.json();

    select.innerHTML = '<option value="">-- Choose backup version --</option>';

    backups.forEach(backup => {
      const option = document.createElement('option');
      option.value = backup.id;
      const date = new Date(backup.backup_timestamp);
      option.textContent = `${date.toLocaleString()} - ${backup.operation_type} (${backup.file_size_kb} KB)`;
      option.dataset.backup = JSON.stringify(backup);
      select.appendChild(option);
    });

    select.disabled = false;
  } catch (error) {
    console.error('Failed to load backups:', error);
    select.innerHTML = '<option value="">-- Error loading backups --</option>';
  }
}

// Show backup details when selected
function showBackupInfo(backupData) {
  const infoDiv = document.getElementById('backupInfo');
  const contentDiv = document.getElementById('backupInfoContent');

  contentDiv.innerHTML = `
    <ul class="list-unstyled mb-0">
      <li><strong>Portfolio:</strong> ${backupData.portfolio_name}</li>
      <li><strong>Created:</strong> ${new Date(backupData.backup_timestamp).toLocaleString()}</li>
      <li><strong>Operation:</strong> ${backupData.operation_type}</li>
      <li><strong>Size:</strong> ${backupData.file_size_kb} KB</li>
    </ul>
  `;

  infoDiv.style.display = 'block';
}

// Manual backup
async function createManualBackup(portfolioId, portfolioName) {
  if (!confirm(`Create manual backup of "${portfolioName}"?`)) return;

  try {
    const response = await fetch(`/portfolio/${portfolioId}/backup`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'}
    });

    const result = await response.json();

    if (result.success) {
      alert(`Backup created successfully!\nBackup ID: ${result.backup_id}`);
      loadBackupPortfolios(); // Refresh dropdown
    } else {
      alert(`Backup failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Manual backup failed:', error);
    alert('Backup request failed. Check console for details.');
  }
}

// Restore backup
async function restoreBackup(backupId, strategy) {
  try {
    const response = await fetch(`/backup/${backupId}/restore`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({strategy: strategy})
    });

    const result = await response.json();

    if (result.success) {
      alert(result.message);
      window.location.href = `/portfolio/${result.portfolio_id}`;
    } else {
      alert(`Restore failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Restore failed:', error);
    alert('Restore request failed. Check console for details.');
  }
}

// Delete backup
async function deleteBackup(backupId, backupData) {
  try {
    const response = await fetch(`/backup/${backupId}/delete`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'}
    });

    const result = await response.json();

    if (result.success) {
      // Close modal
      bootstrap.Modal.getInstance(document.getElementById('deleteBackupModal')).hide();

      // Show success message
      alert(`Backup deleted: ${result.portfolio_name} (${result.operation_type})`);

      // Get current portfolio ID before refreshing
      const portfolioSelect = document.getElementById('restorePortfolioSelect');
      const currentPortfolioId = portfolioSelect.value;

      // Reload portfolio dropdown to update backup counts
      await loadBackupPortfolios();

      // Restore portfolio selection and reload its backups
      if (currentPortfolioId) {
        portfolioSelect.value = currentPortfolioId;
        await loadPortfolioBackups(currentPortfolioId);
      }

      // Clear selection and hide info
      document.getElementById('backupInfo').style.display = 'none';
      document.getElementById('restoreBackupBtn').disabled = true;
      document.getElementById('deleteBackupBtn').disabled = true;
      selectedBackupId = null;

    } else {
      alert(`Delete failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Delete backup failed:', error);
    alert('Delete request failed. Check console for details.');
  }
}

// Event listeners for backup UI
document.addEventListener('DOMContentLoaded', function() {
  // Only run on index page (check if elements exist)
  if (!document.getElementById('restorePortfolioSelect')) return;

  loadBackupPortfolios();

  // Portfolio selection changed
  document.getElementById('restorePortfolioSelect').addEventListener('change', function() {
    const portfolioId = this.value;
    const backupSelect = document.getElementById('restoreBackupSelect');
    const restoreBtn = document.getElementById('restoreBackupBtn');
    const deleteBtn = document.getElementById('deleteBackupBtn');
    const infoDiv = document.getElementById('backupInfo');

    if (portfolioId) {
      loadPortfolioBackups(portfolioId);
    } else {
      backupSelect.innerHTML = '<option value="">-- Select portfolio first --</option>';
      backupSelect.disabled = true;
      restoreBtn.disabled = true;
      deleteBtn.disabled = true;
      infoDiv.style.display = 'none';
    }
  });

  // Backup version selected
  document.getElementById('restoreBackupSelect').addEventListener('change', function() {
    const restoreBtn = document.getElementById('restoreBackupBtn');
    const deleteBtn = document.getElementById('deleteBackupBtn');
    selectedBackupId = this.value;

    if (selectedBackupId) {
      const selectedOption = this.options[this.selectedIndex];
      const backupData = JSON.parse(selectedOption.dataset.backup);
      showBackupInfo(backupData);
      restoreBtn.disabled = false;
      deleteBtn.disabled = false;
    } else {
      document.getElementById('backupInfo').style.display = 'none';
      restoreBtn.disabled = true;
      deleteBtn.disabled = true;
    }
  });

  // Restore button clicked - show modal
  document.getElementById('restoreBackupBtn').addEventListener('click', function() {
    if (!selectedBackupId) return;

    const selectedOption = document.querySelector('#restoreBackupSelect option:checked');
    const backupData = JSON.parse(selectedOption.dataset.backup);

    document.getElementById('restoreBackupDetails').innerHTML = `
      <ul class="list-unstyled">
        <li><strong>Portfolio:</strong> ${backupData.portfolio_name}</li>
        <li><strong>Date:</strong> ${new Date(backupData.backup_timestamp).toLocaleString()}</li>
        <li><strong>Type:</strong> ${backupData.operation_type}</li>
      </ul>
    `;

    const modal = new bootstrap.Modal(document.getElementById('restoreBackupModal'));
    modal.show();
  });

  // Confirm restore
  document.getElementById('confirmRestoreBtn').addEventListener('click', function() {
    const strategy = document.querySelector('input[name="restoreStrategy"]:checked').value;

    if (strategy === 'overwrite') {
      if (!confirm('WARNING: This replaces current data. Pre-restore backup will be created. Continue?')) {
        return;
      }
    }

    restoreBackup(selectedBackupId, strategy);
    bootstrap.Modal.getInstance(document.getElementById('restoreBackupModal')).hide();
  });

  // Delete button clicked - show modal
  document.getElementById('deleteBackupBtn').addEventListener('click', function() {
    if (!selectedBackupId) return;

    const selectedOption = document.querySelector('#restoreBackupSelect option:checked');
    const backupData = JSON.parse(selectedOption.dataset.backup);

    // Populate modal with backup details
    document.getElementById('deleteBackupDetails').innerHTML = `
      <ul class="list-unstyled">
        <li><strong>Portfolio:</strong> ${backupData.portfolio_name}</li>
        <li><strong>Date:</strong> ${new Date(backupData.backup_timestamp).toLocaleString()}</li>
        <li><strong>Type:</strong> ${backupData.operation_type}</li>
        <li><strong>Size:</strong> ${backupData.file_size_kb} KB</li>
      </ul>
    `;

    // Show/hide conditional warnings
    const preRestoreWarning = document.getElementById('deleteBackupWarningPreRestore');
    if (backupData.operation_type === 'pre_restore') {
      preRestoreWarning.style.display = 'block';
    } else {
      preRestoreWarning.style.display = 'none';
    }

    const modal = new bootstrap.Modal(document.getElementById('deleteBackupModal'));
    modal.show();
  });

  // Confirm delete
  document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
    const selectedOption = document.querySelector('#restoreBackupSelect option:checked');
    const backupData = JSON.parse(selectedOption.dataset.backup);
    deleteBackup(selectedBackupId, backupData);
  });
});

