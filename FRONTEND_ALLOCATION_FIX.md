# Frontend Allocation Fix - maxPerETF Not Matching

## Issue Description

When users set "Maximum % per ETF" to 5% in the Build page, the Capital Allocation view was **not** respecting this constraint. The backend was correctly calculating type-constrained allocations, but the frontend JavaScript was **ignoring** those values and recalculating its own allocations.

## Root Cause

The issue was in `static/js/allocate.js` in the `renderDetailedView()` function:

### Before Fix

1. **Backend** (`app/services/allocation_service.py`):
   - Correctly calculates type-constrained allocations
   - Applies `maxPerStock` and `maxPerETF` caps with recursive redistribution
   - Sends `position.targetValue` with constrained values
   - Sends capping metadata: `is_capped`, `unconstrained_target_value`, `constrained_target_value`

2. **Frontend** (`static/js/allocate.js` lines 936-946):
   - **IGNORED** backend's `position.targetValue`
   - Used `position.targetAllocation` (just the percentage, not constrained)
   - Normalized it: `normalizedAllocation = position.targetAllocation * normalizationFactor`
   - Calculated its own `position.calculatedTargetValue`
   - **Result**: Backend's careful type constraints were completely discarded!

### Example Scenario

**Setup:**
- User sets `maxPerETF = 5%` in Build page
- Portfolio has 3 ETFs with default 5% allocation each
- Total: 15% from ETFs (valid)

**What happened:**
1. Backend calculates: ETF1 = 5%, ETF2 = 5%, ETF3 = 5% ✓
2. Frontend ignores these values
3. Frontend sums: 5% + 5% + 5% = 15%
4. Frontend normalizes to 100%: normalizationFactor = 100/15 = 6.67
5. Frontend recalculates: ETF1 = 5% × 6.67 = 33.3%! ✗
6. **Result**: ETFs showing 33.3% instead of 5%

## The Fix

### Changes Made

**File**: `static/js/allocate.js`

**Location 1: Lines 891-930** - Normalization calculation
```javascript
// Third pass: assign target allocations and calculate total for normalization
let totalTargetAllocation = 0;
let hasBackendConstrainedValues = false; // NEW

if (portfolio.categories && portfolio.categories.length > 0) {
    portfolio.categories.forEach((category, categoryIndex) => {
        category.positions.forEach(position => {
            // NEW: Check if backend provided constrained target value
            if (position.targetValue !== undefined && position.targetValue !== null) {
                hasBackendConstrainedValues = true;
                // Calculate percentage for display
                const backendPct = portfolioTargetValue > 0
                    ? (position.targetValue / portfolioTargetValue) * 100
                    : 0;
                totalTargetAllocation += backendPct;
            } else {
                // Fallback to frontend logic if no backend value
                if (!position.targetAllocation || position.targetAllocation <= 0) {
                    const builderWeight = builderPositionsMap.get(position.name);
                    position.targetAllocation = builderWeight || defaultAllocation;
                }
                totalTargetAllocation += position.targetAllocation;
            }
        });
    });
}

// SKIP normalization if backend provided constrained values (already normalized)
const normalizationFactor = (!hasBackendConstrainedValues && totalTargetAllocation > 0)
    ? (100 / totalTargetAllocation)
    : 1; // No normalization when backend values present
```

**Location 2: Lines 936-964** - Target value calculation
```javascript
// Calculate values for each position in the category
category.positions.forEach(position => {
    categoryCurrentValue += (position.currentValue || 0);

    // CRITICAL: Use backend's constrained target value if available
    // Backend applies type constraints (maxPerStock, maxPerETF) with recursive redistribution
    if (position.targetValue !== undefined && position.targetValue !== null) {
        // Backend has already calculated constrained value - use it directly
        position.calculatedTargetValue = position.targetValue;

        // Calculate the percentage this represents (for display)
        const backendAllocation = portfolioTargetValue > 0
            ? (position.targetValue / portfolioTargetValue) * 100
            : 0;
        normalizedAllocations.set(position, backendAllocation);
        categoryTargetAllocation += backendAllocation;

        console.log(`Using backend constrained value for ${position.name}: ${position.targetValue.toFixed(2)} (${backendAllocation.toFixed(2)}%)`);
    } else {
        // Fallback to frontend normalization if backend didn't provide targetValue
        const normalizedAllocation = position.targetAllocation * normalizationFactor;
        normalizedAllocations.set(position, normalizedAllocation);
        categoryTargetAllocation += normalizedAllocation;

        const targetValue = (normalizedAllocation / 100) * portfolioTargetValue;
        position.calculatedTargetValue = targetValue;

        console.log(`Using frontend normalization for ${position.name}: ${normalizedAllocation.toFixed(2)}%`);
    }
});
```

## Expected Behavior After Fix

### Scenario 1: With maxPerETF = 5%
- **Setup**: User sets `maxPerETF = 5%`, portfolio has 5 ETF positions
- **Backend**: Calculates each ETF at 5% (capped), sends `targetValue` for each position
- **Frontend**: Detects `position.targetValue` exists → uses it directly → **ETFs show 5%** ✓

### Scenario 2: ETF exceeding cap
- **Setup**: User manually sets ETF1 = 20% in Build page, `maxPerETF = 5%`
- **Backend**: Caps ETF1 at 5%, redistributes 15% excess to other positions
- **Frontend**: Uses backend's constrained values → **ETF1 shows 5% with lock icon** ✓

### Scenario 3: Empty portfolio (no backend values)
- **Setup**: Portfolio has no target allocations set
- **Backend**: Sends positions without `targetValue`
- **Frontend**: Detects no `position.targetValue` → falls back to frontend normalization → works as before ✓

## Console Log Output

You'll now see helpful debug messages in browser console:

```
Portfolio Historic: Total target allocation before normalization: 100%, normalization factor: 1, using backend values: true
Using backend constrained value for iShares Core MSCI World ETF: 3500.00 (5.00%)
Using backend constrained value for Vanguard S&P 500 ETF: 3500.00 (5.00%)
Using backend constrained value for Apple Inc: 1400.00 (2.00%)
```

## Testing

### Manual Test Steps

1. **Clear browser cache** (important - JS is cached!)
2. Log in to your account
3. Go to **Build** page
4. Set **Maximum % per ETF** = 5%
5. Set **Maximum % per Stock** = 2%
6. Configure a portfolio with several ETFs and Stocks
7. Go to **Capital Allocation** page
8. Expand your portfolio
9. **Verify**: Each ETF shows ≤ 5% target allocation
10. **Verify**: Each Stock shows ≤ 2% target allocation
11. Open browser console (F12) and check for debug messages

### Expected Results

- ETF positions should show **5.00%** (or less if capped and redistributed)
- Stock positions should show **2.00%** (or less if capped and redistributed)
- Capped positions show **lock icon** with tooltip explaining the cap
- Console logs show "Using backend constrained value" messages

## Files Modified

1. `static/js/allocate.js`:
   - Lines 891-930: Normalization logic updated to detect backend values
   - Lines 936-964: Target value calculation updated to use backend values
   - Added console.log statements for debugging

## Related Documents

- `ALLOCATION_BUG_FIX_SUMMARY.md` - Previous backend fix for allocation calculations
- `app/services/allocation_service.py` - Backend type constraint logic

## Technical Details

### Why This Matters

The backend uses a sophisticated **recursive redistribution algorithm** to handle type constraints:

1. Calculate unconstrained target allocations
2. Check each position against its type cap (maxPerStock or maxPerETF)
3. If position exceeds cap, cap it and redistribute excess to uncapped positions
4. Repeat until convergence (all positions either capped or under cap)

This algorithm ensures:
- No position exceeds its type cap
- Excess allocation is distributed fairly to remaining positions
- Total allocation sums to 100%

**The frontend was completely bypassing this sophisticated logic!**

### Backward Compatibility

The fix maintains backward compatibility:
- If backend sends `position.targetValue` → use it (NEW behavior)
- If backend doesn't send `position.targetValue` → fall back to frontend normalization (OLD behavior)

This ensures the fix won't break existing functionality for portfolios without type constraints.

## Commit Message

```
fix(frontend): respect backend's type-constrained allocations in capital allocation view

The frontend was ignoring backend's carefully calculated type-constrained
allocations and recalculating its own values, causing maxPerETF and
maxPerStock rules to be bypassed.

Root cause:
- Backend correctly applies type constraints with recursive redistribution
- Backend sends position.targetValue with constrained values
- Frontend was using position.targetAllocation and normalizing it
- This discarded all backend constraint calculations

Changes:
- Check if position.targetValue exists (backend-constrained value)
- If yes: use it directly instead of recalculating
- If no: fall back to frontend normalization (backward compatible)
- Skip normalization when backend values are present
- Added debug console.log statements

Expected behavior:
- maxPerETF = 5% → ETFs show ≤ 5% in Capital Allocation
- maxPerStock = 2% → Stocks show ≤ 2% in Capital Allocation
- Capped positions show lock icon with tooltip
- Console shows which values are being used (backend vs frontend)

Files modified:
- static/js/allocate.js (lines 891-930, 936-964)

Resolves: Frontend bypassing maxPerETF/maxPerStock constraints
```

## Next Steps

1. ✓ Apply fix to `static/js/allocate.js`
2. ✓ Verify JavaScript syntax
3. Test manually with browser
4. Clear browser cache before testing
5. Check console logs for debug messages
6. Verify lock icons appear on capped positions

## Questions to Verify

After applying this fix, please verify:

1. Do ETF positions now show ≤ 5% when you set maxPerETF = 5%?
2. Do Stock positions now show ≤ 2% when you set maxPerStock = 2%?
3. Do capped positions show a lock icon 🔒 with a tooltip?
4. Does the console show "Using backend constrained value" messages?

If any of these don't work, please share:
- Browser console output
- Server logs (search for `[ALLOCATION DEBUG]`)
- Screenshot of the Capital Allocation page
