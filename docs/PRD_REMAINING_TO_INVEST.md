# PRD: Remaining to Invest Display in Simulator

## Executive Summary

This document defines the requirements for integrating "Remaining to Invest" data from the Builder page into the Simulator section of the Allocate page. The feature provides real-time visibility into how much capital remains to be invested per portfolio (and globally), based on the user's allocation targets defined in the Builder.

---

## 1. Problem Statement

### Current State

**Builder Page** (`/portfolio/build`):
- User defines total net worth, emergency fund, and already invested amounts
- User allocates percentage of total investable capital to each portfolio
- Calculates "To Be Invested" amounts per portfolio (e.g., Portfolio A = 40% = €40,000)
- Data is saved to `expanded_state` table but not accessible elsewhere

**Simulator Page** (`/portfolio/allocate` - Simulator Section):
- Shows current portfolio value (e.g., Portfolio A = €30,000)
- Supports "Global View" (all portfolios) and "Portfolio View" (specific portfolio)
- Displays "Current Portfolio Allocation" bar chart
- **No visibility into how much remains to be invested** according to Builder targets

### The Gap

Users cannot see the relationship between:
1. **Builder target**: How much they *planned* to invest (e.g., €40,000 in Portfolio A)
2. **Current value**: How much they *have* invested (e.g., €30,000)
3. **Remaining**: How much *more* they need to invest to reach target (e.g., €10,000)

This forces users to manually reference the Builder page and perform mental calculations.

### User Story

> As an investor using the Simulator to plan new investments,
> I want to see how much I still need to invest per portfolio according to my Builder allocations,
> So that I can make informed decisions about where to allocate new capital.

---

## 2. Proposed Solution

### Overview

Display a **"Remaining to Invest"** indicator in the Simulator section that:
1. **Global View**: Shows total amount available to invest across all portfolios
2. **Portfolio View**: Shows remaining amount for the selected portfolio specifically

### Visual Concept

```
┌─────────────────────────────────────────────────────────────────┐
│  Combined Allocation (Portfolio + Simulated)                    │
│                                                                 │
│  Current Value: €30,000                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │   │
│  │        75%                    25% remaining              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Target (from Builder): €40,000                                 │
│  Remaining to Invest: €10,000  ←── NEW ELEMENT                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Requirements

### 3.1 Data Flow

#### Source Data (Builder Page)

The Builder page saves the following to `expanded_state` table:

```javascript
// budgetData (JSON in expanded_state)
{
  totalNetWorth: 200000,
  alreadyInvested: 90000,
  emergencyFund: 50000,
  availableToInvest: 60000,      // = totalInvestableCapital - alreadyInvested
  totalInvestableCapital: 150000 // = totalNetWorth - emergencyFund
}

// portfolios (JSON in expanded_state)
[
  {
    id: 1,
    name: "Growth Portfolio",
    allocation: 40,  // 40% of totalInvestableCapital = €60,000
    ...
  },
  {
    id: 2,
    name: "Income Portfolio",
    allocation: 35,  // 35% of totalInvestableCapital = €52,500
    ...
  },
  {
    id: 3,
    name: "Speculative",
    allocation: 25,  // 25% of totalInvestableCapital = €37,500
    ...
  }
]
```

**Key Calculations from Builder:**
| Portfolio | Allocation % | Target Amount |
|-----------|-------------|---------------|
| Growth | 40% | €60,000 |
| Income | 35% | €52,500 |
| Speculative | 25% | €37,500 |
| **Total** | **100%** | **€150,000** |

#### Target Data (Simulator Page)

The Simulator needs:

```javascript
// For each portfolio:
{
  portfolioId: 1,
  portfolioName: "Growth Portfolio",
  targetAmount: 60000,      // From Builder: allocation % × totalInvestableCapital
  currentValue: 45000,      // From portfolio_metrics API
  remainingToInvest: 15000  // = targetAmount - currentValue
}

// Global summary:
{
  totalTargetAmount: 150000,      // Sum of all portfolio targets
  totalCurrentValue: 90000,       // Sum of all portfolio current values
  totalRemainingToInvest: 60000,  // = totalTargetAmount - totalCurrentValue
  availableToInvest: 60000        // From Builder's budgetData (may equal remaining)
}
```

### 3.2 API Requirements

#### New Endpoint: GET `/portfolio/api/builder/investment-targets`

**Purpose**: Retrieve Builder allocation targets for use in Simulator

**Request**:
```
GET /portfolio/api/builder/investment-targets
Authorization: Session cookie
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "budget": {
      "totalNetWorth": 200000,
      "emergencyFund": 50000,
      "alreadyInvested": 90000,
      "totalInvestableCapital": 150000,
      "availableToInvest": 60000
    },
    "portfolioTargets": [
      {
        "portfolioId": 1,
        "portfolioName": "Growth Portfolio",
        "allocationPercent": 40,
        "targetAmount": 60000
      },
      {
        "portfolioId": 2,
        "portfolioName": "Income Portfolio",
        "allocationPercent": 35,
        "targetAmount": 52500
      },
      {
        "portfolioId": 3,
        "portfolioName": "Speculative",
        "allocationPercent": 25,
        "targetAmount": 37500
      }
    ],
    "totals": {
      "totalTargetAmount": 150000,
      "totalAllocationPercent": 100
    },
    "lastUpdated": "2025-01-18T10:30:00Z"
  }
}
```

**Response** (404 - No Builder data):
```json
{
  "success": false,
  "error": "no_builder_data",
  "message": "No allocation targets configured. Please set up your budget in the Builder page."
}
```

**Response** (400 - Incomplete Builder data):
```json
{
  "success": false,
  "error": "incomplete_builder_data",
  "message": "Builder configuration incomplete. Missing: totalNetWorth, portfolio allocations.",
  "missingFields": ["totalNetWorth", "portfolioAllocations"]
}
```

#### Modified Endpoint: GET `/portfolio/api/simulator/portfolio-allocations`

**Enhancement**: Include `remainingToInvest` in response when Builder data exists

**Current Response** (unchanged structure, new fields):
```json
{
  "scope": "global",
  "total_value": 90000,
  "countries": [...],
  "categories": [...],
  "positions": [...],

  // NEW FIELDS (optional, only present if Builder configured):
  "investmentTargets": {
    "hasBuilderConfig": true,
    "targetAmount": 150000,
    "remainingToInvest": 60000,
    "percentComplete": 60.0
  }
}
```

**For Portfolio Scope**:
```json
{
  "scope": "portfolio",
  "portfolio_id": 1,
  "total_value": 45000,
  "countries": [...],
  "categories": [...],
  "positions": [...],

  // NEW FIELDS for specific portfolio:
  "investmentTargets": {
    "hasBuilderConfig": true,
    "portfolioName": "Growth Portfolio",
    "allocationPercent": 40,
    "targetAmount": 60000,
    "remainingToInvest": 15000,
    "percentComplete": 75.0
  }
}
```

### 3.3 Frontend Requirements

#### 3.3.1 Simulator Section Updates (simulator.js)

**New State Properties**:
```javascript
class AllocationSimulator {
  constructor() {
    // ... existing properties ...

    // NEW: Builder investment targets
    this.investmentTargets = null;
    this.hasBuilderConfig = false;
  }
}
```

**New Method: loadInvestmentTargets()**
```javascript
async loadInvestmentTargets() {
  try {
    const response = await fetch('/portfolio/api/builder/investment-targets');
    const data = await response.json();

    if (data.success) {
      this.investmentTargets = data.data;
      this.hasBuilderConfig = true;
    } else {
      this.hasBuilderConfig = false;
      this.investmentTargets = null;
    }

    this.updateRemainingToInvestDisplay();
  } catch (error) {
    console.error('Failed to load investment targets:', error);
    this.hasBuilderConfig = false;
  }
}
```

**Modified Method: loadPortfolioAllocations()**
```javascript
async loadPortfolioAllocations() {
  // ... existing code ...

  // After loading portfolio data, calculate remaining
  if (this.hasBuilderConfig && this.investmentTargets) {
    this.calculateRemainingToInvest();
  }

  this.updateRemainingToInvestDisplay();
}
```

**New Method: calculateRemainingToInvest()**
```javascript
calculateRemainingToInvest() {
  if (!this.investmentTargets || !this.portfolioData) return null;

  const currentValue = this.portfolioData.total_value || 0;

  if (this.scope === 'global') {
    const targetAmount = this.investmentTargets.totals.totalTargetAmount;
    return {
      targetAmount,
      currentValue,
      remainingToInvest: Math.max(0, targetAmount - currentValue),
      percentComplete: targetAmount > 0 ? (currentValue / targetAmount) * 100 : 0,
      isOverTarget: currentValue > targetAmount
    };
  } else {
    // Portfolio scope
    const portfolioTarget = this.investmentTargets.portfolioTargets
      .find(p => p.portfolioId === this.portfolioId);

    if (!portfolioTarget) return null;

    return {
      portfolioName: portfolioTarget.portfolioName,
      allocationPercent: portfolioTarget.allocationPercent,
      targetAmount: portfolioTarget.targetAmount,
      currentValue,
      remainingToInvest: Math.max(0, portfolioTarget.targetAmount - currentValue),
      percentComplete: portfolioTarget.targetAmount > 0
        ? (currentValue / portfolioTarget.targetAmount) * 100 : 0,
      isOverTarget: currentValue > portfolioTarget.targetAmount
    };
  }
}
```

**New Method: updateRemainingToInvestDisplay()**
```javascript
updateRemainingToInvestDisplay() {
  const container = this.container.querySelector('.remaining-to-invest-section');
  if (!container) return;

  if (!this.hasBuilderConfig) {
    container.innerHTML = this.renderNoBuilderConfigMessage();
    return;
  }

  const data = this.calculateRemainingToInvest();
  if (!data) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = this.renderRemainingToInvestBar(data);
}
```

#### 3.3.2 UI Component: Remaining to Invest Bar

**HTML Structure** (to be rendered in simulator.js):
```html
<div class="remaining-to-invest-section">
  <!-- Header with values -->
  <div class="remaining-header">
    <div class="remaining-title">
      <span class="label">Investment Progress</span>
      <span class="scope-badge">Global</span> <!-- or Portfolio name -->
    </div>
    <div class="remaining-values">
      <span class="current-value">€45,000</span>
      <span class="separator">/</span>
      <span class="target-value">€60,000</span>
    </div>
  </div>

  <!-- Progress bar -->
  <div class="progress-container">
    <div class="progress-track">
      <div class="progress-fill" style="width: 75%"></div>
      <!-- Simulated additions indicator -->
      <div class="progress-simulated" style="left: 75%; width: 10%"></div>
    </div>
    <div class="progress-labels">
      <span class="percent-complete">75% complete</span>
      <span class="remaining-amount">€15,000 remaining</span>
    </div>
  </div>

  <!-- Simulated impact (if items added) -->
  <div class="simulated-impact" style="display: none;">
    <span class="simulated-label">With simulated additions:</span>
    <span class="simulated-value">€55,000</span>
    <span class="simulated-percent">(91.7%)</span>
  </div>
</div>
```

**CSS Styles** (to be added to allocate.css):
```css
/* ===== Remaining to Invest Section ===== */

.remaining-to-invest-section {
  background: var(--slate-800);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  border: 1px solid var(--slate-700);
}

.remaining-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.remaining-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.remaining-title .label {
  color: var(--slate-300);
  font-size: var(--text-sm);
  font-weight: 500;
}

.remaining-title .scope-badge {
  background: var(--aqua-900);
  color: var(--aqua-300);
  padding: 2px 8px;
  border-radius: var(--radius-xxs);
  font-size: var(--text-xs);
  font-weight: 500;
}

.remaining-values {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.remaining-values .current-value {
  color: var(--slate-100);
  font-weight: 600;
}

.remaining-values .separator {
  color: var(--slate-500);
  margin: 0 var(--space-xxs);
}

.remaining-values .target-value {
  color: var(--slate-400);
}

/* Progress Bar */
.progress-container {
  margin-bottom: var(--space-sm);
}

.progress-track {
  height: 8px;
  background: var(--slate-700);
  border-radius: var(--radius-xxs);
  position: relative;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--aqua);
  border-radius: var(--radius-xxs);
  transition: width 400ms ease;
}

.progress-fill.complete {
  background: var(--green-500);
}

.progress-fill.over-target {
  background: var(--amber-500);
}

.progress-simulated {
  position: absolute;
  top: 0;
  height: 100%;
  background: var(--aqua-400);
  opacity: 0.5;
  border-radius: var(--radius-xxs);
}

.progress-labels {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-xs);
  font-size: var(--text-xs);
}

.progress-labels .percent-complete {
  color: var(--aqua-400);
  font-weight: 500;
}

.progress-labels .remaining-amount {
  color: var(--slate-400);
}

/* Simulated Impact */
.simulated-impact {
  padding-top: var(--space-sm);
  border-top: 1px solid var(--slate-700);
  font-size: var(--text-sm);
}

.simulated-impact .simulated-label {
  color: var(--slate-400);
}

.simulated-impact .simulated-value {
  color: var(--aqua-400);
  font-weight: 600;
  font-family: var(--font-mono);
  margin-left: var(--space-xs);
}

.simulated-impact .simulated-percent {
  color: var(--slate-500);
  margin-left: var(--space-xxs);
}

/* No Builder Config Message */
.no-builder-config {
  text-align: center;
  padding: var(--space-md);
  color: var(--slate-400);
  font-size: var(--text-sm);
}

.no-builder-config a {
  color: var(--aqua-400);
  text-decoration: none;
}

.no-builder-config a:hover {
  text-decoration: underline;
}
```

#### 3.3.3 Integration with Simulated Items

When user adds items to the simulator, the progress bar should show the projected completion:

```javascript
updateRemainingToInvestDisplay() {
  // ... existing code ...

  const data = this.calculateRemainingToInvest();

  // Calculate simulated total
  const simulatedTotal = this.items.reduce((sum, item) => sum + item.value, 0);

  if (simulatedTotal > 0) {
    const projectedValue = data.currentValue + simulatedTotal;
    const projectedPercent = (projectedValue / data.targetAmount) * 100;
    const projectedRemaining = Math.max(0, data.targetAmount - projectedValue);

    data.simulated = {
      total: simulatedTotal,
      projectedValue,
      projectedPercent,
      projectedRemaining,
      reachesTarget: projectedValue >= data.targetAmount
    };
  }

  container.innerHTML = this.renderRemainingToInvestBar(data);
}
```

### 3.4 User Interactions

#### 3.4.1 Global View Behavior

**When Simulator is in Global View:**
1. Display shows **total** investment progress across all portfolios
2. Progress bar shows: `sum(all portfolio values) / sum(all portfolio targets)`
3. Values displayed:
   - Current Value: Sum of all portfolio current values
   - Target: Sum of all portfolio target amounts (from Builder)
   - Remaining: Total remaining to reach all targets
4. Simulated items (if any) show projected impact on overall progress

**Example:**
```
Investment Progress [Global]
€90,000 / €150,000

[████████████████████████░░░░░░░░░░░░░░]
60% complete                    €60,000 remaining

With simulated additions: €110,000 (73.3%)
```

#### 3.4.2 Portfolio View Behavior

**When Simulator is in Portfolio View (specific portfolio selected):**
1. Display shows investment progress for **selected portfolio only**
2. Progress bar shows: `portfolio current value / portfolio target amount`
3. Values displayed:
   - Current Value: Selected portfolio's current value
   - Target: Selected portfolio's target amount (allocation % × totalInvestableCapital)
   - Remaining: Amount needed to reach this portfolio's target
4. Badge shows portfolio name and allocation percentage
5. Simulated items (filtered by portfolio) show projected impact

**Example:**
```
Investment Progress [Growth Portfolio - 40%]
€45,000 / €60,000

[████████████████████████████████░░░░░░]
75% complete                    €15,000 remaining

With simulated additions: €55,000 (91.7%)
```

#### 3.4.3 State Transitions

| User Action | Result |
|------------|--------|
| Switch Global → Portfolio | Load portfolio-specific target, update display |
| Switch Portfolio → Global | Load total targets, update display |
| Change selected portfolio | Load new portfolio's target, update display |
| Add simulated item | Recalculate projected values, update display |
| Remove simulated item | Recalculate projected values, update display |
| Modify simulated value | Recalculate projected values, update display |

### 3.5 Edge Cases

#### 3.5.1 No Builder Configuration

**Scenario**: User has not configured Builder page

**Behavior**:
- Display informational message instead of progress bar
- Link to Builder page

**UI**:
```html
<div class="no-builder-config">
  <p>Set up your investment targets in the
     <a href="/portfolio/build">Builder</a>
     to see your progress here.</p>
</div>
```

#### 3.5.2 Incomplete Builder Configuration

**Scenario**: User started Builder but didn't complete (e.g., no totalNetWorth set)

**Behavior**:
- Display warning message with missing fields
- Link to Builder to complete setup

**UI**:
```html
<div class="incomplete-builder-config">
  <p>Your Builder configuration is incomplete.
     Please set up your <strong>total net worth</strong>
     and <strong>portfolio allocations</strong> in the
     <a href="/portfolio/build">Builder</a>.</p>
</div>
```

#### 3.5.3 Portfolio Not in Builder

**Scenario**: User selects a portfolio in Simulator that has no Builder allocation

**Behavior**:
- Display message indicating portfolio has no allocation target
- Show current value only

**UI**:
```html
<div class="no-portfolio-target">
  <p>This portfolio has no allocation target set in the Builder.</p>
  <p>Current value: <strong>€25,000</strong></p>
</div>
```

#### 3.5.4 Over Target

**Scenario**: Portfolio current value exceeds target amount

**Behavior**:
- Progress bar shows 100% filled with amber color
- Display shows "over target" status
- Remaining shows negative or zero

**UI**:
```
Investment Progress [Growth Portfolio - 40%]
€70,000 / €60,000

[████████████████████████████████████████] ⚠
116.7% - €10,000 over target
```

#### 3.5.5 Zero Target

**Scenario**: Portfolio has 0% allocation in Builder

**Behavior**:
- Skip this portfolio in calculations
- If selected in Portfolio View, show message

**UI**:
```
This portfolio has 0% allocation in your Builder configuration.
```

#### 3.5.6 Stale Builder Data

**Scenario**: Builder data is old, portfolio values have changed significantly

**Behavior**:
- Show last updated timestamp
- Consider showing warning if data is very old (>30 days)

**UI Addition**:
```html
<span class="last-updated">Last configured: 15 days ago</span>
```

---

## 4. Technical Implementation

### 4.1 Backend Changes

#### 4.1.1 New File: `app/services/builder_service.py`

```python
"""Service for Builder-related business logic."""

from typing import Optional, Dict, Any, List
import json

class BuilderService:
    """Handles Builder data operations for cross-page integration."""

    def __init__(self, db):
        self.db = db

    def get_investment_targets(self, account_id: int) -> Optional[Dict[str, Any]]:
        """
        Retrieve parsed investment targets from Builder configuration.

        Returns:
            Dict with budget and portfolio targets, or None if not configured.
        """
        # Fetch saved state
        budget_data = self._get_saved_state(account_id, 'budgetData')
        portfolios_data = self._get_saved_state(account_id, 'portfolios')

        if not budget_data or not portfolios_data:
            return None

        try:
            budget = json.loads(budget_data)
            portfolios = json.loads(portfolios_data)
        except json.JSONDecodeError:
            return None

        # Validate required fields
        total_investable = budget.get('totalInvestableCapital', 0)
        if total_investable <= 0:
            return None

        # Build portfolio targets
        portfolio_targets = []
        total_allocation = 0

        for p in portfolios:
            allocation = float(p.get('allocation', 0))
            target_amount = total_investable * (allocation / 100)

            portfolio_targets.append({
                'portfolioId': p.get('id'),
                'portfolioName': p.get('name'),
                'allocationPercent': allocation,
                'targetAmount': round(target_amount, 2)
            })
            total_allocation += allocation

        return {
            'budget': {
                'totalNetWorth': budget.get('totalNetWorth', 0),
                'emergencyFund': budget.get('emergencyFund', 0),
                'alreadyInvested': budget.get('alreadyInvested', 0),
                'totalInvestableCapital': total_investable,
                'availableToInvest': budget.get('availableToInvest', 0)
            },
            'portfolioTargets': portfolio_targets,
            'totals': {
                'totalTargetAmount': total_investable,
                'totalAllocationPercent': round(total_allocation, 2)
            },
            'lastUpdated': self._get_last_updated(account_id)
        }

    def get_portfolio_target(self, account_id: int, portfolio_id: int) -> Optional[Dict]:
        """Get investment target for a specific portfolio."""
        targets = self.get_investment_targets(account_id)
        if not targets:
            return None

        for pt in targets['portfolioTargets']:
            if pt['portfolioId'] == portfolio_id:
                return pt

        return None

    def _get_saved_state(self, account_id: int, variable_name: str) -> Optional[str]:
        """Fetch saved state variable from database."""
        cursor = self.db.execute(
            """
            SELECT variable_value
            FROM expanded_state
            WHERE account_id = ? AND page_name = 'build' AND variable_name = ?
            """,
            (account_id, variable_name)
        )
        row = cursor.fetchone()
        return row['variable_value'] if row else None

    def _get_last_updated(self, account_id: int) -> Optional[str]:
        """Get last update timestamp for Builder data."""
        cursor = self.db.execute(
            """
            SELECT MAX(updated_at) as last_updated
            FROM expanded_state
            WHERE account_id = ? AND page_name = 'build'
            """,
            (account_id,)
        )
        row = cursor.fetchone()
        return row['last_updated'] if row and row['last_updated'] else None
```

#### 4.1.2 New Route: `app/routes/builder_api.py`

```python
"""API routes for Builder data access."""

from flask import Blueprint, jsonify, g
from app.decorators.auth import require_auth
from app.services.builder_service import BuilderService
from app.db_manager import get_db

builder_api_bp = Blueprint('builder_api', __name__, url_prefix='/portfolio/api/builder')

@builder_api_bp.route('/investment-targets', methods=['GET'])
@require_auth
def get_investment_targets():
    """
    Get Builder investment targets for cross-page integration.

    Returns:
        JSON with budget data and portfolio targets.
    """
    db = get_db()
    service = BuilderService(db)

    targets = service.get_investment_targets(g.account_id)

    if not targets:
        return jsonify({
            'success': False,
            'error': 'no_builder_data',
            'message': 'No allocation targets configured. Please set up your budget in the Builder page.'
        }), 404

    # Validate completeness
    missing_fields = []
    if targets['budget']['totalNetWorth'] <= 0:
        missing_fields.append('totalNetWorth')
    if not targets['portfolioTargets']:
        missing_fields.append('portfolioAllocations')
    if targets['totals']['totalAllocationPercent'] < 100:
        missing_fields.append('completeAllocation')

    if missing_fields:
        return jsonify({
            'success': False,
            'error': 'incomplete_builder_data',
            'message': f'Builder configuration incomplete. Missing: {", ".join(missing_fields)}.',
            'missingFields': missing_fields,
            'partialData': targets  # Include partial data for UI flexibility
        }), 400

    return jsonify({
        'success': True,
        'data': targets
    })
```

#### 4.1.3 Modified Route: Portfolio Allocations Enhancement

In `app/routes/portfolio_api.py`, modify `get_simulator_allocations()`:

```python
@portfolio_api_bp.route('/api/simulator/portfolio-allocations', methods=['GET'])
@require_auth
def get_simulator_allocations():
    # ... existing code ...

    # NEW: Include investment targets if available
    builder_service = BuilderService(get_db())
    targets = builder_service.get_investment_targets(g.account_id)

    investment_targets = None
    if targets:
        if scope == 'global':
            investment_targets = {
                'hasBuilderConfig': True,
                'targetAmount': targets['totals']['totalTargetAmount'],
                'remainingToInvest': max(0, targets['totals']['totalTargetAmount'] - total_value),
                'percentComplete': round((total_value / targets['totals']['totalTargetAmount']) * 100, 1)
                    if targets['totals']['totalTargetAmount'] > 0 else 0
            }
        else:
            portfolio_target = builder_service.get_portfolio_target(g.account_id, portfolio_id)
            if portfolio_target:
                investment_targets = {
                    'hasBuilderConfig': True,
                    'portfolioName': portfolio_target['portfolioName'],
                    'allocationPercent': portfolio_target['allocationPercent'],
                    'targetAmount': portfolio_target['targetAmount'],
                    'remainingToInvest': max(0, portfolio_target['targetAmount'] - total_value),
                    'percentComplete': round((total_value / portfolio_target['targetAmount']) * 100, 1)
                        if portfolio_target['targetAmount'] > 0 else 0
                }

    response_data['investmentTargets'] = investment_targets

    return jsonify(response_data)
```

### 4.2 Frontend Changes

#### 4.2.1 File: `static/js/simulator.js`

**Additions to AllocationSimulator class:**

```javascript
// Add to constructor (around line 20)
this.investmentTargets = null;
this.hasBuilderConfig = false;

// Add new method after loadPortfolioAllocations (around line 180)
async loadInvestmentTargets() {
    try {
        const response = await fetch('/portfolio/api/builder/investment-targets');
        const result = await response.json();

        if (result.success) {
            this.investmentTargets = result.data;
            this.hasBuilderConfig = true;
        } else if (result.partialData) {
            // Use partial data with warnings
            this.investmentTargets = result.partialData;
            this.hasBuilderConfig = true;
            this.builderWarning = result.message;
        } else {
            this.hasBuilderConfig = false;
            this.investmentTargets = null;
        }
    } catch (error) {
        console.error('Failed to load investment targets:', error);
        this.hasBuilderConfig = false;
    }
}

// Modify render() to include new section (around line 500)
renderRemainingToInvestSection() {
    return `
        <div class="remaining-to-invest-section">
            ${this.hasBuilderConfig
                ? this.renderInvestmentProgress()
                : this.renderNoBuilderConfig()}
        </div>
    `;
}

renderInvestmentProgress() {
    const data = this.calculateRemainingToInvest();
    if (!data) return '';

    const percentFill = Math.min(100, data.percentComplete);
    const statusClass = data.isOverTarget ? 'over-target' :
                        data.percentComplete >= 100 ? 'complete' : '';

    // Calculate simulated impact
    const simulatedTotal = this.items.reduce((sum, item) => sum + (item.value || 0), 0);
    const projectedValue = data.currentValue + simulatedTotal;
    const projectedPercent = data.targetAmount > 0
        ? (projectedValue / data.targetAmount) * 100 : 0;

    return `
        <div class="remaining-header">
            <div class="remaining-title">
                <span class="label">Investment Progress</span>
                <span class="scope-badge">
                    ${this.scope === 'global' ? 'Global' : data.portfolioName || 'Portfolio'}
                    ${data.allocationPercent ? ` - ${data.allocationPercent}%` : ''}
                </span>
            </div>
            <div class="remaining-values">
                <span class="current-value">${this.formatCurrency(data.currentValue)}</span>
                <span class="separator">/</span>
                <span class="target-value">${this.formatCurrency(data.targetAmount)}</span>
            </div>
        </div>

        <div class="progress-container">
            <div class="progress-track">
                <div class="progress-fill ${statusClass}" style="width: ${percentFill}%"></div>
                ${simulatedTotal > 0 ? `
                    <div class="progress-simulated"
                         style="left: ${percentFill}%; width: ${Math.min(100 - percentFill, (simulatedTotal / data.targetAmount) * 100)}%">
                    </div>
                ` : ''}
            </div>
            <div class="progress-labels">
                <span class="percent-complete">
                    ${data.isOverTarget
                        ? `${data.percentComplete.toFixed(1)}% - ${this.formatCurrency(data.currentValue - data.targetAmount)} over target`
                        : `${data.percentComplete.toFixed(1)}% complete`}
                </span>
                <span class="remaining-amount">
                    ${data.isOverTarget ? '' : `${this.formatCurrency(data.remainingToInvest)} remaining`}
                </span>
            </div>
        </div>

        ${simulatedTotal > 0 ? `
            <div class="simulated-impact">
                <span class="simulated-label">With simulated additions:</span>
                <span class="simulated-value">${this.formatCurrency(projectedValue)}</span>
                <span class="simulated-percent">(${projectedPercent.toFixed(1)}%)</span>
            </div>
        ` : ''}
    `;
}

renderNoBuilderConfig() {
    return `
        <div class="no-builder-config">
            <p>Set up your investment targets in the
               <a href="/portfolio/build">Builder</a>
               to see your progress here.</p>
        </div>
    `;
}

calculateRemainingToInvest() {
    if (!this.investmentTargets || !this.portfolioData) return null;

    const currentValue = this.portfolioData.total_value || 0;

    if (this.scope === 'global') {
        const targetAmount = this.investmentTargets.totals.totalTargetAmount;
        return {
            targetAmount,
            currentValue,
            remainingToInvest: Math.max(0, targetAmount - currentValue),
            percentComplete: targetAmount > 0 ? (currentValue / targetAmount) * 100 : 0,
            isOverTarget: currentValue > targetAmount
        };
    } else {
        const portfolioTarget = this.investmentTargets.portfolioTargets
            .find(p => p.portfolioId === this.portfolioId);

        if (!portfolioTarget) return null;

        return {
            portfolioName: portfolioTarget.portfolioName,
            allocationPercent: portfolioTarget.allocationPercent,
            targetAmount: portfolioTarget.targetAmount,
            currentValue,
            remainingToInvest: Math.max(0, portfolioTarget.targetAmount - currentValue),
            percentComplete: portfolioTarget.targetAmount > 0
                ? (currentValue / portfolioTarget.targetAmount) * 100 : 0,
            isOverTarget: currentValue > portfolioTarget.targetAmount
        };
    }
}

// Modify initialization flow
async init() {
    await this.loadInvestmentTargets();  // NEW
    await this.loadPortfolioAllocations();
    // ... rest of existing init
}
```

#### 4.2.2 File: `static/css/allocate.css`

Add the CSS from section 3.3.2 to the end of allocate.css.

### 4.3 Database Changes

**No schema changes required.** The feature uses existing `expanded_state` table.

---

## 5. Testing Requirements

### 5.1 Unit Tests

#### Backend Tests (`tests/test_builder_service.py`)

```python
def test_get_investment_targets_returns_none_when_no_data():
    """Should return None when no Builder data exists."""

def test_get_investment_targets_parses_budget_correctly():
    """Should correctly parse budget data from JSON."""

def test_get_investment_targets_calculates_portfolio_targets():
    """Should calculate target amounts from allocation percentages."""

def test_get_portfolio_target_finds_correct_portfolio():
    """Should find and return specific portfolio target."""

def test_get_portfolio_target_returns_none_for_unknown():
    """Should return None for portfolio not in Builder."""
```

#### Frontend Tests (`tests/js/simulator.test.js`)

```javascript
describe('calculateRemainingToInvest', () => {
  test('returns null when no investment targets', () => {});
  test('calculates global remaining correctly', () => {});
  test('calculates portfolio remaining correctly', () => {});
  test('handles over-target scenario', () => {});
  test('handles zero target amount', () => {});
});

describe('renderInvestmentProgress', () => {
  test('shows correct progress percentage', () => {});
  test('shows simulated impact when items added', () => {});
  test('shows over-target warning', () => {});
});
```

### 5.2 Integration Tests

```python
def test_investment_targets_api_returns_data():
    """API should return Builder targets when configured."""

def test_investment_targets_api_returns_404_when_no_config():
    """API should return 404 when Builder not configured."""

def test_portfolio_allocations_includes_targets():
    """Portfolio allocations API should include investment targets."""
```

### 5.3 Manual Testing Checklist

- [ ] **No Builder Config**: Verify message appears with link to Builder
- [ ] **Partial Builder Config**: Verify warning with partial data
- [ ] **Global View**: Verify total progress calculation
- [ ] **Portfolio View**: Verify portfolio-specific progress
- [ ] **Switch Scopes**: Verify smooth transitions between views
- [ ] **Add Simulated Items**: Verify projected values update
- [ ] **Over Target**: Verify amber styling and correct messaging
- [ ] **Zero Target Portfolio**: Verify appropriate message
- [ ] **Data Consistency**: Verify values match Builder page

---

## 6. Rollout Plan

### Phase 1: Backend Implementation (1-2 days)
1. Create `BuilderService` class
2. Add `/investment-targets` API endpoint
3. Modify portfolio allocations endpoint
4. Add unit tests

### Phase 2: Frontend Implementation (2-3 days)
1. Add investment targets loading to Simulator
2. Implement progress bar component
3. Add CSS styles
4. Handle edge cases (no config, over target, etc.)
5. Integrate with simulated items

### Phase 3: Testing & Polish (1 day)
1. Manual testing of all scenarios
2. Cross-browser testing
3. Performance verification
4. Code review and refinements

### Phase 4: Documentation (0.5 days)
1. Update CLAUDE.md with new feature
2. Update user-facing help if applicable

---

## 7. Future Enhancements

### 7.1 Potential Extensions

1. **Rebalancing Suggestions**: Auto-suggest which positions to add to reach targets
2. **Time-based Projections**: "At current pace, you'll reach target in X months"
3. **Alert/Notification**: Notify when portfolio reaches target threshold
4. **Historical Tracking**: Chart showing progress toward target over time
5. **Multi-currency Support**: Show targets in user's preferred currency
6. **Target Adjustment**: Allow quick target edits from Simulator without going to Builder

### 7.2 Performance Considerations

1. **Caching**: Cache Builder targets (they change infrequently)
2. **Lazy Loading**: Only load targets when Simulator section is expanded
3. **Debouncing**: Debounce recalculations when simulated values change rapidly

---

## 8. Open Questions

1. **Should we show warnings if Builder allocations don't sum to 100%?**
   - Recommendation: Yes, show warning but still display available data

2. **How to handle portfolios deleted after Builder configuration?**
   - Recommendation: Skip deleted portfolios, show warning if significant mismatch

3. **Should percentage mode in Simulator respect Builder targets?**
   - Recommendation: Future enhancement - allow "invest to target" mode

4. **Real-time sync with Builder changes?**
   - Recommendation: No real-time sync needed; user can refresh Simulator page

---

## Appendix A: API Response Examples

### Full Success Response

```json
{
  "success": true,
  "data": {
    "budget": {
      "totalNetWorth": 200000,
      "emergencyFund": 50000,
      "alreadyInvested": 90000,
      "totalInvestableCapital": 150000,
      "availableToInvest": 60000
    },
    "portfolioTargets": [
      {
        "portfolioId": 1,
        "portfolioName": "Growth Portfolio",
        "allocationPercent": 40,
        "targetAmount": 60000
      },
      {
        "portfolioId": 2,
        "portfolioName": "Income Portfolio",
        "allocationPercent": 35,
        "targetAmount": 52500
      },
      {
        "portfolioId": 3,
        "portfolioName": "Speculative",
        "allocationPercent": 25,
        "targetAmount": 37500
      }
    ],
    "totals": {
      "totalTargetAmount": 150000,
      "totalAllocationPercent": 100
    },
    "lastUpdated": "2025-01-18T10:30:00Z"
  }
}
```

### Portfolio Allocations with Targets

```json
{
  "scope": "portfolio",
  "portfolio_id": 1,
  "total_value": 45000,
  "countries": [
    {"name": "United States", "value": 30000, "percentage": 66.7},
    {"name": "Germany", "value": 15000, "percentage": 33.3}
  ],
  "categories": [
    {"name": "Technology", "value": 25000, "percentage": 55.6},
    {"name": "Finance", "value": 20000, "percentage": 44.4}
  ],
  "investmentTargets": {
    "hasBuilderConfig": true,
    "portfolioName": "Growth Portfolio",
    "allocationPercent": 40,
    "targetAmount": 60000,
    "remainingToInvest": 15000,
    "percentComplete": 75.0
  }
}
```

---

## Appendix B: Visual Mockups

### Global View - Progress Complete

```
┌─────────────────────────────────────────────────────────────────┐
│  Investment Progress [Global]                                   │
│                                                  €150,000/€150,000│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │████████████████████████████████████████████████████████████ ││
│  └─────────────────────────────────────────────────────────────┘│
│  100% complete ✓                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Portfolio View - Partial Progress with Simulation

```
┌─────────────────────────────────────────────────────────────────┐
│  Investment Progress [Growth Portfolio - 40%]                   │
│                                                  €45,000/€60,000 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │██████████████████████████████████░░░░░░████░░░░░░░░░░░░░░░░ ││
│  │           Current (75%)          │Sim│    Remaining        ││
│  └─────────────────────────────────────────────────────────────┘│
│  75% complete                                    €15,000 remaining│
│                                                                 │
│  With simulated additions: €55,000 (91.7%)                      │
└─────────────────────────────────────────────────────────────────┘
```

### No Builder Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│     Set up your investment targets in the Builder               │
│     to see your progress here.                                  │
│                                                                 │
│     [Go to Builder →]                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

*Document Version: 1.0*
*Created: 2025-01-18*
*Author: Claude Code*
