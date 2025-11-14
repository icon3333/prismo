# Allocation Bug Fix Summary

## Problem Description

When using the Capital Allocation feature, ETFs configured with a 5% allocation rule in the Build page were showing only 0.7% target allocation instead of the expected 5%.

### Example Issue
- User configured: `maxPerETF = 5%` in Build rules
- Expected: Each ETF gets ~5% target allocation
- Actual: ETF showed 0.7% target allocation in Capital Allocation view

## Root Causes Identified

### 1. **Inconsistent Default Values**
- **Location**: `app/services/allocation_service.py` lines 446 and 715
- **Issue**: Two different default values for `maxPerETF`
  - Line 446: Default was 5% (used for initial allocation)
  - Line 715: Default was 10% (used for type constraints/caps)
- **Impact**: After normalization, positions would exceed the cap and trigger recursive redistribution

### 2. **Misunderstanding of Rule Purpose**
- **UI Description**: "Maximum % per ETF: Limits the maximum percentage allocation for any single ETF position"
- **User Expectation**: Users thought this meant "Each ETF should get this percentage"
- **Actual Behavior**: Rule was only a CAP, not a target allocation
- **Impact**: Confusion about expected vs. actual allocations

### 3. **Placeholder Weight Ignored**
- **Location**: `app/services/allocation_service.py` lines 488-503
- **Issue**: When portfolios had ONLY placeholder positions (no explicit per-company weights), the placeholder's equal-distribution weight was ignored
- **Example**:
  - Portfolio "historic" had placeholder: "15x positions remaining" with 6.67% weight each
  - System ignored this and used type-based defaults (5% for ETF, 1.5% for Stock)
  - Total: 3×5% + 12×1.5% = 33% (not 100%)
  - Frontend normalized: ETFs became 15.15%, Stocks became 4.55%
  - Type constraints capped ETFs at 10% max
  - Recursive redistribution created unpredictable final allocations

### 4. **Normalization + Capping Interaction**
- **Issue**: Frontend normalization scaled positions beyond their caps
- **Impact**: Triggered recursive redistribution algorithm that produced unexpected results
- **Example**: 5% → normalized to 15.15% → capped to 10% → redistributed → final: much less than expected

## Fixes Implemented

### Fix 1: Unified Default Values (`allocation_service.py:717-719`)
```python
# Before: Inconsistent defaults
max_stock_pct = float(rules.get('maxPerStock', 5.0)) if rules else 5.0  # Line 717
max_etf_pct = float(rules.get('maxPerETF', 10.0)) if rules else 10.0    # Line 718

# After: Consistent defaults matching initial allocation defaults
max_stock_pct = float(rules.get('maxPerStock', 2.0)) if rules else 2.0  # Line 718
max_etf_pct = float(rules.get('maxPerETF', 5.0)) if rules else 5.0      # Line 719
```

**Impact**: Type constraints now use the same defaults as initial allocation, preventing unintended capping.

### Fix 2: Extract Explicit Position Weights (`allocation_service.py:495-516`)
```python
# Before: Always used type-based defaults, ignored explicit weight
default_weight = get_default_weight(company_name)
position_target_weights[position_key] = default_weight

# After: Use explicit weight if provided, fall back to default
explicit_weight = position.get('weight')
if explicit_weight is not None and explicit_weight > 0:
    position_target_weights[position_key] = float(explicit_weight)
    logger.debug(f"Set EXPLICIT weight for {company_name}: {explicit_weight}%")
else:
    default_weight = get_default_weight(company_name)
    position_target_weights[position_key] = default_weight
    logger.debug(f"Set DEFAULT weight for {company_name}: {default_weight}%")
```

**Impact**: Respects user-defined weights from Build page when provided.

### Fix 3: Detect and Use Placeholder Weight (`allocation_service.py:488-521`)
```python
# Detect portfolios with ONLY placeholders (equal distribution intent)
real_positions = [p for p in portfolio.get('positions', []) if not p.get('isPlaceholder')]
placeholder_positions = [p for p in portfolio.get('positions', []) if p.get('isPlaceholder')]
has_only_placeholders = len(real_positions) == 0 and len(placeholder_positions) > 0

# Extract placeholder weight if it exists
placeholder_weight = None
if has_only_placeholders and placeholder_positions:
    placeholder_weight = placeholder_positions[0].get('weight')
    if placeholder_weight:
        logger.info(f"Portfolio {portfolio.get('name')} has ONLY placeholders - will use for all positions")
        portfolio_builder_data[portfolio_id]['use_placeholder_weight'] = True
        portfolio_builder_data[portfolio_id]['placeholder_weight'] = placeholder_weight
```

**Impact**: When user sets up equal distribution via placeholders, all positions get the same weight.

### Fix 4: Apply Placeholder Weight to Database Positions (`allocation_service.py:566-584`)
```python
# Check if this portfolio uses placeholder-based equal distribution
builder_config = portfolio_builder_data.get(pid, {})
use_placeholder_weight = builder_config.get('use_placeholder_weight', False)
placeholder_weight_value = builder_config.get('placeholder_weight', None)

# If no target weight from Build page, determine default
if target_weight == 0:
    # Priority: placeholder weight > type-based default
    if use_placeholder_weight and placeholder_weight_value:
        target_weight = float(placeholder_weight_value)
        logger.info(f"Applied PLACEHOLDER weight for {row['company_name']}: {target_weight}%")
    elif row.get('investment_type') in ['Stock', 'ETF']:
        # ... type-based default logic
```

**Impact**: Real positions from database inherit the placeholder's equal-distribution weight.

### Fix 5: Enhanced Debug Logging
Added comprehensive logging throughout allocation calculation pipeline:
- Rules received and parsed
- Default weights applied
- Explicit vs. default vs. placeholder weight decisions
- Position-by-position targetAllocation assignments
- Type constraint application

**Impact**: Future debugging is much easier with full visibility into allocation decisions.

## Allocation Logic Priority (After Fixes)

When determining target allocation for a position, the system now uses this priority order:

1. **Explicit weight from Build page** (if user defined it for that specific company)
2. **Placeholder weight** (if portfolio has only placeholders → equal distribution)
3. **Type-based default from rules** (`maxPerStock` or `maxPerETF`)
4. **Hard-coded default** (2% for Stock, 5% for ETF)

## Expected Behavior After Fixes

### Scenario 1: Portfolio with Only Placeholders
- **Setup**: "historic" portfolio, 15 positions, placeholder weight 6.67%
- **Before Fix**: ETFs got 5%, Stocks got 1.5% → normalized to 15.15% and 4.55% → capped → redistributed → 0.7%
- **After Fix**: All positions get 6.67% → total 100% → no normalization needed → **6.67%**

### Scenario 2: Portfolio with Explicit Weights
- **Setup**: User defines specific % for each position in Build page
- **Before Fix**: Explicit weights were ignored, type defaults used
- **After Fix**: Explicit weights are respected → **user-defined %**

### Scenario 3: Portfolio with Type-Based Defaults
- **Setup**: No placeholder, no explicit weights, rules: `maxPerETF = 8%`
- **Before Fix**: Default 5% used, then normalized/capped unpredictably
- **After Fix**: ETFs get 8%, consistent cap at 8% → **8%** (or normalized if needed)

## Testing Recommendations

### Manual Test for Account 3 (Historic Portfolio)
1. Log in to account 3
2. Go to Capital Allocation page
3. Expand "historic" portfolio
4. Check "iShares Core MSCI World ETF":
   - **Target Allocation**: Should now show **~6.67%** (not 0.7%)
   - This is correct: 100% / 15 positions = 6.67%

### Verification Steps
1. Check server logs for `[ALLOCATION DEBUG]` messages
2. Verify placeholder weight detection: "Portfolio historic has ONLY placeholders"
3. Verify weight application: "Applied PLACEHOLDER weight for iShares Core MSCI World: 6.67%"
4. Confirm no recursive redistribution warnings

## Known Limitations

1. **UI Clarity**: The "Maximum % per ETF" label still says "maximum", which might confuse users who expect it to be a target
   - **Recommendation**: Update UI to clarify it's used for both target (when no explicit weights) and cap

2. **Mixed Placeholder + Explicit Weights**: If a portfolio has BOTH placeholders and explicit positions, only explicit positions get their weights; others fall back to type defaults
   - **Current Behavior**: Working as designed
   - **Future Enhancement**: Consider smarter weight distribution

3. **Normalization Still Happens**: If total weights don't sum to 100%, frontend still normalizes
   - **Current Behavior**: Acceptable for most cases
   - **Future Enhancement**: Backend could pre-normalize to avoid frontend surprises

## Files Modified

1. `app/services/allocation_service.py` (main fixes)
   - Lines 445-448: Debug logging for rules
   - Lines 456-469: Documentation of default weight logic
   - Lines 488-521: Placeholder detection and weight extraction
   - Lines 508-516: Explicit weight extraction
   - Lines 566-584: Placeholder weight application
   - Lines 674: Debug logging for position targets
   - Lines 717-719: Unified default values
   - Lines 720-722: Debug logging for type constraints

## Commit Message
```
fix: resolve ETF allocation calculation bug (0.7% instead of 5%)

Fixes incorrect target allocation percentages in Capital Allocation view.

Root causes addressed:
- Inconsistent default values (5% vs 10% for maxPerETF)
- Placeholder weights ignored for equal-distribution portfolios
- Explicit position weights not extracted from builder config
- Normalization + capping interaction caused recursive redistribution

Changes:
- Unified maxPerStock/maxPerETF defaults across allocation pipeline
- Detect and use placeholder weight when portfolio has only placeholders
- Extract explicit weights from Build page when provided
- Enhanced debug logging for allocation decisions

Expected behavior:
- Portfolios with placeholders: positions get equal weight (e.g., 6.67% for 15 positions)
- Portfolios with explicit weights: user-defined weights respected
- Type-based defaults: maxPerStock/maxPerETF used consistently

Resolves: Issue where iShares Core MSCI World ETF showed 0.7% instead of expected ~5-6%
```

## Next Steps

1. **Test the fix** with account 3's historic portfolio
2. **Monitor logs** for allocation calculation decisions
3. **Update UI** to clarify maxPerETF serves dual purpose (target + cap)
4. **Consider** adding allocation explanation to Capital Allocation page
5. **Document** in user guide how allocation rules work

## Questions for User

1. Is the placeholder weight (6.67%) the expected target for your historic portfolio?
2. Should we update the UI to make the dual purpose of max% rules clearer?
3. Do you want different behavior for ETFs vs. Stocks in equal-distribution portfolios?
