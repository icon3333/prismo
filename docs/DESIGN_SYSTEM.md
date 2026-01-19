# Design System Document: Ocean Depth UI

## Purpose
This document serves as a comprehensive reference for LLM design/coding agents to replicate the "Allocation Simulator" design across the entire portfolio management application.

---

## 1. COLOR PALETTE

### 1.1 Dark Mode (Primary Theme)

#### Backgrounds (Layered Depth)
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#020617` | Page background (ocean-950) |
| `--bg-secondary` | `#0F172A` | Card/panel backgrounds (ocean-900) |
| `--bg-tertiary` | `#1E293B` | Slider items, inset areas (ocean-800) |

#### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#F8FAFC` | Primary text (pearl-50) |
| `--text-secondary` | `#F1F5F9` | Secondary text (pearl-100) |
| `--text-muted` | `#94A3B8` | Muted labels, hints |

#### Accent Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` | `#06B6D4` | Primary action, sliders, links (aqua-500) |
| `--primary-hover` | `#22D3EE` | Hover states (aqua-400) |
| `--success` | `#14B8A6` | Positive values, success (teal-500) |
| `--danger` | `#EF4444` | Errors, warnings, "OVER" states |
| `--warning` | `#F97316` | Warning highlights (coral-500) |

#### Borders
| Token | Value | Usage |
|-------|-------|-------|
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Faint dividers |
| `--border-default` | `rgba(255, 255, 255, 0.15)` | Standard borders |
| `--border-strong` | `rgba(255, 255, 255, 0.3)` | Emphasized borders |

#### Special Overlays
| Token | Value | Usage |
|-------|-------|-------|
| `--primary-light` | `rgba(6, 182, 212, 0.15)` | Aqua tinted backgrounds |
| `--danger-light` | `rgba(239, 68, 68, 0.1)` | Error state backgrounds |

---

## 2. TYPOGRAPHY

### Font Stack
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Type Scale
| Element | Size | Weight | Usage |
|---------|------|--------|-------|
| Page Title | `1.5rem` | 700 | Main page heading |
| Section Title | `1.25rem` | 600 | Section headers |
| Card Title | `1rem` | 600 | Panel/card headers |
| Body | `0.875rem` (14px) | 400-500 | Regular content |
| Small/Meta | `0.75rem` (12px) | 400-500 | Labels, constraints |
| Large Value | `1.5rem` | 600 | Highlighted amounts |

### Letter Spacing
- Headings: `-0.02em` (tighter)
- Body: `normal`
- Uppercase labels: `0.05em` (wider)

---

## 3. SPACING SYSTEM (8px Base)

```css
--space-xs: 0.25rem;   /* 4px */
--space-sm: 0.5rem;    /* 8px */
--space-md: 1rem;      /* 16px */
--space-lg: 1.5rem;    /* 24px */
--space-xl: 2rem;      /* 32px */
```

### Common Patterns
- **Card padding**: `var(--space-md)` (16px)
- **Gap between panels**: `var(--space-lg)` (24px)
- **Item spacing in lists**: `var(--space-md)` (16px)
- **Tight internal spacing**: `var(--space-xs)` to `var(--space-sm)`

---

## 4. BORDER RADIUS

```css
--radius-sm: 0.375rem;  /* 6px */
--radius-md: 0.5rem;    /* 8px - Standard for cards/panels */
--radius-lg: 0.75rem;   /* 12px */
--radius-full: 9999px;  /* Pill shapes */
```

**Design Choice**: Use `--radius-md` (8px) consistently for cards, panels, slider items.

---

## 5. SHADOWS

**Critical**: This design uses **NO BOX SHADOWS**. All depth is conveyed through:
- Background color layering
- Border colors
- Subtle opacity differences

```css
--shadow-xs: none;
--shadow-sm: none;
--shadow-md: none;
/* etc. */
```

---

## 6. TRANSITIONS & ANIMATIONS

### Timing Functions
```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-smooth: 350ms cubic-bezier(0.4, 0, 0.2, 1);
--spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* Framer-like bounce */
```

### Animation Patterns
- **Hover states**: `all var(--transition-base)`
- **Progress bars**: `width 0.3s ease`
- **Slider thumbs**: `transform 0.1s ease`
- **Panel fade-in**: `opacity 0.2s ease, transform 0.2s ease`

---

## 7. COMPONENT PATTERNS

### 7.1 Two-Panel Layout
The signature layout for the Allocation Simulator.

```html
<div class="simulator-panels">
  <div class="simulator-panel simulator-panel-primary">
    <!-- Editable content (sliders) -->
  </div>
  <div class="simulator-panel simulator-panel-secondary">
    <!-- Derived/read-only content -->
  </div>
</div>
```

```css
.simulator-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-lg);
}

.simulator-panel {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  padding: var(--space-md);
}

.simulator-panel-primary {
  border-color: var(--primary);
  border-width: 2px;
}
```

**Key Details**:
- Primary panel has **2px aqua border** to indicate editability
- Secondary panel has standard 1px border, slightly muted (opacity: 0.95)

---

### 7.2 Panel Header/Footer

```html
<div class="panel-header">
  <h4 class="panel-title">
    <i class="fas fa-globe"></i> Title
  </h4>
  <span class="panel-subtitle">(helper text)</span>
</div>

<div class="panel-footer">
  <span class="panel-total-label">Total:</span>
  <span class="panel-total-value">€X,XXX / €Y,YYY</span>
</div>
```

```css
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-default);
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.panel-subtitle {
  font-size: 0.75rem;
  color: var(--text-muted);
}
```

---

### 7.3 Slider Item (Interactive)

```html
<div class="slider-item">
  <div class="slider-header">
    <span class="slider-name">United States</span>
    <span class="slider-value">€5,000</span>
  </div>

  <div class="slider-track-container">
    <input type="range" class="slider-input" min="0" max="10000" value="5000">
    <div class="slider-fill" style="width: 50%"></div>
  </div>

  <div class="slider-footer">
    <span class="slider-constraint constraint-ok">50% of 100% max</span>
    <span class="slider-current">Current: €4,500</span>
  </div>
</div>
```

```css
.slider-item {
  background: rgba(6, 182, 212, 0.05);  /* Very subtle aqua tint */
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
}

.slider-item:hover {
  background: rgba(6, 182, 212, 0.1);
}

/* Over limit state */
.slider-item.slider-over-limit {
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid var(--danger);
}
```

---

### 7.4 Range Slider Styling

```css
/* Track */
.slider-input {
  -webkit-appearance: none;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  outline: none;
  cursor: pointer;
}

/* Thumb (Handle) */
.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--primary);  /* Aqua */
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  cursor: grab;
}

.slider-input::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider-input::-webkit-slider-thumb:active {
  cursor: grabbing;
  transform: scale(1.15);
}

/* Fill gradient */
.slider-fill {
  background: linear-gradient(90deg, #06B6D4 0%, #14B8A6 100%);
  /* aqua → teal gradient */
}
```

---

### 7.5 Progress Bar (Read-Only)

```html
<div class="progress-bar-bg">
  <div class="progress-bar-fill" style="width: 65%"></div>
</div>
```

```css
.progress-bar-bg {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--primary) 0%, #14B8A6 100%);
  transition: width 0.3s ease;
}

/* Over limit */
.progress-bar-fill.fill-over {
  background: linear-gradient(90deg, #EF4444 0%, #F87171 100%);
}
```

---

### 7.6 Constraint Warnings Panel

```html
<div class="constraint-warnings">
  <div class="warnings-header">
    <i class="fas fa-exclamation-triangle"></i>
    Constraint Warnings
  </div>
  <div class="warnings-content">
    <div class="warning-group">
      <i class="fas fa-globe"></i>
      <span>1 country limit exceeded:</span>
      <span class="warning-names">United States (22.3%)</span>
    </div>
  </div>
</div>
```

```css
.constraint-warnings {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.warnings-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--danger);  /* Coral/red */
  font-weight: 600;
}

.warning-names {
  color: var(--danger);
  font-weight: 500;
}
```

---

### 7.7 Collapsible Card

```html
<div class="card">
  <div class="card-header" onclick="toggle()">
    <h3 class="card-header-title">Allocation Simulator</h3>
    <button class="card-header-icon">
      <i class="fas fa-angle-down"></i>
    </button>
  </div>
  <div class="card-content" style="display: none;">
    <!-- Content -->
  </div>
</div>
```

```css
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding-bottom: var(--space-sm);
}

.card-header-title {
  font-size: 1.5rem;
  font-weight: 700;
}

.card-header-icon {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
}
```

---

### 7.8 Tab Navigation

```css
.nav-tabs {
  display: flex;
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  border-bottom: 1px solid var(--border-default);
}

.nav-tabs .nav-link {
  border: none;
  color: var(--text-muted);
  padding: var(--space-md);
  background-color: var(--bg-tertiary);
}

.nav-tabs .nav-link:hover {
  color: var(--text-primary);
  background-color: var(--primary-light);
}

.nav-tabs .nav-link.active {
  color: var(--primary);
  font-weight: 600;
  border-bottom: 3px solid var(--primary);
  background-color: var(--bg-secondary);
}
```

---

### 7.9 Buttons

The application uses a unified button system based on `.button.is-*` classes. See Section 17 for the complete reference.

#### Quick Usage
```html
<!-- Primary CTA -->
<button class="button is-primary">Save Changes</button>

<!-- Secondary/Neutral -->
<button class="button">Cancel</button>

<!-- Danger -->
<button class="button is-danger">Delete</button>

<!-- Outlined variant -->
<button class="button is-primary is-outlined">Edit</button>

<!-- Small size -->
<button class="button is-primary is-small">Compact</button>
```

#### Sort/Filter Pills (Specialized)
```css
.sort-btn {
  padding: 4px 10px;
  font-size: 0.7rem;
  border-radius: 20px;  /* Pill shape */
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}

.sort-btn.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}
```

---

## 8. STATE PATTERNS

### 8.1 Error/Over Limit State
When a constraint is exceeded:

```css
/* Background tint */
background: rgba(239, 68, 68, 0.1);

/* Left border accent */
border-left: 3px solid var(--danger);

/* Text color */
color: var(--danger);  /* #EF4444 */

/* Progress bar gradient */
background: linear-gradient(90deg, #EF4444 0%, #F87171 100%);
```

### 8.2 Success/Positive State
```css
color: var(--success);  /* #14B8A6 */
```

### 8.3 Hover State
```css
/* Subtle background shift */
background: rgba(6, 182, 212, 0.1);  /* Aqua 10% */

/* Or for interactive elements */
background: var(--primary-light);
```

---

## 9. RESPONSIVE BREAKPOINTS

```css
/* Tablet */
@media (max-width: 992px) {
  .simulator-panels {
    grid-template-columns: 1fr;  /* Stack panels */
  }
}

/* Mobile */
@media (max-width: 576px) {
  .slider-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
```

---

## 10. TABLES

### 10.1 Unified Table Structure

```html
<div class="table-container">
  <table class="table unified-table is-striped is-hoverable is-fullwidth">
    <thead>
      <tr>
        <th class="col-company">Company</th>
        <th class="col-percentage">Allocation</th>
        <th class="col-currency">Value</th>
      </tr>
    </thead>
    <tbody>
      <tr class="category-row">
        <td colspan="3">Category Name</td>
      </tr>
      <tr class="position-row">
        <td class="col-company">Position Name</td>
        <td class="col-percentage">25%</td>
        <td class="col-currency">€10,000</td>
      </tr>
      <tr class="total-row">
        <td>Total</td>
        <td>100%</td>
        <td>€40,000</td>
      </tr>
    </tbody>
  </table>
</div>
```

### 10.2 Table CSS

```css
.table-container {
  overflow-x: auto;
  border-radius: var(--radius-md);
}

.unified-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-secondary);
}

.unified-table th {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-default);
  text-align: left;
}

.unified-table td {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

/* Category Row - Collapsible header */
.category-row {
  background-color: var(--bg-tertiary) !important;
  font-weight: 500;
  cursor: pointer;
}

.category-row:hover {
  background-color: var(--primary-light) !important;
}

/* Position Row - Indented under category */
.position-row td:first-child {
  padding-left: var(--space-lg);
}

/* Total Row - Summary footer */
.total-row {
  background-color: var(--bg-tertiary) !important;
  font-weight: 600;
}

.total-row td {
  border-top: 2px solid var(--primary);
  border-bottom: none;
}

/* Striped rows */
.table.is-striped tbody tr:nth-child(odd) {
  background-color: var(--bg-tertiary);
}

/* Hover state */
.table.is-hoverable tbody tr:hover {
  background-color: var(--primary-light);
}
```

### 10.3 Column Width Classes

```css
.col-checkbox { width: 40px; text-align: center; }
.col-identifier { min-width: 100px; }
.col-company { min-width: 200px; text-align: left; }
.col-price { min-width: 100px; text-align: right; }
.col-currency { min-width: 120px; text-align: right; }
.col-percentage { min-width: 80px; text-align: right; }
.col-input-small { width: 120px; }
.col-input-medium { width: 150px; }
```

---

## 11. FORMS & INPUTS

### 11.1 Text Input

```html
<div class="field">
  <label class="label">Field Label</label>
  <div class="control">
    <input class="input" type="text" placeholder="Enter value">
  </div>
</div>
```

```css
.input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.input:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--bg-secondary);
}

.input::placeholder {
  color: var(--text-muted);
}

/* Compact size for tables */
.input.is-small {
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
}
```

### 11.2 Select Dropdown

```html
<div class="field">
  <label class="label">Select Option</label>
  <div class="control">
    <div class="select is-fullwidth">
      <select>
        <option>Option 1</option>
        <option>Option 2</option>
      </select>
    </div>
  </div>
</div>
```

```css
.select select {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  padding-right: 2.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,..."); /* Dropdown arrow */
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
}

.select select:focus {
  outline: none;
  border-color: var(--primary);
}
```

### 11.3 Checkbox & Radio

```html
<label class="checkbox">
  <input type="checkbox"> Remember me
</label>

<label class="radio">
  <input type="radio" name="mode" value="1"> Option A
</label>
```

```css
.checkbox input[type="checkbox"],
.radio input[type="radio"] {
  margin-right: var(--space-xs);
  accent-color: var(--primary);
}

.checkbox,
.radio {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  cursor: pointer;
  color: var(--text-primary);
}
```

### 11.4 File Upload

```html
<div class="file has-name is-fullwidth">
  <label class="file-label">
    <input class="file-input" type="file" accept=".csv">
    <span class="file-cta">
      <span class="file-icon"><i class="fas fa-upload"></i></span>
      <span class="file-label">Choose a file...</span>
    </span>
    <span class="file-name">No file selected</span>
  </label>
</div>
```

### 11.5 Input States

```css
/* User-edited field (warning) */
.input.user-edited {
  border-color: var(--warning);
  background: rgba(249, 115, 22, 0.1);
}

/* Error state */
.input.is-danger {
  border-color: var(--danger);
}

/* Success state */
.input.is-success {
  border-color: var(--success);
}

/* Loading button */
.button.is-loading {
  color: transparent !important;
  pointer-events: none;
}

.button.is-loading::after {
  content: "";
  position: absolute;
  width: 1em;
  height: 1em;
  border: 2px solid var(--border-default);
  border-right-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
```

---

## 12. MODALS & DIALOGS

### 12.1 Modal Structure

```html
<div class="modal" id="my-modal">
  <div class="modal-background"></div>
  <div class="modal-card">
    <header class="modal-card-head">
      <p class="modal-card-title">Modal Title</p>
      <button class="delete" aria-label="close"></button>
    </header>
    <section class="modal-card-body">
      <!-- Modal content -->
    </section>
    <footer class="modal-card-foot">
      <button class="button is-primary">Save</button>
      <button class="button">Cancel</button>
    </footer>
  </div>
</div>
```

### 12.2 Modal CSS

```css
.modal {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  align-items: center;
  justify-content: center;
}

.modal.is-active {
  display: flex;
}

.modal-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
}

.modal-card {
  position: relative;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.modal-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-default);
}

.modal-card-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-card-body {
  padding: var(--space-lg);
  overflow-y: auto;
}

.modal-card-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-default);
}

/* Close button */
.delete {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 24px;
  height: 24px;
  position: relative;
}

.delete::before,
.delete::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 2px;
  background: var(--text-muted);
}

.delete::before { transform: translate(-50%, -50%) rotate(45deg); }
.delete::after { transform: translate(-50%, -50%) rotate(-45deg); }

.delete:hover::before,
.delete:hover::after {
  background: var(--text-primary);
}
```

---

## 13. STATUS BADGES & TAGS

### 13.1 Tag Variants

```html
<span class="tag is-primary">Primary</span>
<span class="tag is-success">Success</span>
<span class="tag is-warning">Warning</span>
<span class="tag is-danger">Danger</span>
<span class="tag is-info">Info</span>
<span class="tag is-light">Light</span>
```

```css
.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.tag.is-primary {
  background: rgba(6, 182, 212, 0.15);
  color: var(--primary);
}

.tag.is-success {
  background: rgba(20, 184, 166, 0.15);
  color: var(--success);
}

.tag.is-warning {
  background: rgba(249, 115, 22, 0.15);
  color: var(--warning);
}

.tag.is-danger {
  background: rgba(239, 68, 68, 0.15);
  color: var(--danger);
}

.tag.is-info {
  background: rgba(6, 182, 212, 0.15);
  color: var(--primary);
}

.tag.is-light {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.tag.is-small {
  font-size: 0.7rem;
  padding: 1px 6px;
}
```

### 13.2 Status Badges

```html
<span class="status-badge status-available">
  <i class="fas fa-check"></i> Available
</span>
<span class="status-badge status-constrained">
  <i class="fas fa-exclamation"></i> Constrained
</span>
<span class="status-badge status-blocked">
  <i class="fas fa-ban"></i> Blocked
</span>
```

```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 500;
}

.status-available {
  background: rgba(20, 184, 166, 0.15);
  color: var(--success);
}

.status-constrained {
  background: rgba(249, 115, 22, 0.15);
  color: var(--warning);
}

.status-blocked {
  background: rgba(239, 68, 68, 0.15);
  color: var(--danger);
}
```

### 13.3 Investment Type Badge

```html
<span class="badge badge-sector">Stock</span>
<span class="badge badge-sector">ETF</span>
```

```css
.badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 0.7rem;
  font-weight: 500;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.badge-gain {
  border-left: 3px solid var(--success);
}

.badge-loss {
  border-left: 3px solid var(--danger);
}
```

---

## 14. TOOLTIPS

### 14.1 HTML Structure

```html
<span class="has-tooltip-right" data-tooltip="Tooltip text here">
  <i class="fas fa-question-circle"></i>
</span>
```

### 14.2 Tooltip CSS

```css
[data-tooltip] {
  position: relative;
  cursor: help;
}

[data-tooltip]::before {
  content: attr(data-tooltip);
  position: absolute;
  display: none;
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--text-primary);
  white-space: nowrap;
  z-index: 100;
}

[data-tooltip]:hover::before {
  display: block;
}

/* Positions */
.has-tooltip-right::before {
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: var(--space-xs);
}

.has-tooltip-top::before {
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: var(--space-xs);
}

.has-tooltip-bottom::before {
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: var(--space-xs);
}

.has-tooltip-left::before {
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-right: var(--space-xs);
}
```

---

## 15. LOADING STATES

### 15.1 Spinner

```html
<div class="spinner-border" role="status">
  <span class="visually-hidden">Loading...</span>
</div>
```

```css
.spinner-border {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  border: 3px solid var(--border-default);
  border-right-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

### 15.2 Progress Bar

```html
<div class="progress">
  <div class="progress-bar progress-bar-striped progress-bar-animated"
       style="width: 60%"></div>
</div>
```

```css
.progress {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--primary) 0%, var(--success) 100%);
  transition: width 0.3s ease;
}

.progress-bar-striped {
  background-image: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.15) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.15) 50%,
    rgba(255, 255, 255, 0.15) 75%,
    transparent 75%,
    transparent
  );
  background-size: 1rem 1rem;
}

.progress-bar-animated {
  animation: progress-bar-stripes 1s linear infinite;
}

@keyframes progress-bar-stripes {
  0% { background-position: 1rem 0; }
  100% { background-position: 0 0; }
}
```

### 15.3 Loading Container

```html
<div class="loading-container">
  <div class="spinner-border"></div>
  <p class="loading-text">Loading data...</p>
</div>
```

```css
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-xl);
  gap: var(--space-md);
}

.loading-text {
  color: var(--text-muted);
  font-size: 0.875rem;
}
```

---

## 16. ALERTS & NOTIFICATIONS

### 16.1 Alert Structure

```html
<div class="alert alert-success">
  <i class="fas fa-check-circle"></i>
  <span>Operation completed successfully!</span>
  <button class="alert-close">&times;</button>
</div>
```

### 16.2 Alert CSS

```css
.alert {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border-left: 4px solid;
  margin-bottom: var(--space-md);
}

.alert-success {
  background: rgba(20, 184, 166, 0.1);
  border-left-color: var(--success);
  color: var(--success);
}

.alert-warning {
  background: rgba(249, 115, 22, 0.1);
  border-left-color: var(--warning);
  color: var(--warning);
}

.alert-error,
.alert-danger {
  background: rgba(239, 68, 68, 0.1);
  border-left-color: var(--danger);
  color: var(--danger);
}

.alert-info {
  background: rgba(6, 182, 212, 0.1);
  border-left-color: var(--primary);
  color: var(--primary);
}

.alert-close {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
}

.alert-close:hover {
  opacity: 1;
}
```

### 16.3 Notification (Toast)

```html
<div class="notification is-success">
  <button class="delete"></button>
  Success! Your changes have been saved.
</div>
```

```css
.notification {
  position: relative;
  padding: var(--space-md) var(--space-lg);
  padding-right: 3rem;
  border-radius: var(--radius-md);
  color: var(--text-primary);
}

.notification.is-success {
  background: rgba(20, 184, 166, 0.15);
  border: 1px solid var(--success);
}

.notification.is-warning {
  background: rgba(249, 115, 22, 0.15);
  border: 1px solid var(--warning);
}

.notification.is-danger {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid var(--danger);
}

.notification .delete {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
}
```

### 16.4 Auto-Dismiss Behavior (JS)

```javascript
// Auto-dismiss after 5 seconds
setTimeout(() => {
  notification.style.opacity = '0';
  notification.style.transition = 'opacity 0.3s ease';
  setTimeout(() => notification.remove(), 300);
}, 5000);
```

---

## 17. BUTTONS (Unified System)

The application uses a single, unified button system based on `.button.is-*` classes.
All buttons use `border-radius: var(--radius-md)` (8px) to match other components.

### 17.1 Base Button

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  font-size: 0.875rem;
  font-weight: 500;
  font-family: var(--font-sans);
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-decoration: none;
  white-space: nowrap;
}

.button:hover {
  background: var(--bg-tertiary);
  border-color: var(--text-primary);
}
```

### 17.2 Semantic Variants

```css
/* Primary - Aqua CTA */
.button.is-primary {
  background: var(--aqua-500);
  color: var(--white);
  border-color: var(--aqua-500);
}

/* Danger - Red destructive */
.button.is-danger {
  background: transparent;
  color: var(--error);
  border-color: var(--error);
}

/* Success - Teal positive */
.button.is-success {
  background: var(--teal-500);
  color: var(--white);
  border-color: var(--teal-500);
}

/* Warning - Coral caution */
.button.is-warning {
  background: var(--coral-500);
  color: var(--white);
  border-color: var(--coral-500);
}

/* Info - Aqua informational */
.button.is-info {
  background: var(--aqua-500);
  color: var(--white);
  border-color: var(--aqua-500);
}

/* Light - Neutral subtle */
.button.is-light {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--border-subtle);
}

/* Ghost - Text-like minimal */
.button.is-ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: transparent;
}
```

### 17.3 Sizes

```css
/* Small - Compact for tables and tight spaces */
.button.is-small {
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
}

/* Medium - Emphasized */
.button.is-medium {
  padding: 0.75rem 1.25rem;
  font-size: 1rem;
}

/* Large - Hero/prominent */
.button.is-large {
  padding: 1rem 1.5rem;
  font-size: 1.125rem;
}
```

### 17.4 Modifiers

```css
/* Outlined - Transparent background with border */
.button.is-outlined {
  background: transparent;
}

.button.is-outlined.is-primary {
  color: var(--aqua-500);
  border-color: var(--aqua-500);
  background: transparent;
}

.button.is-outlined.is-primary:hover {
  background: var(--aqua-500);
  color: var(--white);
}

/* Full width */
.button.is-fullwidth {
  width: 100%;
}

/* Rounded/Pill shape */
.button.is-rounded {
  border-radius: 9999px;
}

/* Loading state */
.button.is-loading {
  color: transparent !important;
  pointer-events: none;
}
```

### 17.5 Usage Examples

```html
<!-- Primary CTA -->
<button class="button is-primary">Save Changes</button>

<!-- Secondary/Cancel -->
<button class="button">Cancel</button>

<!-- Danger action -->
<button class="button is-danger">Delete</button>

<!-- Outlined primary -->
<button class="button is-primary is-outlined">Edit</button>

<!-- Small button in table -->
<button class="button is-primary is-small">View</button>

<!-- Full-width button -->
<button class="button is-primary is-fullwidth">Submit</button>

<!-- Button group -->
<div class="buttons">
  <button class="button is-primary">Save</button>
  <button class="button">Cancel</button>
</div>
```

### 17.6 Migration Notes

The following legacy classes have been removed and should be replaced:

| Old Class | New Class |
|-----------|-----------|
| `btn btn-primary` | `button is-primary` |
| `btn btn-accent` | `button is-primary` |
| `btn btn-secondary` | `button` or `button is-light` |
| `btn btn-danger` | `button is-danger` |
| `btn btn-outline-primary` | `button is-primary is-outlined` |
| `btn btn-outline-secondary` | `button is-light` |
| `btn-sm` / `btn-compact` | `is-small` |
| `simulator-btn-primary` | `button is-primary` |
| `simulator-btn-secondary` | `button` |

---

## 18. DESIGN PRINCIPLES

1. **Depth Through Color**: Use layered backgrounds (#020617 → #0F172A → #1E293B) instead of shadows
2. **Aqua Accent**: Primary color (#06B6D4) for interactive elements and emphasis
3. **Coral for Danger**: Use #EF4444 consistently for errors and warnings
4. **Minimal UI**: No box shadows, no excessive gradients, clean lines
5. **Two-Panel Hierarchy**: Primary (editable) on left with aqua border, secondary (derived) on right
6. **Gradient Fills**: Use aqua→teal gradient for progress indicators
7. **Accessible Contrast**: Ensure text meets WCAG AA on dark backgrounds
8. **Consistent 8px Grid**: All spacing based on multiples of 8px
9. **Left Border Accents**: Use colored left borders (3-4px) to indicate state/category
10. **Semantic Colors**: Always use CSS variables, never hardcoded colors

---

## 19. IMPLEMENTATION CHECKLIST

When applying this design to new components:

### Color & Theme
- [ ] Use correct background layer (`--bg-primary`, `--bg-secondary`, or `--bg-tertiary`)
- [ ] Apply `--primary` (#06B6D4) for interactive accents
- [ ] Use `--danger` (#EF4444) for error states with 10% opacity backgrounds
- [ ] Use `--success` (#14B8A6) for positive states
- [ ] Use `--warning` (#F97316) for warning states
- [ ] Test dark mode appearance

### Layout & Spacing
- [ ] Set `border-radius: var(--radius-md)` (8px) on cards/panels
- [ ] Remove any box-shadows
- [ ] Use 8px-based spacing (`--space-xs`, `--space-sm`, `--space-md`, `--space-lg`)
- [ ] Ensure responsive behavior at 992px and 576px breakpoints

### Interactions
- [ ] Include hover states with subtle background changes
- [ ] Add transitions using `var(--transition-base)`
- [ ] Ensure clickable elements have `cursor: pointer`

### Typography
- [ ] Use Inter font family
- [ ] Apply correct font weights (400 body, 500 labels, 600-700 headings)
- [ ] Use appropriate text colors (`--text-primary`, `--text-secondary`, `--text-muted`)

### Components
- [ ] Tables: Use `unified-table` class pattern
- [ ] Forms: Use Bulma-style `.field` > `.control` > `.input` structure
- [ ] Modals: Use `.modal` > `.modal-card` structure
- [ ] Alerts: Use left-border accent pattern
- [ ] Tags/Badges: Use pill-shaped with 15% opacity backgrounds

---

## 20. QUICK REFERENCE - CSS VARIABLES

```css
/* Copy these for quick access */

/* Backgrounds */
--bg-primary: #020617;
--bg-secondary: #0F172A;
--bg-tertiary: #1E293B;

/* Text */
--text-primary: #F8FAFC;
--text-secondary: #F1F5F9;
--text-muted: #94A3B8;

/* Accents */
--primary: #06B6D4;
--success: #14B8A6;
--warning: #F97316;
--danger: #EF4444;

/* Borders */
--border-subtle: rgba(255, 255, 255, 0.08);
--border-default: rgba(255, 255, 255, 0.15);

/* Overlays */
--primary-light: rgba(6, 182, 212, 0.15);
--danger-light: rgba(239, 68, 68, 0.1);

/* Spacing */
--space-xs: 0.25rem;
--space-sm: 0.5rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;

/* Radius */
--radius-sm: 0.375rem;
--radius-md: 0.5rem;
--radius-lg: 0.75rem;
--radius-full: 9999px;

/* Transitions */
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 21. ANONYMOUS MODE (BLUR)

### 21.1 Overview

Anonymous Mode blurs sensitive financial values for privacy during screen sharing or recordings. When enabled, a CSS class `anonymous-mode` is added to `<html>`, and all elements with the `sensitive-value` class are blurred.

### 21.2 Usage

Add the `sensitive-value` class to any element containing sensitive financial data:

```html
<!-- Spans with currency values -->
<span class="summary-value sensitive-value">€10,000</span>

<!-- Input fields with values -->
<input class="input cash-input sensitive-value" value="5000">

<!-- Table cells -->
<td class="col-currency sensitive-value">€2,500</td>
```

### 21.3 What to Mark as Sensitive

| Element Type | Should Have `sensitive-value` |
|--------------|-------------------------------|
| Portfolio totals | ✅ Yes |
| Position values | ✅ Yes |
| Cash balances | ✅ Yes |
| P&L amounts | ✅ Yes |
| Investment progress | ✅ Yes |
| Share counts | ⚠️ Optional |
| Percentages | ❌ No (relative, not absolute) |
| Company names | ❌ No |
| Sector/Country | ❌ No |

### 21.4 CSS Implementation

```css
/* Base blur effect */
.anonymous-mode .sensitive-value {
    filter: blur(8px);
    user-select: none;
    cursor: default;
    transition: filter 0.2s ease-in-out;
}

/* Input fields remain interactive */
.anonymous-mode input.sensitive-value,
.anonymous-mode .sensitive-value input {
    filter: blur(8px);
    pointer-events: auto;
}

/* Table cells */
.anonymous-mode td.sensitive-value,
.anonymous-mode th.sensitive-value {
    filter: blur(8px);
    user-select: none;
}
```

### 21.5 Toggle Button

The toggle button is placed in the navbar and uses the `anonymous-mode-toggle` class:

```html
<button id="anonymous-mode-toggle" class="anonymous-mode-toggle" title="Toggle Anonymous Mode">
  <!-- Eye icon SVG -->
</button>
```

### 21.6 Implementation Checklist

When adding new financial displays:

- [ ] Add `sensitive-value` class to all monetary amounts (€, $, etc.)
- [ ] Add `sensitive-value` class to input fields showing financial data
- [ ] Test blur effect with anonymous mode enabled
- [ ] Ensure blurred inputs remain functional (pointer-events: auto)
- [ ] Verify print styles maintain blur

---

*Document Version: 1.1 | Generated from Portfolio Rebalancing Flask - Ocean Depth Design System*
