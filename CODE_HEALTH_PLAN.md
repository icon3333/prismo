# Code Health Improvement Plan

**Status**: Planning Phase
**Target**: Phase 3 - Code Consolidation & Quality
**Philosophy**: Simple, Maintainable, Consistent, Tested

## 🎯 Goals

1. **Eliminate Code Duplication** - DRY principle
2. **Improve Test Coverage** - Comprehensive testing
3. **Standardize Error Handling** - Consistent patterns
4. **Enhance Code Documentation** - Clear, useful docs
5. **Refactor Large Functions** - Better modularity
6. **Improve Type Safety** - Complete type hints

---

## 📋 Phase 3: Code Health Tasks

### Week 1: Consolidation & Deduplication

#### Task 1.1: Identify and Consolidate Duplicate Code
**Priority**: HIGH
**Effort**: 3-4 hours

**Areas to consolidate**:
1. **Portfolio data loading** - appears in multiple routes
   - `app/routes/portfolio_routes.py`
   - `app/routes/portfolio_api.py`
   - `app/routes/portfolio_updates.py`

2. **Price update logic** - scattered across utils
   - `app/utils/db_utils.py:update_price_in_db()`
   - `app/utils/db_utils.py:update_batch_prices_in_db()`
   - `app/utils/db_utils.py:update_price_in_db_background()`

3. **ISIN/Identifier normalization** - multiple implementations
   - `app/utils/identifier_normalization.py`
   - `app/utils/yfinance_utils.py`

**Action Items**:
- [ ] Create `app/services/data_loader_service.py` for portfolio loading
- [ ] Consolidate price update logic in `app/services/price_service.py`
- [ ] Merge identifier utilities into single module
- [ ] Update routes to use consolidated services

**Success Criteria**:
- No duplicated logic > 10 lines
- Single source of truth for each operation
- All routes use shared services

---

#### Task 1.2: Extract Common Route Patterns
**Priority**: MEDIUM
**Effort**: 2-3 hours

**Patterns to extract**:
1. **Account validation** - Every route checks `account_id`
2. **Error response formatting** - Inconsistent error returns
3. **Session management** - Repeated session checks

**Action Items**:
- [ ] Create `app/decorators/auth.py` with `@require_account` decorator
- [ ] Create `app/utils/response_helpers.py` for standardized responses
- [ ] Add `@require_session` decorator for session validation

**Example**:
```python
# Before
@portfolio_bp.route('/enrich')
def enrich():
    if 'account_id' not in session:
        flash('Please select an account first', 'warning')
        return redirect(url_for('main.index'))
    account_id = session['account_id']
    # ... route logic

# After
@portfolio_bp.route('/enrich')
@require_account
def enrich():
    account_id = g.account_id
    # ... route logic
```

**Success Criteria**:
- Decorators used in all protected routes
- Consistent error response format
- Session logic centralized

---

### Week 2: Testing & Coverage

#### Task 2.1: Add Integration Tests for Repositories
**Priority**: HIGH
**Effort**: 4-5 hours

**Test Coverage Needed**:
1. **PortfolioRepository** - All CRUD operations
2. **Database transactions** - Rollback scenarios
3. **Query optimization** - Performance tests

**Action Items**:
- [ ] Create `tests/test_repositories.py`
- [ ] Create test database fixture
- [ ] Test all repository methods
- [ ] Add performance benchmarks

**Test Structure**:
```python
tests/
├── test_validation.py          ✅ (Done)
├── test_services.py            ✅ (Done)
├── test_repositories.py        ⏳ (TODO)
├── test_routes.py              ⏳ (TODO)
├── test_integration.py         ⏳ (TODO)
└── conftest.py                 ⏳ (Expand)
```

**Success Criteria**:
- 90%+ coverage for repositories
- All database operations tested
- Edge cases covered

---

#### Task 2.2: Add Route Tests (Flask Test Client)
**Priority**: MEDIUM
**Effort**: 5-6 hours

**Routes to Test**:
1. Portfolio routes (`/portfolio/*`)
2. API endpoints (`/api/*`)
3. Upload functionality
4. Price update endpoints

**Action Items**:
- [ ] Create `tests/test_routes.py`
- [ ] Set up Flask test client fixture
- [ ] Test happy paths
- [ ] Test error cases
- [ ] Test authentication/authorization

**Success Criteria**:
- All routes have at least 1 test
- Authentication tested
- Error handling verified

---

#### Task 2.3: Add Cache Testing
**Priority**: LOW
**Effort**: 2 hours

**Action Items**:
- [ ] Create `tests/test_caching.py`
- [ ] Test cache hit/miss behavior
- [ ] Test cache invalidation
- [ ] Verify timeout behavior

---

### Week 3: Refactoring Large Functions

#### Task 3.1: Refactor Large Route Functions
**Priority**: MEDIUM
**Effort**: 3-4 hours

**Large functions to refactor** (> 100 lines):
1. `app/routes/portfolio_api.py:_apply_company_update()` (~236 lines)
2. `app/routes/portfolio_api.py:get_allocate_portfolio_data()` (~257 lines)
3. `app/routes/portfolio_api.py:upload_csv()` (~96 lines)
4. `app/utils/batch_processing.py:_run_csv_job()` (~96 lines)

**Strategy**:
- Extract business logic to services
- Keep routes thin (< 30 lines)
- Use repository layer for data access

**Example Refactor**:
```python
# Before: Large route function with business logic
@portfolio_bp.route('/allocate/data')
def get_allocate_portfolio_data():
    # 257 lines of mixed concerns
    account_id = session['account_id']
    # ... data loading
    # ... calculations
    # ... formatting
    return jsonify(result)

# After: Thin route using services
@portfolio_bp.route('/allocate/data')
@require_account
def get_allocate_portfolio_data():
    account_id = g.account_id

    # Load data via repository
    holdings = PortfolioRepository.get_all_holdings(account_id)

    # Calculate via service
    allocations = AllocationService().calculate_allocations(holdings)

    # Format and return
    return jsonify({'allocations': allocations})
```

**Action Items**:
- [ ] Extract business logic from routes to services
- [ ] Use PortfolioRepository for data access
- [ ] Keep routes under 30 lines
- [ ] Add type hints to all functions

**Success Criteria**:
- No route function > 50 lines
- Business logic in services
- Routes only handle HTTP concerns

---

#### Task 3.2: Split Large Utility Files
**Priority**: LOW
**Effort**: 2-3 hours

**Files to split**:
1. `app/utils/yfinance_utils.py` (275 lines)
   - Split into: `price_fetcher.py`, `exchange_rates.py`, `identifier_utils.py`

2. `app/utils/portfolio_utils.py` (if large)
   - Review and split if needed

**Action Items**:
- [ ] Analyze file responsibilities
- [ ] Split into focused modules
- [ ] Update imports across codebase
- [ ] Verify no broken imports

---

### Week 4: Error Handling & Documentation

#### Task 4.1: Standardize Error Handling
**Priority**: MEDIUM
**Effort**: 3 hours

**Current Issues**:
- Inconsistent error responses
- Mix of flash messages and JSON errors
- Some errors silently logged

**Action Items**:
- [ ] Create `app/exceptions.py` (already exists, expand it)
- [ ] Define custom exception hierarchy
- [ ] Add global error handlers
- [ ] Standardize API error responses

**Exception Hierarchy**:
```python
# app/exceptions.py (expand existing)
class PortfolioError(Exception):
    """Base exception for portfolio operations"""
    pass

class ValidationError(PortfolioError):
    """Invalid input data"""
    pass

class DataNotFoundError(PortfolioError):
    """Requested data not found"""
    pass

class PriceFetchError(PortfolioError):  # Already exists
    """Error fetching price data"""
    pass

class DatabaseError(PortfolioError):  # Already exists
    """Database operation failed"""
    pass
```

**Error Handler**:
```python
# app/main.py
@app.errorhandler(ValidationError)
def handle_validation_error(e):
    return jsonify({'error': str(e), 'type': 'validation'}), 400

@app.errorhandler(DataNotFoundError)
def handle_not_found(e):
    return jsonify({'error': str(e), 'type': 'not_found'}), 404
```

**Success Criteria**:
- All exceptions inherit from base class
- Consistent error response format
- Proper HTTP status codes

---

#### Task 4.2: Improve Code Documentation
**Priority**: LOW
**Effort**: 2-3 hours

**Action Items**:
- [ ] Add module-level docstrings to all files
- [ ] Document complex algorithms
- [ ] Add type hints to all functions
- [ ] Create API documentation (optional: use Sphinx)

**Documentation Standards**:
```python
def calculate_rebalancing(
    portfolio_data: List[Dict],
    target_allocations: Dict[str, float],
    investment_amount: Decimal
) -> List[RebalancingRecommendation]:
    """
    Calculate rebalancing recommendations.

    Given current portfolio holdings and target allocations, calculates
    how to distribute a new investment to move toward target weights.

    Args:
        portfolio_data: List of current holdings with prices
        target_allocations: Desired allocation percentages (0-100)
        investment_amount: Amount to invest in base currency

    Returns:
        List of recommendations, one per holding

    Raises:
        ValidationError: If allocations don't sum to 100%

    Example:
        >>> holdings = [{'id': 1, 'name': 'AAPL', 'price': 150}]
        >>> targets = {1: 100.0}
        >>> calculate_rebalancing(holdings, targets, Decimal('1000'))
        [RebalancingRecommendation(...)]
    """
```

**Success Criteria**:
- All public functions documented
- Complex logic explained
- Examples provided for key functions

---

### Week 5: Performance & Optimization

#### Task 5.1: Database Query Optimization
**Priority**: MEDIUM
**Effort**: 3 hours

**Action Items**:
- [ ] Review all database queries
- [ ] Add indexes where needed
- [ ] Convert N+1 queries to JOINs
- [ ] Add query performance logging

**Queries to Optimize**:
1. Portfolio loading - use single JOIN query
2. Price updates - batch updates
3. Allocation calculations - avoid redundant queries

**Success Criteria**:
- No N+1 query patterns
- All frequent queries indexed
- Query times logged for monitoring

---

#### Task 5.2: Add Performance Monitoring
**Priority**: LOW
**Effort**: 2 hours

**Action Items**:
- [ ] Add timing decorators for slow operations
- [ ] Log API response times
- [ ] Track cache hit/miss rates
- [ ] Monitor batch job performance

**Example**:
```python
@timeit
@cache.memoize(timeout=900)
def get_isin_data(identifier: str):
    # ... implementation
```

---

### Week 6: Code Quality Tools

#### Task 6.1: Add Linting & Formatting
**Priority**: LOW
**Effort**: 2 hours

**Action Items**:
- [ ] Set up `ruff` for linting
- [ ] Set up `black` for formatting
- [ ] Add `mypy` for type checking
- [ ] Create pre-commit hooks

**Configuration Files**:
```toml
# pyproject.toml
[tool.black]
line-length = 100
target-version = ['py39']

[tool.ruff]
line-length = 100
select = ["E", "F", "I", "N", "W"]

[tool.mypy]
python_version = "3.9"
warn_return_any = true
warn_unused_configs = true
```

**Success Criteria**:
- All code passes linting
- Consistent formatting
- Type checking passes

---

#### Task 6.2: Add Code Quality Badges
**Priority**: LOW
**Effort**: 1 hour

**Action Items**:
- [ ] Set up test coverage reporting
- [ ] Add coverage badge to README
- [ ] Document code quality metrics

---

## 📊 Priority Matrix

### High Priority (Do First)
1. ✅ Consolidate duplicate code
2. ✅ Add integration tests for repositories
3. ✅ Refactor large route functions
4. ✅ Standardize error handling

### Medium Priority (Do Next)
1. Extract common route patterns
2. Add route tests
3. Database query optimization
4. Refactor large functions

### Low Priority (Nice to Have)
1. Split large utility files
2. Improve documentation
3. Add performance monitoring
4. Linting & formatting tools
5. Cache testing

---

## 🎯 Success Metrics

### Code Quality
- [ ] No function > 50 lines
- [ ] No file > 500 lines
- [ ] No code duplication > 10 lines
- [ ] All functions have type hints
- [ ] All public functions documented

### Test Coverage
- [ ] Services: 90%+
- [ ] Repositories: 90%+
- [ ] Routes: 70%+
- [ ] Overall: 80%+

### Performance
- [ ] API calls reduced by 50-90% (caching)
- [ ] No N+1 query patterns
- [ ] All queries < 100ms
- [ ] Page load < 500ms

### Maintainability
- [ ] Clear module boundaries
- [ ] Consistent error handling
- [ ] Comprehensive tests
- [ ] Up-to-date documentation

---

## 🛠️ Tools & Dependencies

### Testing
- `pytest` ✅ (installed)
- `pytest-cov` ✅ (installed)
- `pytest-flask` ✅ (installed)
- `pytest-mock` (add if needed)

### Code Quality
- `black` - code formatting
- `ruff` - fast linting
- `mypy` - type checking
- `pre-commit` - git hooks

### Documentation
- `sphinx` (optional) - API docs
- `sphinx-autodoc` - auto-generate docs

---

## 📅 Timeline

**Phase 3 Total Estimate**: 4-6 weeks (part-time)

### Week 1: Foundation
- Consolidate duplicate code
- Extract common patterns

### Week 2: Testing
- Integration tests
- Route tests

### Week 3: Refactoring
- Split large functions
- Improve structure

### Week 4: Quality
- Error handling
- Documentation

### Week 5: Performance
- Query optimization
- Monitoring

### Week 6: Polish
- Linting/formatting
- Final cleanup

---

## 🚀 Quick Wins (Can Do Now)

### Immediate Improvements (< 1 hour each)
1. **Add type hints to existing functions without them**
2. **Fix the 2 failing tests** ✅ (in progress)
3. **Add `@require_account` decorator to routes**
4. **Create standardized error response helper**
5. **Add logging to key operations**

### Fast Refactors (1-2 hours)
1. **Extract account validation to decorator**
2. **Consolidate price update functions**
3. **Create response helpers module**
4. **Add performance timing decorator**

---

## 📝 Notes

### Design Principles to Follow
1. **SOLID Principles**
   - Single Responsibility
   - Open/Closed
   - Liskov Substitution
   - Interface Segregation
   - Dependency Inversion

2. **Clean Code**
   - Functions do one thing
   - Clear naming
   - Minimal nesting
   - Early returns

3. **Testing Strategy**
   - Unit tests for services
   - Integration tests for repositories
   - End-to-end tests for critical flows

### Anti-Patterns to Avoid
- ❌ God objects/functions
- ❌ Tight coupling
- ❌ Hidden dependencies
- ❌ Premature optimization
- ❌ Over-engineering

### Philosophy
> "Simplicity is the ultimate sophistication"
> - Keep it Simple, Modular, Elegant, Efficient, Robust

---

## 🔄 Maintenance Plan

### Regular Tasks
- **Weekly**: Review test coverage
- **Biweekly**: Check for code duplication
- **Monthly**: Performance review
- **Quarterly**: Dependency updates

### Code Review Checklist
- [ ] Type hints present
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No code duplication
- [ ] Follows project conventions
- [ ] Performance considered

---

**Status**: Ready to begin
**Next Step**: Fix failing tests, then start Week 1 tasks
**Philosophy**: Simple, Maintainable, Consistent, Tested
