# Product Requirements Document: Allocation Simulator (Sandbox Mode)

**Version:** 1.0
**Date:** 2026-01-16
**Feature Type:** New Feature (replacing existing slider-based simulator)
**Status:** Ready for Implementation

---

## Executive Summary

### Problem Statement
Users need a lightweight sandbox environment to explore different portfolio allocation scenarios without affecting their real portfolio data. The current slider-based simulator provides limited flexibility and doesn't allow users to freely experiment with hypothetical positions.

### Solution Overview
Replace the existing Allocation Simulator with a table-based sandbox where users can add items via three methods (Ticker, Category, Country), edit all fields inline, and see real-time percentage breakdowns by country and category. This is a pure exploration tool with no persistence.

### Success Criteria
- Users can add positions via ticker lookup, category name, or country name in <5 seconds
- All table fields are editable with immediate visual feedback
- Percentage breakdowns update in real-time as users modify values
- Zero persistence - page refresh clears all data
- Mobile responsive on devices 576px+ width
- Follows Ocean Depth design system exactly

---

## User Stories

### Primary Persona: Portfolio Explorer
Self-directed investor who wants to test allocation ideas before committing to real portfolio changes.

1. **As a portfolio explorer**, I want to quickly add stock tickers so I can build a hypothetical portfolio without manual data entry.
   - **Acceptance Criteria:** Enter "AAPL" → system fetches sector and country from yfinance → I enter value

2. **As a portfolio explorer**, I want to add category allocations without specific tickers so I can explore high-level allocation strategies.
   - **Acceptance Criteria:** Add "Healthcare" category with €5,000 → appears in table with "—" for ticker/country

3. **As a portfolio explorer**, I want to add country allocations without specific tickers so I can test geographic diversification scenarios.
   - **Acceptance Criteria:** Add "Germany" with €8,000 → appears in table with "—" for ticker/category

4. **As a portfolio explorer**, I want to see real-time percentage breakdowns by country and category so I understand my allocation distribution immediately.
   - **Acceptance Criteria:** As I add/edit/remove items, two side-by-side charts update instantly

5. **As a portfolio explorer**, I want to edit any field in the table so I can adjust my hypothetical portfolio without re-adding items.
   - **Acceptance Criteria:** Click any cell → edit value → change reflects in aggregate charts

6. **As a portfolio explorer**, I want a clean slate every time so I don't need to manage saved simulations.
   - **Acceptance Criteria:** Page refresh → table is empty, charts show 0%

---

## Functional Requirements

### FR1: Item Addition Methods

#### FR1.1: Add by Ticker
**Input:** Text input + "Add Ticker" button

**Process:**
1. User enters ticker (e.g., "AAPL")
2. System calls `/api/simulator/ticker-lookup` endpoint
3. Backend uses `yfinance_utils.get_yfinance_info(ticker)` to fetch sector and country
4. Frontend shows loading spinner during API call
5. On success: Pre-populate category and country fields, focus on value input
6. On failure: Show error toast

**Output:** New row with:
- Ticker: `AAPL` (non-editable after fetch)
- Category: `Technology` (editable)
- Country: `USA` (editable)
- Value: Empty input field
- Delete: ✕ button

#### FR1.2: Add by Category
**Input:** Text input + "Add Category" button

**Process:** Instant row addition (no API call)

**Output:** New row with:
- Ticker: `—` (editable)
- Category: User input (editable)
- Country: `—` (editable)
- Value: Empty input field
- Delete: ✕ button

#### FR1.3: Add by Country
**Input:** Text input + "Add Country" button

**Process:** Instant row addition (no API call)

**Output:** New row with:
- Ticker: `—` (editable)
- Category: `—` (editable)
- Country: User input (editable)
- Value: Empty input field
- Delete: ✕ button

---

### FR2: Interactive Data Table

#### FR2.1: Table Structure
| Column | Width | Alignment | Notes |
|--------|-------|-----------|-------|
| Ticker | 100px | Left | Non-editable if fetched |
| Category | 150px | Left | Always editable |
| Country | 120px | Left | Always editable |
| Value | 120px | Right | Currency format (€) |
| Delete | 40px | Center | ✕ button |

#### FR2.2: Inline Editing
- Click any cell → becomes text input
- Enter key → save
- ESC key → cancel edit
- Value field: validates positive numbers, formats with € and thousands separators

#### FR2.3: Row Deletion
- Click ✕ → row fades out (0.3s) → charts update
- No confirmation needed (sandbox mode)

---

### FR3: Real-Time Aggregation Charts

#### FR3.1: Layout
Two side-by-side panels:
- **Left:** Distribution by Country
- **Right:** Distribution by Category

#### FR3.2: Bar Chart Rendering
Each bar shows:
- Label (country/category name)
- Percentage (item_group_value / total_value * 100)
- Visual bar (proportional width)
- Absolute value in tooltip

**Aggregation Rules:**
- Items with "—" in country → counted as "Unknown" in country chart
- Items with "—" in category → counted as "Unknown" in category chart
- Bars sorted by percentage (largest first)

#### FR3.3: Real-Time Updates
Trigger on: add row, edit value, edit category/country, delete row
- Debounce value inputs (300ms)
- Smooth bar width transitions (0.3s ease)

---

### FR4: UI Layout

```
┌────────────────────────────────────────────────────────────┐
│  ▼ Allocation Simulator                                    │
├────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │Add Ticker│  │Add Category│ │Add Country│                │
│  │[_______] │  │[________] │  │[________] │                │
│  │ [Add]    │  │ [Add]     │  │ [Add]     │                │
│  └──────────┘  └──────────┘  └──────────┘                 │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Ticker  │ Category │ Country │   Value   │ Delete    │ │
│  ├──────────────────────────────────────────────────────┤ │
│  │ AAPL    │ Tech     │ USA     │  €10,000  │   ✕       │ │
│  │ —       │ Health   │ —       │  €5,000   │   ✕       │ │
│  │ —       │ —        │ Germany │  €8,000   │   ✕       │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌─────────────────────┬─────────────────────┐            │
│  │ By Country          │ By Category         │            │
│  ├─────────────────────┼─────────────────────┤            │
│  │ USA     43% ████    │ Tech    43% ████    │            │
│  │ Germany 35% ███     │ Health  22% ██      │            │
│  │ Unknown 22% ██      │ Unknown 35% ███     │            │
│  └─────────────────────┴─────────────────────┘            │
└────────────────────────────────────────────────────────────┘
```

---

## Technical Requirements

### TR1: Backend API

#### Endpoint: `POST /api/simulator/ticker-lookup`

**Request:**
```json
{ "ticker": "AAPL" }
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "ticker": "AAPL",
    "category": "Technology",
    "country": "USA",
    "name": "Apple Inc."
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Ticker not found or no data available"
}
```

**Implementation:**
- Reuse `yfinance_utils.get_yfinance_info(ticker)`
- Extract: `info.get('sector')` → category, `info.get('country')` → country
- Use `@require_auth` decorator
- Leverage existing 15-minute cache

---

### TR2: Frontend Architecture

**File:** `static/js/simulator.js`

```javascript
class AllocationSimulator {
  constructor() {
    this.items = [];  // Array of simulator items
  }

  addItem(item) { /* ... */ }
  updateItem(id, field, value) { /* ... */ }
  deleteItem(id) { /* ... */ }
  calculateAggregates() { /* ... */ }
  renderTable() { /* ... */ }
  renderCharts() { /* ... */ }
}
```

**Data Model:**
```javascript
{
  id: 'uuid-v4',
  ticker: 'AAPL' | '—',
  category: 'Technology' | '—',
  country: 'USA' | '—',
  value: 10000,  // Euro (float)
  source: 'ticker' | 'category' | 'country'
}
```

---

### TR3: Design System Compliance

**CSS Variables (Ocean Depth):**
- Backgrounds: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`
- Accents: `--primary` (aqua), `--success` (teal), `--danger` (coral)
- Spacing: `--space-xs` through `--space-xl`

**Reused Patterns:**
- `.simulator-panels` - Two-column layout
- `.unified-table` - Table styling
- `.btn-primary`, `.btn-sm` - Buttons
- `.input`, `.field`, `.control` - Form inputs

---

### TR4: Performance Targets
- Ticker lookup: <3 seconds
- All interactions: <200ms
- Works smoothly with 50+ rows
- Debounce value input (300ms)

---

## Implementation Plan

| Phase | Tasks | Effort |
|-------|-------|--------|
| 1. Backend API | Ticker lookup endpoint + tests | 1-2 hours |
| 2. Frontend Structure | JS class, input forms, table rendering | 2-3 hours |
| 3. Chart Rendering | Aggregation logic, bar charts, animations | 2-3 hours |
| 4. Integration | Replace existing simulator, styling | 1-2 hours |
| 5. Testing | E2E testing, cross-browser, mobile | 1-2 hours |

**Total: 7-12 hours**

---

## Files to Modify/Create

| File | Action |
|------|--------|
| `app/routes/portfolio_api.py` | Add ticker lookup endpoint |
| `static/js/simulator.js` | New file - simulator class |
| `templates/pages/allocate.html` | Replace lines 84-201 |
| `static/css/allocate.css` | Add simulator-specific styles |

---

## Out of Scope (V1)

- Saving simulations
- Export to CSV
- Import from existing portfolio
- Constraint validation
- Multi-currency support

---

## Open Questions

| Question | Decision |
|----------|----------|
| Should ticker be editable after fetch? | No - locked for clarity |
| Maximum rows? | No hard limit (tested to 50) |
| Export functionality? | Defer to V2 |

---

## Success Metrics

1. **Adoption:** >40% of users expand simulator section
2. **Engagement:** >5 items added per session
3. **Error Rate:** <5% failed ticker lookups
4. **Performance:** 95th percentile API response <3 seconds
