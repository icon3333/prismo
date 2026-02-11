# PRD: Manual Stock Addition on Enrich Page

## Executive Summary

### Problem Statement
Currently, users can only add securities to their portfolios via CSV import from Parqet. This creates friction when:
- Tracking **private holdings** not available in yfinance or Parqet
- Adding **newly purchased positions** before broker CSV updates
- Managing **non-standard assets** (crypto, commodities, private equity)

### Solution
Enable users to manually add securities on the Enrich page with two flows:
1. **With identifier** (ticker/ISIN) - Auto-fetches prices via yfinance
2. **Without identifier** - For private holdings with custom values

---

## Confirmed Behaviors

| Scenario | Behavior |
|----------|----------|
| Identifier lookup fails | Warning shown, user can fix identifier OR enter custom value |
| Duplicate detected | **Block completely** - must edit existing entry |
| Button placement | Top controls row (next to "Update all data", "Download CSV") |
| Visual distinction | "Manual" badge/icon next to company name in table |
| Manual stock not in CSV import | **Protected** - never auto-deleted |
| Manual stock later appears in CSV | **Keep separate** - both entries coexist |
| Portfolio selection | **Optional** - can add to "Unassigned" pool |
| Shares field | **Required**, must be >0 |
| Identifier validation | Auto on blur (debounced 500ms) |
| Deletion | Manual stocks deletable via selection + bulk action; CSV stocks **not deletable** |

---

## User Stories

### US-1: Adding a Public Security
> "As an investor who just bought AAPL shares, I want to add them immediately so I can see my updated allocation without waiting for my broker's next export."

**Flow:**
1. Click "Add Stock" button
2. Enter "AAPL" in identifier field
3. System auto-validates, shows price preview
4. Fill in shares, sector
5. Submit → Stock appears in Enrich table with "Manual" badge

### US-2: Adding a Private Holding
> "As an investor with pre-IPO equity, I want to add my private company shares to track total portfolio allocation."

**Flow:**
1. Click "Add Stock" button
2. Leave identifier blank
3. Enter company name, shares, total value (EUR)
4. Submit → Stock appears with custom value indicator + "Manual" badge

### US-3: Deleting a Manual Stock
> "As a user, I want to remove a manually-added stock that I no longer hold."

**Flow:**
1. Select the manual stock(s) in Enrich table
2. Bulk action bar appears with "Delete" option
3. Click Delete → Confirmation → Stock removed

---

## Functional Requirements

### FR-1: Add Stock Button

- **Location**: Top controls row, after "Download CSV" button
- **Style**: Primary button with `fa-plus` icon, text "Add Stock"
- **Action**: Opens modal dialog

### FR-2: Add Stock Modal

**Form Fields:**

| Field | Type | Required | Condition |
|-------|------|----------|-----------|
| Identifier | Text input | No | If provided, triggers yfinance lookup |
| Company Name | Text input | Yes | 1-200 characters |
| Portfolio | Dropdown | No | Default: "Unassigned" or current filter |
| Sector | Text input | Yes | 1-100 characters |
| Investment Type | Dropdown | No | Stock / ETF / (blank) |
| Country | Dropdown | No | Auto-filled if identifier valid |
| Shares | Number input | Yes | Must be >0, up to 6 decimals |
| Total Value (EUR) | Currency input | Conditional | Required if identifier blank or lookup failed |

**Identifier Validation (on blur):**
- Show loading spinner during lookup
- **Success**: Display price preview, auto-fill country, hide Total Value field
- **Failure**: Show warning, keep Total Value field visible, user can proceed with custom value

**Duplicate Detection:**
- Check for existing company with same name OR identifier (case-insensitive)
- If found: **Block submission** with error message showing existing entry details
- User must edit existing entry or use different name/identifier

### FR-3: Visual Indicator in Enrich Table

- Manual stocks display a small badge/icon (e.g., "M" or hand icon) next to company name
- Tooltip on hover: "Manually added"
- CSS class: `.manual-stock-badge`

### FR-4: Deletion of Manual Stocks

- **Selection**: User selects one or more stocks in Enrich table
- **Bulk Action**: "Delete" option appears in bulk action bar (only for manual stocks)
- **Validation**: If selection includes CSV stocks, show warning that only manual stocks will be deleted
- **Confirmation**: Modal confirms deletion with stock names listed
- **CSV stocks**: Cannot be deleted (button disabled or hidden when only CSV stocks selected)

### FR-5: CSV Re-import Protection

- New database column: `companies.source` (values: `csv`, `manual`)
- During CSV import:
  - Skip deletion of companies with `source = 'manual'`
  - If same stock appears in CSV, create new entry with `source = 'csv'` (keep separate)
- Manual stocks are never modified by CSV imports

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Modal open time | <200ms |
| Identifier validation | <3 seconds (yfinance lookup) |
| Database insertion | <500ms |
| UI refresh after add | <1 second |

---

## UI/UX Design

### Modal Layout (Ocean Depth Theme)

```
┌─────────────────────────────────────────────────────────────┐
│  Add Stock                                              [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Identifier (optional)                                      │
│  ┌─────────────────────────────────────┐                   │
│  │ AAPL                                │ ✅ €162.30        │
│  └─────────────────────────────────────┘                   │
│  Leave blank for private holdings                           │
│                                                             │
│  Company Name *                                             │
│  ┌─────────────────────────────────────┐                   │
│  │ Apple Inc.                          │                   │
│  └─────────────────────────────────────┘                   │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Portfolio    ▼  │  │ Sector *        │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Type         ▼  │  │ Country      ▼  │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Shares *        │  │ Total Value EUR │ (if no identifier)
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│                         [ Cancel ]  [ Add Stock ]          │
└─────────────────────────────────────────────────────────────┘
```

### States

1. **Initial**: Empty form, Portfolio pre-selected if page is filtered
2. **Identifier Valid**: Green checkmark, price preview, Total Value hidden
3. **Identifier Invalid**: Warning icon, message, Total Value visible
4. **Duplicate Found**: Error state, submission blocked, shows existing entry
5. **Submitting**: Loading spinner on button

### Manual Stock Badge

```html
<span class="manual-badge" title="Manually added">M</span>
```

```css
.manual-badge {
  background: var(--primary);
  color: var(--bg-primary);
  font-size: 0.65rem;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  margin-left: 6px;
  font-weight: 600;
}
```

---

## Technical Implementation

### Database Changes

**Migration 11: Add source column**
```sql
ALTER TABLE companies ADD COLUMN source TEXT DEFAULT 'csv'
  CHECK(source IN ('csv', 'manual'));

UPDATE companies SET source = 'csv' WHERE source IS NULL;

CREATE INDEX idx_companies_source ON companies(source);
```

### API Endpoint

**POST `/portfolio/api/add_company`**

Request:
```json
{
  "name": "Apple Inc.",
  "identifier": "AAPL",
  "portfolio_id": 1,
  "sector": "Technology",
  "investment_type": "Stock",
  "country": "US",
  "shares": 10.5,
  "total_value": null
}
```

Response (success):
```json
{
  "success": true,
  "company_id": 123,
  "message": "Added Apple Inc."
}
```

Response (duplicate):
```json
{
  "success": false,
  "error": "duplicate",
  "existing": {
    "id": 45,
    "name": "Apple Inc.",
    "portfolio_name": "Tech Holdings"
  }
}
```

### Architecture

```
Route: POST /api/portfolio/add_company
  └── CompanyService.add_company_manual(account_id, data)
        ├── Validate input
        ├── Check duplicates → PortfolioRepository.find_duplicate()
        ├── Fetch price (if identifier) → yfinance_utils
        └── Insert → PortfolioRepository.create_company_manual()
```

### Files to Modify/Create

| File | Action |
|------|--------|
| `app/services/company_service.py` | **Create** - new service |
| `app/repositories/portfolio_repository.py` | Add `find_duplicate()`, `create_company_manual()` |
| `app/routes/portfolio_api.py` | Add `/api/portfolio/add_company` route |
| `app/db_manager.py` | Add migration 11 (source column) |
| `app/templates/enrich.html` | Add button, modal HTML |
| `app/static/js/enrich.js` | Add modal logic, API calls |
| `app/static/css/components.css` | Add `.manual-badge` styles |
| `app/utils/csv_processing/transaction_manager.py` | Skip deletion of `source='manual'` |

---

## Implementation Phases

### Phase 1: MVP (4-6 hours)
- [x] Database migration (source column) - Migration 11 completed
- [x] API endpoint - `/portfolio/api/add_company` implemented
- [x] Service layer - `CompanyService` created with business logic
- [x] Repository methods - `find_duplicate_company`, `create_company_manual`, `delete_manual_company`
- [ ] Add Stock button + modal UI (frontend pending)
- [ ] Form with all fields (frontend pending)
- [ ] Identifier validation UI (backend ready, frontend pending)
- [ ] Success/error feedback UI (frontend pending)

### Phase 2: Polish (2-3 hours)
- [ ] Manual badge in Enrich table (frontend pending)
- [x] Bulk delete API - `/portfolio/api/delete_manual_companies` implemented
- [x] CSV import protection logic - Transaction manager skips manual stocks

---

## Edge Cases

| Case | Handling |
|------|----------|
| yfinance timeout (>5s) | Show warning, switch to custom value mode |
| ISIN instead of ticker | Normalize via `identifier_normalization.py` |
| Negative/zero shares | Block with validation error |
| Invalid portfolio ID | Return 400 error |
| Company name >200 chars | Truncate or reject |
| Currency conversion fails | Fall back to custom value mode |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to add stock | <60 seconds |
| Success rate | >95% of attempts |
| Manual stock adoption | 50% of users add ≥1 within 30 days |

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Duplicate handling | Block completely |
| CSV merge behavior | Keep separate entries |
| Portfolio requirement | Optional (Unassigned allowed) |
| Zero shares allowed | No, must be >0 |
| Deletion flow | Bulk action for manual stocks only |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-20 | Initial PRD with confirmed behaviors |
