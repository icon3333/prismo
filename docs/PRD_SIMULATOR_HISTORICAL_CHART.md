# PRD: Simulator Historical Performance Chart

## Overview

Add a backwards-looking historical performance chart to the Simulator page (Sandbox mode only), positioned below the simulation table. The chart shows how the simulated portfolio **would have performed** historically, using real market data for each position.

This gives users the ability to backtest their simulated allocations — answering "if I had held this exact portfolio for the last N years, what would the returns look like?"

---

## Motivation

The simulator currently provides forward-looking what-if allocation planning (country/sector/thesis breakdowns, investment progress). But it has no way to evaluate **historical risk/return characteristics** of a simulated portfolio. Adding a backwards-looking chart closes this gap, letting users:

1. **Backtest allocation ideas** before committing capital
2. **Compare simulated portfolios** against each other over time
3. **Identify volatility and drawdowns** in proposed allocations
4. **Validate thesis-based allocation strategies** with real data

---

## Scope

### In Scope
- Historical performance chart below the simulation table (Sandbox mode only)
- Time period toggles: 3Y, 5Y, 10Y, MAX (backwards from today)
- Single value-weighted aggregate line showing combined portfolio return
- Individual position lines shown alongside the aggregate
- Reuses existing `get_historical_prices` API and ApexCharts rendering patterns
- Consistent with Performance page chart design (Ocean Depth theme)

### Out of Scope
- Overlay mode support (future enhancement)
- Forward projections / Monte Carlo simulations
- Benchmark comparison (e.g., vs S&P 500) — potential future enhancement
- Sharpe ratio, max drawdown, or other quantitative metrics display
- Chart export / screenshot functionality
- Caching of simulator-specific historical data beyond existing yfinance cache

---

## User Stories

1. **As a user building a sandbox portfolio**, I want to see how my simulated allocation would have performed over the last 5 years so I can evaluate whether the strategy is sound.

2. **As a user comparing strategies**, I want to switch between 3Y/5Y/10Y/MAX views to understand both short-term and long-term behavior of my allocation.

3. **As a user with a thesis-driven portfolio**, I want to see individual position lines alongside the weighted aggregate to identify which positions drive or drag performance.

---

## Design & UX

### Placement

```
┌──────────────────────────────────────────────┐
│  Simulator Header (mode=Sandbox, sim...)      │
├──────────────────────────────────────────────┤
│  Add Inputs (Ticker, Sector, Thesis, Country) │
├──────────────────────────────────────────────┤
│  Simulation Table                             │
│  ┌─────┬──────┬───────┬────┬────┬───┬───┬──┐ │
│  │ ID  │ Name │ Port  │Sec │The │Cty│ € │% │ │
│  │ ... │ ...  │  ...  │... │... │...│...│..│ │
│  └─────┴──────┴───────┴────┴────┴───┴───┴──┘ │
├──────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐ │
│  │  Historical Performance    [3Y][5Y][10Y] │ │  ← NEW
│  │                                          │ │
│  │  ~~~~ Chart Area (ApexCharts) ~~~~       │ │  ← NEW
│  │  base-100 normalized, time on x-axis     │ │
│  │  aggregate line + individual lines       │ │
│  │                                          │ │
│  └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│  Country Allocation  │  Thesis Allocation     │
│  (bar chart)         │  (bar chart)           │
└──────────────────────────────────────────────┘
```

Chart section is **hidden** when in Overlay mode. Only visible in Sandbox mode.

### Visual Design

Follow the exact same pattern as the Performance page chart (`performance.html:1620-1788`):

- **Chart type**: `area` (ApexCharts)
- **Height**: 350px
- **Normalization**: Base-100 (each series starts at 100, shows relative % change)
- **Y-axis annotation**: Horizontal dashed line at y=100 (break-even reference)
- **Tooltip**: Shows normalized value + percentage change from base (e.g., `"112.5 (+12.5%)"`)
- **Colors**: Use `ChartConfig.oceanDepthColors.palette` + `ChartConfig.colorMapping` for consistent colors
- **Weighted Avg line**: Aqua (#06b6d4), width 3, dashed (dashArray: 5)
- **Individual lines**: Width 2 (or 1.5 if >8 series), solid
- **Fill**: Transparent (aggregate-style, no gradient fill)
- **Grid**: Subtle dashed y-axis lines, no x-axis lines
- **Legend**: Bottom-center, shows series names with `sensitive-value` class
- **Animations**: Disabled for snappy rendering
- **Font**: Inter, 11px for axis labels
- **Background**: Transparent (inherits card background)
- **No toolbar/zoom**: Clean, minimal chrome

### Toggle Controls

**Period Toggle** (toggle-group, same pattern as Performance page):
```
[3Y] [5Y] [10Y] [MAX]
```
- Default: **5Y**
- No "Since Purchase" — not applicable for simulated positions

### Display

Always shows **both** the weighted aggregate line and individual position lines together (Combined view). No mode toggle needed — the aggregate provides the portfolio-level picture while individual lines show position contributions.

### Empty / Loading / Error States

| State | Display |
|-------|---------|
| **Overlay mode** | Section hidden entirely |
| **No items** | Hidden entirely (chart section not rendered) |
| **Items but no identifiers** | "Add positions with identifiers to see historical performance" (muted text + chart-line icon) |
| **Loading** | Centered spinner (same as Performance page `.chart-spinner`) |
| **No data returned** | "No historical data available for this portfolio" |
| **Partial data** | Render available series, skip missing ones silently |
| **API error** | "Failed to load historical data" with muted retry hint |

### Responsive Behavior

- **Desktop (>768px)**: Full-width chart, 350px height
- **Mobile (<768px)**: Full-width, reduced height (280px), axis labels may rotate

---

## Technical Design

### Data Flow

```
User changes simulation items (Sandbox mode)
  → renderTable() + updateCharts()
  → updateHistoricalChart() [NEW, debounced 500ms]
    → Check: is sandbox mode? If not, hide section & return
    → Collect identifiers from this.items (only items with valid identifiers)
    → Build cache key from sorted identifiers + period
    → Check historicalDataCache (in-memory Map)
    → If miss: GET /portfolio/api/historical_prices?identifiers=X,Y,Z&period=5y
    → Normalize to base-100
    → Compute weighted aggregate (using item values as weights)
    → Render via ApexCharts (same config as performance.html)
```

### Frontend Changes

**File: `static/js/simulation-scenarios.js`**

1. **New properties on `AllocationSimulator`:**
   ```javascript
   this.historicalChart = null;          // DOM element reference
   this.historicalChartInstance = null;   // ApexCharts instance
   this.historicalDataCache = new Map();  // identifier+period → data
   this.chartAbortController = null;     // AbortController for canceling
   this.currentChartPeriod = '5y';       // Selected period
   ```

2. **New DOM in `initUI()`** — insert after investment progress section, before charts div:
   ```html
   <!-- Historical Performance Chart (Sandbox mode only) -->
   <div class="simulator-historical-section" id="simulator-historical-section" style="display: none;">
     <div class="simulator-chart-header">
       <h5 class="simulator-chart-label">Historical Performance</h5>
       <div class="toggle-group" id="simulator-period-toggle">
         <button class="toggle-btn" data-period="3y">3Y</button>
         <button class="toggle-btn active" data-period="5y">5Y</button>
         <button class="toggle-btn" data-period="10y">10Y</button>
         <button class="toggle-btn" data-period="max">MAX</button>
       </div>
     </div>
     <div id="simulator-performance-chart" style="min-height: 350px; display: none;"></div>
     <div id="simulator-chart-loading" style="display: none;" class="has-text-centered p-6">
       <div class="chart-spinner"></div>
     </div>
     <div id="simulator-chart-empty" class="has-text-centered p-6">
       <p class="has-text-grey">
         <i class="fas fa-chart-line mr-2"></i>
         Add positions with identifiers to see historical performance
       </p>
     </div>
   </div>
   ```

3. **New methods:**

   - `updateHistoricalChart()`: Main orchestrator. Checks if sandbox mode (if not, hides section and returns). Collects identifiers from `this.items`, fetches data, renders chart. Called from `updateCharts()` (debounced separately at 500ms to avoid hammering API during rapid edits).

   - `fetchHistoricalData(identifiers, period)`: Calls `/portfolio/api/historical_prices`. Uses `AbortController` to cancel in-flight requests when period changes. Returns `{ series: { AAPL: [{date, close}, ...], ... } }`.

   - `renderHistoricalChart(data)`: Creates/updates ApexCharts instance. Mirrors `renderPerformanceChart()` from performance.html. Always renders in "combined" style — individual lines + weighted aggregate together. Key differences from performance.html version:
     - Weights derived from `this.items[].value` (not from backend portfolio values)
     - In sandbox % mode: weights derived from `this.items[].targetPercent * this.totalAmount / 100`
     - No "Since Purchase" mode
     - No `sincePurchaseInfo` parameter

   - `computeSimulatorAggregate(allSeries)`: Value-weighted average across all series. Identical to `computeSimpleAggregate()` in performance.html. Each series weighted by its item's EUR value as a proportion of total simulation value.

   - `getChartIdentifiers()`: Returns deduplicated list of identifiers from `this.items` that have valid tickers. Filters out items with empty/placeholder identifiers.

   - `getChartCacheKey(identifiers, period)`: Returns string key for `historicalDataCache`.

4. **Bind events in `bindEvents()`:**
   - Period toggle click → update `currentChartPeriod`, call `updateHistoricalChart()`

5. **Integration points:**
   - `updateCharts()` → add `this.debouncedHistoricalChartUpdate()` call at end
   - `renderTable()` → no change needed (chart updates through `updateCharts()`)
   - Item add/remove/edit → already calls `updateCharts()` → triggers chart update
   - Load simulation → calls `renderTable()` + `updateCharts()` → triggers chart update
   - Mode switch (overlay → sandbox) → show section + trigger chart update
   - Mode switch (sandbox → overlay) → hide section + destroy chart instance

### Sandbox Mode Specifics

The chart shows **only** simulated items:
- Collect identifiers from `this.items` only
- If `global_value_mode === 'percent'`: weight = `item.targetPercent / 100 * this.totalAmount`
- If `global_value_mode === 'euro'`: weight = `item.value`

### Identifier Resolution

Items without identifiers (added via sector/thesis/country inputs) **cannot** be charted. The chart gracefully handles this:
- Only items with a non-empty `ticker` field that looks like a real identifier are included
- Items added via "Add Sector" (which have no ticker) are simply excluded
- The chart shows what it can, even if only a subset of items have identifiers
- If zero items have identifiers, show empty state

### Backend Changes

**None required.** The existing `/portfolio/api/historical_prices` endpoint already supports:
- Multiple identifiers (comma-separated, max 50)
- Period parameter (1y, 3y, 5y, 10y, max)
- Identifier resolution (ISIN → yfinance ticker)
- Response format matches what the frontend needs

### CSS Changes

**File: `static/css/simulator.css`**

```css
/* Historical Performance Chart Section */
.simulator-historical-section {
  margin-top: var(--space-lg);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border-color);
}

.simulator-historical-section .simulator-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

/* Reuse existing chart-spinner, toggle-group styles */
```

---

## Weighted Aggregate Calculation

The aggregate line represents a **value-weighted** portfolio return:

```
For each date t:
  aggregate[t] = Σ (weight_i × normalized_return_i[t])

where:
  weight_i = value_i / Σ values
  normalized_return_i[t] = (close_i[t] / close_i[t=0]) × 100
```

**Forward-fill** for missing dates: if a position doesn't have data for a given date (e.g., different trading calendars), use the last known value.

**Date alignment**: All series are aligned to common dates. The aggregate only begins on the date when ALL series have data (or the first date any series has data, with partial weighting).

This is identical to `computeSimpleAggregate()` in performance.html (lines 1799-1850).

---

## Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| **API rate limiting** | 500ms debounce on chart updates; abort in-flight requests on new changes |
| **Large number of positions** | Existing API supports up to 50 identifiers; yfinance `download()` with threading handles batch efficiently |
| **Cache invalidation** | In-memory cache keyed by identifiers+period; clears on page reload. Existing yfinance server-side cache (1 hour) handles repeat requests |
| **Render performance** | ApexCharts animations disabled; chart destroyed and recreated (not updated) for clean state |
| **Duplicate identifiers** | Deduplicate before API call; if multiple items have the same ticker, the weight is the sum of their values |

---

## Edge Cases

| Case | Behavior |
|------|----------|
| **Overlay mode active** | Chart section hidden entirely |
| **All items lack identifiers** | Show empty state: "Add positions with identifiers to see historical performance" |
| **Some items lack identifiers** | Chart shows available items; aggregate weights only include chartable items |
| **Item has identifier but yfinance returns no data** | Skip silently; aggregate recalculates with remaining items |
| **Single item** | Show as individual line + aggregate (aggregate equals the single line) |
| **Zero-value items** | Included in chart but with zero weight (won't affect aggregate) |
| **Very short history** | Chart renders whatever is available; short series may look sparse with monthly intervals |
| **Simulation loaded from DB** | Chart fetches fresh historical data on load (items restored → updateCharts() → chart update) |
| **Rapid item additions** | 500ms debounce prevents multiple API calls; only the final state triggers a fetch |
| **Period change** | Cancel in-flight request via AbortController; fetch new period data |
| **Switch to overlay mode** | Hide section, destroy chart instance, clear cache |
| **Switch back to sandbox** | Show section, trigger fresh fetch |

---

## Implementation Plan

### Phase 1: Core Chart (MVP)
1. Add DOM structure in `initUI()` (historical section with period toggle + chart container)
2. Add CSS for `.simulator-historical-section`
3. Implement `getChartIdentifiers()` — extract identifiers from items
4. Implement `fetchHistoricalData()` — call existing API with abort support
5. Implement `renderHistoricalChart()` — port from performance.html `renderPerformanceChart()`, always showing combined (individual lines + aggregate)
6. Implement `computeSimulatorAggregate()` — port from performance.html `computeSimpleAggregate()`
7. Implement `updateHistoricalChart()` — orchestrator with cache + loading states + sandbox-only gate
8. Wire into `updateCharts()` with debounced call
9. Bind period toggle events

### Phase 2: Mode Integration
10. Hide/show section on overlay ↔ sandbox mode switch
11. Cleanup: destroy chart instance and clear cache when switching to overlay

### Phase 3: Polish
12. Loading/empty/error state transitions
13. Responsive behavior (mobile height reduction)
14. Cache key management and abort controller cleanup
15. Test with various portfolio sizes and edge cases

---

## Testing Strategy

### Manual Testing
- Sandbox mode: add 3-5 items with known tickers, verify chart renders with individual lines + aggregate
- Period switching: confirm 3Y/5Y/10Y/MAX all fetch and render correctly
- Empty state: remove all items, verify chart hides gracefully
- Mixed items: add some with identifiers, some without — chart should show partial data
- Overlay mode: verify chart section is hidden
- Switch overlay → sandbox: verify chart appears
- Switch sandbox → overlay: verify chart disappears
- Rapid editing: add/remove items quickly, verify no race conditions
- Load saved simulation: chart should render after load
- Clone portfolio: chart should render after clone
- % mode: verify weights calculate correctly from targetPercent × totalAmount

### Automated Testing
- No new backend tests needed (existing API is unchanged)
- Frontend testing via manual QA (no JS test framework in project currently)

---

## Future Enhancements (Out of Scope)

1. **Overlay mode support**: Include baseline portfolio positions in the chart
2. **Benchmark overlay**: Add S&P 500 / MSCI World as reference line
3. **Risk metrics panel**: Show max drawdown, volatility, Sharpe ratio below chart
4. **Date range picker**: Custom start/end dates instead of fixed periods
5. **Chart persistence**: Remember period selection in localStorage
6. **Compare simulations**: Overlay two saved simulations on the same chart
7. **Currency normalization**: Show returns in user's preferred currency (currently all EUR via yfinance conversion)
