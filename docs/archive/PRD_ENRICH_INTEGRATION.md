# PRD: Integrate Data & Portfolios into Portfolio Data Section

## Problem Statement

The Enrich page currently has a disconnected layout:

1. **Data Management Bar** (top) — a standalone `<div class="data-management-bar">` containing:
   - **"Data" group** (left): Sync CSV button + Add Position button
   - **"Portfolios" group** (right): Portfolio action dropdown (Add/Rename/Delete) with dynamic fields and Apply button

2. **"Portfolio Data" section** (below) — a separate `<h2>` + Vue-powered panel containing:
   - Summary bar (Positions | Holdings + Cash = Total)
   - Controls bar (Portfolio filter, Search, Update buttons, Download CSV)
   - Bulk edit bar
   - Data table

These two sections feel like **separate islands** rather than a unified experience. The "Data Management Bar" floats above the main content with no visual continuity — different background treatment, separated by a section title, and using a non-Vue form that triggers a full page reload.

### User Impact
- The page feels disjointed — two separate UI regions for related tasks
- Portfolio management (Add/Rename/Delete) is visually detached from the portfolio data it manages
- The "Data" and "Portfolios" labels feel like navigation rather than inline tools
- Users mentally context-switch between "management mode" (top bar) and "data mode" (table)

---

## Goal

Absorb the Data Management Bar's functionality **into** the Portfolio Data section panel, creating a single, cohesive panel that houses all Enrich page functionality. The result should feel native — as if the import/portfolio management tools were always part of the portfolio data workspace.

---

## Design Approach

### Current Layout
```
┌─────────────────────────────────────────────────┐
│  Data                          Portfolios       │  ← data-management-bar (standalone)
│  [Sync CSV] [Add Position]     [Action ▼] [Apply]
└─────────────────────────────────────────────────┘

  Portfolio Data                                     ← h2 section title

┌─────────────────────────────────────────────────┐
│  Positions | Holdings + Cash = Total   Updated  │  ← summary bar (inside Vue panel)
├─────────────────────────────────────────────────┤
│  [All Portfolios ▼] [Search...] [Update] [CSV]  │  ← controls bar
├─────────────────────────────────────────────────┤
│  ... data table ...                             │
└─────────────────────────────────────────────────┘
```

### Proposed Layout
```
┌─────────────────────────────────────────────────┐
│  Summary: Positions | Holdings + Cash = Total   │  ← summary bar (unchanged)
├─────────────────────────────────────────────────┤
│  [All ▼] [Search...] │ [Sync] [+ Position]     │  ← unified controls bar
│                       │ [Update] [Selected] [CSV]│
├─────────────────────────────────────────────────┤
│  ... data table ...                             │
├─────────────────────────────────────────────────┤
│  Portfolio: [Action ▼] [fields...] [Apply]      │  ← portfolio mgmt (footer/bottom)
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

#### 1. Remove the standalone Data Management Bar
- Delete `data_management_section` macro call from `enrich.html`
- Remove the `<h2 class="section-title">Portfolio Data</h2>` — the panel IS the page now
- The page title "Enrich" remains as the only header

#### 2. Merge "Data" buttons into the Controls Bar
Move **Sync (CSV)** and **Add Position** buttons into the existing controls bar inside the Vue panel, grouped logically:

- **Left group**: Portfolio filter dropdown + Company search (unchanged)
- **Right group**: All action buttons in a single row:
  - `Sync (CSV)` — import data
  - `Add Position` — manual add
  - `Update All` — refresh prices
  - `Update Selected (N)` — refresh selected
  - `Download CSV` — export

This creates one horizontal strip of controls instead of two separate bars. The buttons move from a static HTML bar to Vue-managed controls (though Sync CSV and Add Position will keep their existing JS handlers — they don't need to be Vue-reactive).

#### 3. Move Portfolio Management to a Footer Section
Relocate the Add/Rename/Delete portfolio form to the **bottom of the panel**, styled as a subtle footer:

- Sits below the data table within the same panel container
- Uses a top border (`--border-subtle`) to separate from table content
- Same background as the panel (`--bg-secondary`) — feels integrated
- Compact single-line layout: `[Action ▼] [dynamic fields...] [Apply]`
- No section labels needed — the dropdown makes the purpose obvious
- Subtle styling (muted text, smaller controls) — it's a management tool, not a primary action

**Rationale**: Portfolio CRUD is an infrequent operation. Placing it at the bottom:
- Keeps primary workflow (viewing/editing data) front-and-center
- Still accessible without scrolling on most screens (table scrolls internally)
- Feels like a "settings footer" pattern common in data panels
- Removes the need for the "Portfolios" label entirely

#### 4. Convert Portfolio Management to Vue (AJAX)
Currently the portfolio form triggers a full `POST` + page reload. Convert to Vue-managed AJAX:

- Add `portfolioAction`, `portfolioActionName`, `portfolioOldName`, `portfolioNewName`, `portfolioDeleteName` to Vue data
- On "Apply": `fetch()` to existing `/portfolio/manage_portfolios` endpoint
- On success: show inline success message, refresh portfolio dropdown options
- On error: show inline error message
- No page reload needed

This makes the experience consistent with how all other edits on the page work (inline, no reload).

#### 5. Move Sync Modal & Upload Progress Inside the Panel
- The sync confirmation modal stays as-is (it's a global overlay)
- The upload progress indicator (`#csv-upload-indicator`) moves inside the Vue panel, appearing between the controls bar and the table when active
- The hidden file input stays at page level

---

## Detailed Specifications

### Controls Bar Layout

```html
<div class="portfolio-header-controls">
  <div class="enrich-main-controls">
    <div class="enrich-controls-left">
      <!-- Group 1: Filters -->
      <div class="enrich-control-group-close">
        <select v-model="selectedPortfolio">...</select>
        <input type="text" placeholder="Search company...">
      </div>

      <!-- Group 2: All Action Buttons -->
      <div class="enrich-control-group-close">
        <button @click="triggerSync">Sync (CSV)</button>
        <button @click="showAddPositionModal = true">+ Position</button>
        <button @click="updateAllData">Update all</button>
        <button @click="updateSelected" :disabled="!hasSelection">Update Selected (N)</button>
        <button @click="downloadCSV">Download CSV</button>
      </div>
    </div>
  </div>
</div>
```

**Button styling**: All buttons use the existing `button` class with appropriate modifiers:
- `Sync (CSV)` — `is-info` (matches current)
- `+ Position` — `is-info` (matches current)
- `Update all` — `is-primary` (matches current)
- `Update Selected` — `is-warning` (matches current)
- `Download CSV` — `is-info` (matches current)

### Portfolio Management Footer

```html
<div class="portfolio-mgmt-footer">
  <div class="portfolio-mgmt-row">
    <select v-model="portfolioAction">
      <option value="">Portfolio action...</option>
      <option value="add">Add Portfolio</option>
      <option value="rename">Rename Portfolio</option>
      <option value="delete">Delete Portfolio</option>
    </select>

    <!-- Dynamic fields based on selected action -->
    <template v-if="portfolioAction === 'add'">
      <input v-model="portfolioActionName" placeholder="Portfolio name">
    </template>
    <template v-if="portfolioAction === 'rename'">
      <select v-model="portfolioOldName">...</select>
      <input v-model="portfolioNewName" placeholder="New name">
    </template>
    <template v-if="portfolioAction === 'delete'">
      <select v-model="portfolioDeleteName">...</select>
      <span class="dm-warning-text">Must be empty</span>
    </template>

    <button @click="applyPortfolioAction" :disabled="!canApplyPortfolioAction">
      Apply
    </button>

    <span v-if="portfolioActionMessage"
          :class="portfolioActionSuccess ? 'has-text-success' : 'has-text-danger'"
          v-text="portfolioActionMessage">
    </span>
  </div>
</div>
```

### CSS for Footer
```css
.portfolio-mgmt-footer {
  padding: var(--space-sm) var(--space-md);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.portfolio-mgmt-footer select,
.portfolio-mgmt-footer input,
.portfolio-mgmt-footer button {
  font-size: 0.8rem;  /* Slightly smaller than main controls */
}

.portfolio-mgmt-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
```

---

## Implementation Plan

### Files to Modify

| File | Changes |
|------|---------|
| `templates/pages/enrich.html` | Remove `data_management_section` call, remove `<h2>` section title |
| `templates/components/enrich_components.html` | Remove `data_management_section` macro. Modify `portfolio_data_section` macro: add Sync/Add Position buttons to controls bar, add portfolio management footer |
| `static/js/enrich.js` | Add portfolio management Vue data/methods, move Sync/Add Position click handlers into Vue scope, add AJAX portfolio CRUD |
| `static/css/enrich.css` | Remove `.data-management-bar` styles, add `.portfolio-mgmt-footer` styles, adjust controls bar for additional buttons |

### Migration of Existing JS Handlers

The existing `PortfolioManager`, `FileUploadHandler`, and `ProgressManager` objects in `enrich.js` handle Sync CSV and portfolio management via DOM event listeners. These need to be adapted:

1. **Sync CSV button**: Currently `document.getElementById('import-sync-btn')` → Move to Vue `@click="triggerSync"` which calls the same `FileUploadHandler.selectFile()` logic
2. **Add Position button**: Currently `document.getElementById('add-position-top-btn')` → Move to Vue `@click="showAddPositionModal = true"` (already Vue-managed)
3. **Portfolio Management**: Currently a `<form>` with `PortfolioManager.init()` → Convert to Vue methods with fetch API
4. **Hidden file input**: Keep at page level (outside Vue), reference via `document.getElementById`
5. **Upload progress**: Keep outside Vue (positioned before Vue mount point), no change needed
6. **Sync confirmation modal**: Keep at page level, no change needed — it's triggered by FileUploadHandler

### Step-by-Step Implementation

1. **Move Sync + Add Position buttons into controls bar** in `portfolio_data_section` macro
2. **Add portfolio management footer** HTML to the bottom of `portfolio_data_section` macro
3. **Add Vue data properties** for portfolio management state
4. **Add Vue methods** for `triggerSync()`, `applyPortfolioAction()` with fetch API
5. **Remove `data_management_section`** macro call and `<h2>` from `enrich.html`
6. **Clean up `data_management_section` macro** definition (can keep for reference or delete)
7. **Remove `PortfolioManager` object** from `enrich.js` (replaced by Vue methods)
8. **Update CSS**: Remove `.data-management-bar` and `.dm-*` styles, add footer styles
9. **Update FileUploadHandler** to work with new button location (should mostly just work since we keep the modal and file input at page level)

---

## Edge Cases

- **Empty state**: When no portfolio data exists, the panel still needs to show the Sync CSV and Add Position buttons. Currently these are hidden when `filteredPortfolioItems.length === 0`. The controls should show regardless — otherwise a first-time user can't import data.
- **Upload in progress**: The upload progress indicator should remain visible between controls and table, unaffected by the merge.
- **Portfolio list refresh**: After Add/Rename/Delete portfolio via AJAX, the portfolio dropdown in the filter and bulk edit sections must be refreshed without page reload. Update the `portfolios` data array in Vue.
- **Form validation**: Port the existing validation (non-empty name, duplicate check) from `PortfolioManager` to Vue methods.

---

## Success Criteria

1. Single unified panel — no separate floating bar above the main content
2. All existing functionality preserved (Sync CSV, Add Position, Portfolio CRUD, bulk edit, etc.)
3. Portfolio management works via AJAX (no page reload)
4. Controls bar has logical grouping without feeling crowded
5. Portfolio management footer is unobtrusive but accessible
6. Empty state still allows importing data and adding positions
7. All modals (sync confirmation, add position) continue to work correctly

---

## Out of Scope

- Changing the data table structure or columns
- Modifying the bulk edit bar
- Changing the Add Position modal
- Backend API changes (the existing `/portfolio/manage_portfolios` endpoint is sufficient for AJAX calls — just return JSON instead of redirect)
- Responsive/mobile layout changes (follow existing patterns)
