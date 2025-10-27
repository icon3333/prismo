# 🏥 DETAILED CODE HEALTH IMPROVEMENT PLAN

**Created**: 2025-10-27
**Based on**: Comprehensive code review and analysis
**Target**: Production-ready, maintainable codebase
**Philosophy**: Simple, Modular, Elegant, Efficient, Robust

---

## 📊 EXECUTIVE SUMMARY

### Current State Analysis

**Major Issues Identified**:
- **18 instances** of duplicate session validation code
- **32+ instances** of similar error handling patterns
- **20 functions** exceeding 50 lines (largest: 625 lines!)
- **54+ duplicate** JSON response patterns
- **11 instances** of scattered backup_database() calls
- **8 files** with mixed concerns (routes handling business logic)

**Code Health Metrics**:
- Largest function: `process_csv_data()` - **625 lines** ⚠️
- Most complex: `get_allocate_portfolio_data()` - **249 lines**, 3 levels of nesting ⚠️
- Duplication hot spot: Session validation - **18 occurrences** across 5 files ⚠️

---

## 🎯 CRITICAL ISSUES (Must Fix)

### Issue #1: Monster Functions ⚠️⚠️⚠️
**Severity**: CRITICAL
**Impact**: Unmaintainable, untestable, error-prone

#### Functions > 200 Lines

1. **`process_csv_data()` - 625 lines** 📍 Most Critical
   - **File**: `app/utils/portfolio_processing.py:20-645`
   - **What it does**: 6-phase CSV import with transaction processing
   - **Problems**:
     - Single function doing 6 distinct operations
     - Impossible to unit test individual phases
     - Complex nested loops (3-4 levels deep)
     - Mixed concerns: parsing, validation, calculation, database ops

   **Refactoring Plan**:
   ```python
   # BEFORE: One 625-line function
   def process_csv_data(csv_content, account_id):
       # 625 lines of everything...

   # AFTER: 6 focused functions
   def parse_csv_columns(df: pd.DataFrame) -> Dict[str, str]:
       """Phase 1: Parse and map CSV columns (50 lines)"""

   def normalize_transactions(df: pd.DataFrame) -> pd.DataFrame:
       """Phase 2: Normalize transaction types (80 lines)"""

   def accumulate_buy_transactions(df: pd.DataFrame) -> Dict:
       """Phase 3: Accumulate purchases (100 lines)"""

   def apply_sell_transactions(holdings: Dict, sells: List) -> Dict:
       """Phase 4: Apply sales/transfers (100 lines)"""

   def persist_holdings(holdings: Dict, account_id: int) -> List[str]:
       """Phase 5: Save to database (150 lines)"""

   def fetch_prices(identifiers: List[str]) -> None:
       """Phase 6: Fetch market prices (50 lines)"""

   def process_csv_data(csv_content, account_id):
       """Main orchestrator (50 lines)"""
       df = pd.read_csv(io.StringIO(csv_content))
       column_map = parse_csv_columns(df)
       df = normalize_transactions(df)
       holdings = accumulate_buy_transactions(df)
       holdings = apply_sell_transactions(holdings, df[df.type=='sell'])
       identifiers = persist_holdings(holdings, account_id)
       fetch_prices(identifiers)
   ```

   **Effort**: 8-10 hours
   **Priority**: P0 (Do first)

2. **`get_allocate_portfolio_data()` - 249 lines**
   - **File**: `app/routes/portfolio_api.py:369-617`
   - **What it does**: Complex portfolio allocation data generation
   - **Problems**:
     - 3 levels of nested loops
     - Mixed API logic and calculations
     - Should use AllocationService from Phase 2

   **Refactoring Plan**:
   ```python
   # Move to AllocationService and split into:
   - load_allocation_config() -> 50 lines
   - calculate_position_weights() -> 60 lines
   - generate_allocation_structure() -> 80 lines
   - format_api_response() -> 40 lines
   ```

   **Effort**: 6-8 hours
   **Priority**: P0 (Do first)

3. **`_apply_company_update()` - 231 lines**
   - **File**: `app/routes/portfolio_api.py:30-262`
   - **What it does**: Update company data with complex side effects
   - **Problems**:
     - Database operations mixed with price fetching
     - Multiple responsibility: portfolio, identifier, shares, country

   **Refactoring Plan**:
   ```python
   # Move to PortfolioService and split:
   - resolve_portfolio_assignment() -> 40 lines
   - handle_identifier_change() -> 60 lines
   - update_company_attributes() -> 50 lines
   - update_share_information() -> 40 lines
   - trigger_price_refresh() -> 30 lines
   ```

   **Effort**: 5-6 hours
   **Priority**: P1

4. **`import_data()` - 252 lines**
   - **File**: `app/routes/account_routes.py:401-654`
   - **What it does**: Complex JSON import with ID remapping
   - **Problems**:
     - Extremely complex ID remapping logic
     - Transaction management scattered throughout

   **Refactoring Plan**:
   ```python
   # Create ImportService:
   - parse_import_json() -> 40 lines
   - remap_portfolio_ids() -> 50 lines
   - remap_company_ids() -> 50 lines
   - import_state_data() -> 40 lines
   - import_allocation_data() -> 50 lines
   - verify_import() -> 20 lines
   ```

   **Effort**: 6-7 hours
   **Priority**: P1

5. **`update_portfolio_api()` - 208 lines**
   - **File**: `app/routes/portfolio_api.py:1041-1248`
   - **What it does**: Batch update with normalization
   - **Problems**:
     - Mixed validation, database, price fetching
     - Could use PortfolioRepository and services

   **Effort**: 4-5 hours
   **Priority**: P1

---

### Issue #2: Code Duplication Epidemic ⚠️⚠️
**Severity**: HIGH
**Impact**: Maintenance burden, inconsistency bugs

#### Pattern 1: Session Validation (18 instances)

**Current Code** (repeated 18 times):
```python
# API endpoints (8 times)
if 'account_id' not in session:
    return jsonify({'error': 'Not authenticated'}), 401
account_id = session['account_id']

# Template routes (6 times)
if 'account_id' not in session:
    flash('Please select an account first', 'warning')
    return redirect(url_for('main.index'))
account_id = session['account_id']
account = query_db('SELECT * FROM accounts WHERE id = ?', [account_id], one=True)
if not account:
    flash('Account not found', 'error')
    return redirect(url_for('main.index'))
```

**Solution**: Create decorator

```python
# app/decorators/auth.py
from functools import wraps
from flask import session, jsonify, flash, redirect, url_for, g
from app.db_manager import query_db

def require_account(return_json=False):
    """
    Decorator to require authenticated account.

    Args:
        return_json: If True, return JSON error. If False, redirect with flash.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Check session
            if 'account_id' not in session:
                if return_json:
                    return jsonify({'error': 'Not authenticated'}), 401
                flash('Please select an account first', 'warning')
                return redirect(url_for('main.index'))

            # Store in g for easy access
            g.account_id = session['account_id']

            # Verify account exists (for template routes)
            if not return_json:
                account = query_db(
                    'SELECT * FROM accounts WHERE id = ?',
                    [g.account_id],
                    one=True
                )
                if not account:
                    flash('Account not found', 'error')
                    return redirect(url_for('main.index'))
                g.account = account

            return f(*args, **kwargs)
        return decorated_function
    return decorator
```

**Usage**:
```python
# API endpoints
@portfolio_bp.route('/api/prices/update', methods=['POST'])
@require_account(return_json=True)
def update_price_api():
    account_id = g.account_id  # No validation needed!
    # ... rest of function

# Template routes
@portfolio_bp.route('/enrich')
@require_account(return_json=False)
def enrich():
    account_id = g.account_id  # No validation needed!
    account = g.account        # Already loaded!
    # ... rest of function
```

**Files to Update**:
- `app/routes/portfolio_updates.py` - 8 functions
- `app/routes/portfolio_api.py` - 9 functions
- `app/routes/portfolio_routes.py` - 6 functions
- `app/routes/account_routes.py` - 7 functions
- `app/routes/simple_upload.py` - 1 function

**Effort**: 3-4 hours
**Impact**: Removes ~150 lines of duplicate code
**Priority**: P0 (High ROI)

---

#### Pattern 2: Error Handling (32+ instances)

**Current Code** (repeated 32+ times):
```python
try:
    # ... operation ...
except Exception as e:
    logger.error(f"Error doing thing: {str(e)}")
    return jsonify({'error': str(e)}), 500
```

**Solution**: Create error handler utility

```python
# app/utils/response_helpers.py
from flask import jsonify, flash, redirect, url_for
import logging

logger = logging.getLogger(__name__)

def handle_api_error(e: Exception, action: str, status_code: int = 500):
    """
    Standard API error handler.

    Args:
        e: Exception that occurred
        action: Description of what was being attempted
        status_code: HTTP status code to return

    Returns:
        JSON response tuple (response, status_code)
    """
    logger.error(f"Error {action}: {str(e)}", exc_info=True)
    return jsonify({
        'success': False,
        'error': str(e),
        'action': action
    }), status_code

def handle_form_error(e: Exception, redirect_route: str, action: str):
    """
    Standard form error handler with flash message.

    Args:
        e: Exception that occurred
        action: Description of what was being attempted
        redirect_route: Route to redirect to

    Returns:
        Redirect response
    """
    logger.error(f"Error {action}: {str(e)}", exc_info=True)
    flash(f'Error {action}: {str(e)}', 'error')
    return redirect(url_for(redirect_route))
```

**Usage**:
```python
# BEFORE (5 lines)
try:
    # ... operation ...
except Exception as e:
    logger.error(f"Error updating price: {str(e)}")
    return jsonify({'error': str(e)}), 500

# AFTER (2 lines)
try:
    # ... operation ...
except Exception as e:
    return handle_api_error(e, "updating price")
```

**Effort**: 2-3 hours
**Priority**: P0

---

#### Pattern 3: Response Formatting (108+ instances)

**Solution**: Create response builders

```python
# app/utils/response_helpers.py

def success_response(data=None, message=None, **kwargs):
    """Standard success response"""
    response = {'success': True}
    if message:
        response['message'] = message
    if data is not None:
        response['data'] = data
    response.update(kwargs)  # Additional fields
    return jsonify(response)

def error_response(message: str, status_code: int = 400, **kwargs):
    """Standard error response"""
    response = {
        'success': False,
        'error': message
    }
    response.update(kwargs)
    return jsonify(response), status_code
```

**Usage**:
```python
# BEFORE
return jsonify({
    'success': True,
    'message': f'Updated {count} items',
    'updated_count': count
})

# AFTER
return success_response(message=f'Updated {count} items', updated_count=count)
```

**Effort**: 2 hours
**Priority**: P1

---

#### Pattern 4: Database Query Duplication (15+ instances)

**Solution**: Use PortfolioRepository from Phase 2

```python
# Already created in Phase 2!
from app.repositories.portfolio_repository import PortfolioRepository

# BEFORE (appears 8 times)
account = query_db('SELECT * FROM accounts WHERE id = ?', [account_id], one=True)

# AFTER - Add to repository
class AccountRepository:
    @staticmethod
    def get_by_id(account_id: int) -> Optional[Dict]:
        return query_db('SELECT * FROM accounts WHERE id = ?', [account_id], one=True)

# Usage
from app.repositories import AccountRepository
account = AccountRepository.get_by_id(account_id)
```

**Files to Create/Update**:
- Create `app/repositories/account_repository.py`
- Expand `app/repositories/portfolio_repository.py` with missing queries

**Effort**: 3-4 hours
**Priority**: P1

---

### Issue #3: Mixed Concerns ⚠️
**Severity**: HIGH
**Impact**: Testability, maintainability

**Problem**: Routes contain business logic instead of using services

**Example**:
```python
# portfolio_routes.py:31-144 (enrich function)
# Contains:
# - API calls (country list)
# - Portfolio calculations (health metrics)
# - Data transformation
# - Template rendering

# Should be:
@portfolio_bp.route('/enrich')
@require_account(return_json=False)
def enrich():
    account_id = g.account_id

    # Use services (from Phase 2!)
    holdings = PortfolioRepository.get_all_holdings(account_id)
    health_metrics = PortfolioService.calculate_health_metrics(holdings)
    countries = CountryService.get_country_list()  # New service

    return render_template(
        'enrich.html',
        holdings=holdings,
        metrics=health_metrics,
        countries=countries
    )
```

**Priority**: P1
**Effort**: Ongoing as part of function refactoring

---

## 📋 DETAILED REFACTORING TASKS

### Phase 1: Quick Wins (Week 1) - 12-15 hours

#### Task 1.1: Create Authentication Decorator ✅ HIGH ROI
**Files**:
- Create: `app/decorators/__init__.py`
- Create: `app/decorators/auth.py`
- Update: 31 route functions across 5 files

**Steps**:
1. Create decorator module (1 hour)
2. Test decorator with one route (0.5 hour)
3. Apply to all API endpoints (2 hours)
4. Apply to all template routes (2 hours)
5. Test all routes still work (1 hour)
6. Remove old validation code (0.5 hour)

**Code Saved**: ~150 lines
**Effort**: 7 hours
**Priority**: P0

---

#### Task 1.2: Create Response Helpers ✅ HIGH ROI
**Files**:
- Create: `app/utils/response_helpers.py`
- Update: 40+ route functions

**Functions to Create**:
```python
def success_response(data=None, message=None, **kwargs)
def error_response(message, status_code=400, **kwargs)
def handle_api_error(e, action, status_code=500)
def handle_form_error(e, redirect_route, action)
```

**Steps**:
1. Create helper module (1.5 hours)
2. Write unit tests (1 hour)
3. Update API endpoints (2 hours)
4. Update form handlers (1.5 hours)

**Code Saved**: ~120 lines
**Effort**: 6 hours
**Priority**: P0

---

### Phase 2: Repository Expansion (Week 2) - 8-10 hours

#### Task 2.1: Create AccountRepository
**File**: `app/repositories/account_repository.py`

**Methods to Implement**:
```python
class AccountRepository:
    @staticmethod
    def get_by_id(account_id: int) -> Optional[Dict]

    @staticmethod
    def get_all() -> List[Dict]

    @staticmethod
    def create(name: str, **settings) -> int

    @staticmethod
    def update(account_id: int, **settings) -> bool

    @staticmethod
    def delete(account_id: int) -> bool

    @staticmethod
    def get_settings(account_id: int) -> Dict
```

**Effort**: 3 hours
**Priority**: P1

---

#### Task 2.2: Expand PortfolioRepository
**File**: `app/repositories/portfolio_repository.py`

**New Methods Needed**:
```python
def get_portfolio_by_name(name: str, account_id: int) -> Optional[Dict]
def create_or_get_portfolio(name: str, account_id: int) -> int
def get_default_portfolio(account_id: int) -> Dict
def bulk_update_shares(updates: List[Dict], account_id: int) -> Dict
```

**Effort**: 2-3 hours
**Priority**: P1

---

#### Task 2.3: Create PriceRepository
**File**: `app/repositories/price_repository.py`

**Methods**:
```python
class PriceRepository:
    @staticmethod
    def get_price(identifier: str) -> Optional[Dict]

    @staticmethod
    def update_price(identifier: str, price: float, currency: str, price_eur: float)

    @staticmethod
    def get_stale_prices(max_age_hours: int = 24) -> List[str]

    @staticmethod
    def bulk_update(price_data: List[Dict]) -> int
```

**Effort**: 2-3 hours
**Priority**: P1

---

### Phase 3: Monster Function Refactoring (Weeks 3-4) - 30-35 hours

#### Task 3.1: Refactor `process_csv_data()` ⚠️ CRITICAL
**File**: `app/utils/portfolio_processing.py`

**New Structure**:
```
app/services/csv_import_service.py (350 lines total)
├── CSVImportService (class)
│   ├── parse_csv_columns()      # 50 lines - Phase 1
│   ├── normalize_transactions() # 80 lines - Phase 2
│   ├── accumulate_purchases()   # 100 lines - Phase 3
│   ├── apply_sales()            # 100 lines - Phase 4
│   ├── persist_holdings()       # 70 lines - Phase 5 (uses repo)
│   └── import_csv()             # 50 lines - Orchestrator
```

**Detailed Sub-Tasks**:

1. **Extract Phase 1: Column Parsing** (2 hours)
   ```python
   def parse_csv_columns(df: pd.DataFrame) -> Tuple[Dict[str, str], List[str]]:
       """
       Parse CSV columns and create column mapping.

       Returns:
           (column_map, errors)
       """
   ```

2. **Extract Phase 2: Transaction Normalization** (2 hours)
   ```python
   def normalize_transactions(
       df: pd.DataFrame,
       column_map: Dict[str, str]
   ) -> pd.DataFrame:
       """Normalize transaction types and dates."""
   ```

3. **Extract Phase 3: Purchase Accumulation** (3 hours)
   ```python
   def accumulate_purchases(df: pd.DataFrame) -> Dict[str, Holding]:
       """Accumulate all purchases into holdings."""
   ```

4. **Extract Phase 4: Sales Processing** (3 hours)
   ```python
   def apply_sales(
       holdings: Dict[str, Holding],
       sales_df: pd.DataFrame
   ) -> Dict[str, Holding]:
       """Apply sell/transfer transactions."""
   ```

5. **Extract Phase 5: Database Persistence** (2 hours)
   ```python
   def persist_holdings(
       holdings: Dict[str, Holding],
       account_id: int
   ) -> List[str]:
       """Save holdings to database using repository."""
       # Use PortfolioRepository!
   ```

6. **Create Orchestrator** (1 hour)
7. **Write Unit Tests** (4 hours)
8. **Integration Testing** (2 hours)

**Total Effort**: 19 hours
**Priority**: P0
**Impact**: Reduces 625-line function to 6 testable modules

---

#### Task 3.2: Refactor `get_allocate_portfolio_data()` ⚠️ CRITICAL
**File**: `app/routes/portfolio_api.py` → Move to `app/services/allocation_service.py`

**New Structure**:
```python
# Extend AllocationService from Phase 2
class AllocationService:
    # ... existing methods ...

    def load_allocation_config(self, account_id: int) -> Dict:
        """Load allocation builder configuration."""

    def calculate_position_weights(
        self,
        config: Dict,
        holdings: List[Dict]
    ) -> Dict:
        """Calculate weights at portfolio/category/position levels."""

    def generate_allocation_structure(
        self,
        config: Dict,
        weights: Dict
    ) -> Dict:
        """Generate final allocation structure for API."""
```

**Sub-Tasks**:
1. Extract config loading (2 hours)
2. Extract weight calculations (3 hours)
3. Extract structure generation (3 hours)
4. Create API wrapper (1 hour)
5. Write tests (3 hours)
6. Integration testing (1 hour)

**Total Effort**: 13 hours
**Priority**: P0

---

#### Task 3.3: Refactor Other Large Functions
**Batch remaining large functions**:

1. `_apply_company_update()` - 5 hours
2. `import_data()` - 6 hours
3. `update_portfolio_api()` - 4 hours

**Total Effort**: 15 hours
**Priority**: P1

---

### Phase 4: Testing & Quality (Week 5) - 15-20 hours

#### Task 4.1: Integration Tests for Repositories
**File**: `tests/test_repositories_integration.py`

**Coverage**:
- AccountRepository (all methods)
- PortfolioRepository (all methods)
- PriceRepository (all methods)

**Effort**: 6-8 hours

---

#### Task 4.2: Route Tests
**File**: `tests/test_routes.py`

**Coverage**:
- Authentication decorator tests
- Response helper tests
- Critical endpoint tests (upload, update, allocate)

**Effort**: 6-8 hours

---

#### Task 4.3: Service Tests
**Expand existing**: `tests/test_services.py`

**New Coverage**:
- CSVImportService
- Extended AllocationService methods

**Effort**: 3-4 hours

---

### Phase 5: Documentation & Cleanup (Week 6) - 8-10 hours

#### Task 5.1: Update Documentation
- API documentation
- Architecture diagrams
- Developer guide

**Effort**: 4 hours

---

#### Task 5.2: Code Quality Tools
**Setup**:
```toml
# pyproject.toml
[tool.black]
line-length = 100

[tool.ruff]
select = ["E", "F", "I", "N", "W"]
line-length = 100

[tool.mypy]
python_version = "3.9"
```

**Effort**: 2 hours

---

#### Task 5.3: Performance Optimization
- Add query performance logging
- Optimize N+1 queries (if any remain)
- Review caching effectiveness

**Effort**: 2-3 hours

---

## 📊 PRIORITY MATRIX & TIMELINE

### P0 - Critical (Do First) - Weeks 1-3

| Task | Effort | Impact | ROI |
|------|--------|--------|-----|
| Authentication decorator | 7h | 150 lines saved | HIGH ✅ |
| Response helpers | 6h | 120 lines saved | HIGH ✅ |
| Refactor `process_csv_data()` | 19h | Testability++ | CRITICAL ✅ |
| Refactor `get_allocate_portfolio_data()` | 13h | Testability++ | CRITICAL ✅ |

**Total P0**: 45 hours (1.5 weeks part-time)

---

### P1 - High Priority (Do Next) - Weeks 4-5

| Task | Effort | Impact |
|------|--------|--------|
| AccountRepository | 3h | Code consolidation |
| Expand PortfolioRepository | 3h | Code consolidation |
| PriceRepository | 3h | Code consolidation |
| Refactor `_apply_company_update()` | 5h | Maintainability |
| Refactor `import_data()` | 6h | Maintainability |
| Refactor `update_portfolio_api()` | 4h | Maintainability |
| Integration tests | 8h | Reliability |
| Route tests | 8h | Reliability |

**Total P1**: 40 hours (2 weeks part-time)

---

### P2 - Nice to Have (If Time) - Week 6

| Task | Effort | Impact |
|------|--------|--------|
| Documentation | 4h | Developer experience |
| Code quality tools | 2h | Consistency |
| Performance optimization | 3h | Speed |

**Total P2**: 9 hours

---

## 🎯 SUCCESS METRICS

### Code Quality Targets

**After Phase 1** (Week 1):
- ✅ No function with duplicate auth logic
- ✅ Consistent error handling across all routes
- ✅ 150+ lines of duplicate code removed

**After Phase 2** (Week 2):
- ✅ All database queries go through repositories
- ✅ Single source of truth for data access
- ✅ 200+ lines of duplicate queries removed

**After Phase 3** (Week 4):
- ✅ No function > 100 lines
- ✅ All business logic in services
- ✅ Routes are thin (< 30 lines average)

**After Phase 4** (Week 5):
- ✅ Test coverage > 80%
- ✅ All services have unit tests
- ✅ All repositories have integration tests

**Final Targets**:
- ✅ No code duplication > 5 lines
- ✅ All functions < 100 lines
- ✅ Test coverage > 85%
- ✅ All public functions documented
- ✅ Consistent code style (linting passes)

---

## 🚀 QUICK START GUIDE

### Week 1: Authentication & Responses

**Day 1-2: Authentication Decorator**
```bash
# Create files
touch app/decorators/__init__.py
touch app/decorators/auth.py

# Implement decorator (use example above)

# Test with one route
# Apply to all routes
```

**Day 3-4: Response Helpers**
```bash
# Create helpers
touch app/utils/response_helpers.py

# Implement (use examples above)

# Update routes
```

**Day 5: Testing & Review**
- Test all updated routes
- Code review
- Commit changes

---

### Week 2: Repositories

**Day 1-2: Create Repositories**
```bash
touch app/repositories/account_repository.py
touch app/repositories/price_repository.py

# Implement methods
```

**Day 3-4: Update Routes to Use Repositories**
- Replace direct queries
- Test each change

**Day 5: Testing**
- Integration tests
- Verify no regressions

---

### Week 3-4: Monster Functions

**Focus**: One function per week
- Week 3: `process_csv_data()`
- Week 4: `get_allocate_portfolio_data()`

**Approach**:
1. Extract one phase/section at a time
2. Write tests for extracted function
3. Update original to call extracted function
4. Test integration
5. Repeat until complete
6. Delete original bloated function

---

## 📝 TRACKING PROGRESS

### Checklist

**Week 1 - Quick Wins**:
- [ ] Create `app/decorators/auth.py`
- [ ] Apply `@require_account` to all routes (31 functions)
- [ ] Create `app/utils/response_helpers.py`
- [ ] Update all error handlers (32+ functions)
- [ ] Update all success responses (50+ functions)
- [ ] Test all changes
- [ ] Commit: "refactor: Add authentication decorator and response helpers"

**Week 2 - Repositories**:
- [ ] Create `AccountRepository`
- [ ] Create `PriceRepository`
- [ ] Expand `PortfolioRepository`
- [ ] Update routes to use repositories
- [ ] Write integration tests
- [ ] Commit: "refactor: Add repositories for data access layer"

**Week 3 - CSV Import**:
- [ ] Extract `parse_csv_columns()`
- [ ] Extract `normalize_transactions()`
- [ ] Extract `accumulate_purchases()`
- [ ] Extract `apply_sales()`
- [ ] Extract `persist_holdings()`
- [ ] Create orchestrator
- [ ] Write unit tests
- [ ] Integration testing
- [ ] Commit: "refactor: Split CSV import into testable modules"

**Week 4 - Allocation Service**:
- [ ] Extract `load_allocation_config()`
- [ ] Extract `calculate_position_weights()`
- [ ] Extract `generate_allocation_structure()`
- [ ] Create API wrapper
- [ ] Write tests
- [ ] Commit: "refactor: Move allocation logic to service layer"

**Week 5 - Testing**:
- [ ] Repository integration tests
- [ ] Route tests
- [ ] Service tests
- [ ] Coverage report
- [ ] Commit: "test: Add comprehensive test coverage"

**Week 6 - Polish**:
- [ ] Documentation updates
- [ ] Code quality tools
- [ ] Performance review
- [ ] Final cleanup
- [ ] Commit: "docs: Update documentation and add quality tools"

---

## 🎓 LESSONS & BEST PRACTICES

### Refactoring Approach

1. **Extract, Don't Rewrite**
   - Extract small pieces
   - Test each extraction
   - Keep original working until replacement is ready

2. **Test First**
   - Write test for extracted function
   - Verify old and new produce same results
   - Only then replace

3. **One Change at a Time**
   - Don't mix refactoring with feature work
   - Each commit should have one clear purpose

4. **Review Often**
   - Code review after each major task
   - Pair programming for complex refactorings
   - Don't let PRs get too large

### Common Pitfalls to Avoid

❌ **Don't**:
- Refactor everything at once
- Change behavior while refactoring
- Skip writing tests
- Mix refactoring commits with feature commits

✅ **Do**:
- Make small, incremental changes
- Keep tests passing at every step
- Write tests for extracted code
- Commit often with clear messages

---

## 📈 EXPECTED OUTCOMES

### Code Metrics Improvement

**Before**:
- Largest function: 625 lines
- Average route function: 80 lines
- Code duplication: ~18 patterns × 5+ instances each
- Test coverage: ~50%

**After**:
- Largest function: < 100 lines
- Average route function: < 30 lines
- Code duplication: < 5 lines
- Test coverage: > 85%

### Developer Experience

**Before**:
- Hard to find where logic lives
- Scary to change large functions
- Difficult to test in isolation
- Inconsistent error handling

**After**:
- Clear layered architecture
- Confident refactoring (tests catch regressions)
- Easy to unit test
- Consistent patterns throughout

### Maintainability

**Before**:
- 6 months to understand codebase
- Fear of touching critical functions
- Bugs hiding in complex logic

**After**:
- 2 weeks to understand codebase
- Confidence in making changes
- Bugs caught by tests

---

## 🏁 SUMMARY

This plan provides a **systematic, prioritized approach** to improving code health over 6 weeks (part-time).

**Total Effort**: ~94 hours (6 weeks × 15 hours/week)

**Key Principles**:
1. **Start with high ROI** (authentication, responses)
2. **Tackle critical complexity** (monster functions)
3. **Build safety nets** (tests)
4. **Maintain quality** (tools, docs)

**End Result**: Production-ready, maintainable, well-tested codebase following the philosophy:
> Simple, Modular, Elegant, Efficient, Robust

---

**Status**: Ready to begin
**Next Step**: Week 1, Task 1.1 - Create Authentication Decorator
**Let's make this code beautiful! 🚀**
