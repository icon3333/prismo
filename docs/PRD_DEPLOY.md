# PRD: DCA Deploy Section (Sandbox Sub-Feature)

## Overview

A collapsible **Deploy** section within Sandbox mode that calculates Dollar-Cost Averaging (DCA) schedules. Users enter a lump sum and monthly savings amount, choose a deployment period, and the system auto-calculates per-position monthly investment amounts based on sandbox allocation weights.

## Problem

Users with a lump sum want to systematically deploy capital over multiple months while adding monthly savings. Manually calculating per-position amounts each month is tedious and error-prone.

## Solution

A **collapsible sub-section** within the existing Sandbox mode (not a separate mode or toggle). It:
- Auto-populates positions and weights from the active sandbox simulation
- Calculates a DCA schedule: `(lump_sum / months) + monthly_savings` per month
- Shows per-position EUR/month breakdown based on allocation weights
- Optionally allows manual position entry independent of sandbox items

## User Experience

### Location & Visibility
- Appears **below** the sandbox table and charts
- Collapsed by default; clickable header expands/collapses
- Only visible in **Sandbox (Portfolio) mode** with a loaded simulation

### Auto Mode (Default)
1. Positions and weights are pulled directly from the active sandbox items
2. Any change to sandbox items (add/remove/reweight) automatically updates deploy calculations
3. User enters three parameters:
   - **Lump Sum** (e.g., 50,000) - total capital to deploy
   - **Monthly Savings** (e.g., 2,000) - recurring monthly contribution
   - **Months** (e.g., 12) - deployment period (1-120)
4. Summary shows:
   - **Monthly Investment** (hero value): `(lump_sum / months) + monthly_savings`
   - Lump portion per month: `lump_sum / months`
   - Monthly savings portion: `monthly_savings`
   - Total deployed over period: `monthly_investment * months`
5. Per-position table: Name, Weight%, EUR/month
6. Collapsible month-by-month schedule table

### Manual Mode (Toggle)
- Toggle in deploy section header switches between Auto and Manual
- On first switch to manual: copies current sandbox items as starting point
- Manual items can be added/removed/reweighted independently
- Switching back to auto discards manual items (with confirmation if changed)

### Persistence
- Deploy parameters are stored on the simulation record (not a separate entity)
- Auto-saved via existing 800ms debounced auto-save
- Restored when loading a simulation

## Data Model

New columns on `simulations` table:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `deploy_lump_sum` | REAL | 0 | Total lump sum to deploy |
| `deploy_monthly` | REAL | 0 | Monthly savings amount |
| `deploy_months` | INTEGER | 1 | Number of months to deploy over |
| `deploy_manual_mode` | INTEGER | 0 | 0=auto (from sandbox), 1=manual |
| `deploy_manual_items` | TEXT | NULL | JSON array of manual positions |

## Calculations

```
monthlyInvestment = (lumpSum / months) + monthlySavings
lumpPortion = lumpSum / months
totalDeployed = monthlyInvestment * months

perPositionMonthly = monthlyInvestment * (positionWeight / 100)
```

## UI Components

### Deploy Section Header
- Expand/collapse chevron icon
- "Deploy" label
- Auto/Manual toggle (small, within header)
- Monthly investment preview (when collapsed)

### Parameter Inputs (3-column grid)
- Lump Sum (EUR input)
- Monthly Savings (EUR input)
- Months (integer input, 1-120)

### Summary Card
- Hero value: Monthly Investment (large aqua number)
- Detail rows: Lump portion, Monthly portion, Total deployed

### Positions Table
- Name, Weight%, EUR/month columns
- In manual mode: delete button per row, add row button

### Schedule Table (collapsible)
- Month number, Monthly Investment, Cumulative columns
- All rows show identical monthly investment (simple DCA)

## Non-Goals
- No separate simulation type for deploy
- No third mode toggle in simulator header
- No rebalancing logic (equal monthly amounts)
- No date-based scheduling (just month numbers)
- No integration with external brokers
