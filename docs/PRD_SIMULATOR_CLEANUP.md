# PRD: Simulator Section Design System Alignment

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Created**: 2026-01-18
- **Related Files**:
  - `static/css/allocate.css` (lines 1740-3173)
  - `static/js/simulator.js`
  - `templates/pages/allocate.html`
  - `docs/DESIGN_SYSTEM.md`

---

## 1. Executive Summary

The Simulator section has grown organically with multiple feature additions, resulting in visual inconsistencies and deviation from the established "Ocean Depth" design system. This PRD documents all identified inconsistencies and provides a systematic cleanup plan to create visual harmony across the entire component.

### Primary Goals
1. Align all simulator components with `DESIGN_SYSTEM.md` specifications
2. Eliminate hardcoded values in favor of CSS variables
3. Standardize component patterns across all simulator elements
4. Improve visual cohesion and reduce CSS bloat

---

## 2. Current State Analysis

### 2.1 Files Involved

| File | Lines | Purpose |
|------|-------|---------|
| `allocate.css` | 1740-3173 (~1,430 lines) | Simulator-specific styles |
| `simulator.js` | 1,705 lines | Simulator logic with inline class applications |
| `allocate.html` | 115-178 | Simulator HTML structure |
| `ocean-depth.css` | Full file | Design system variables |

### 2.2 Component Inventory

The simulator consists of these visual components:
1. **Header Bar** - Load/Save/Delete controls
2. **Scope Toggle** - Global/Portfolio radio buttons
3. **Input Forms** - Ticker/Category/Country add forms (3-column grid)
4. **Positions Table** - Editable table with simulated positions
5. **Chart Panels** - Country and Category allocation bar charts
6. **Position Details** - Expandable position lists within charts
7. **Modal** - Save simulation dialog
8. **Toast Notifications** - Success/error feedback
9. **Combobox Dropdowns** - Searchable category/country selectors
10. **Value Mode Toggle** - Euro/Percent switch

---

## 3. Design System Violations

### 3.1 CRITICAL: Box Shadow Violations

**Design System Rule**: "This design uses NO BOX SHADOWS. All depth is conveyed through background color layering."

| Component | Current Code | Violation |
|-----------|--------------|-----------|
| Toast | `box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3)` | Uses shadow |
| Combobox Dropdown | `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)` | Uses shadow |
| Editable Cell Focus | `box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.2)` | Uses ring shadow |
| Portfolio Select Focus | `box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.2)` | Uses ring shadow |

**Recommended Fix**:
- Remove all `box-shadow` properties
- Replace with `border` changes for focus states: `border-color: var(--primary)`
- For elevated components (dropdowns, toasts), use layered backgrounds with subtle borders

### 3.2 Font Family Inconsistencies

**Design System Specification**:
```css
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

**Violations Found**:

| Location | Current | Should Be |
|----------|---------|-----------|
| `.ticker-badge` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.value-input-wrapper .value-input` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.bar-percentage` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.position-details-total` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.position-detail-ticker` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.position-detail-value` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.position-detail-percent` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |
| `.combobox-option-percent` | `'SF Mono', 'Monaco', 'Inconsolata', monospace` | `var(--font-mono)` |

**Recommended Fix**: Global find-replace of the hardcoded font stack with `var(--font-mono)`.

### 3.3 Border Variable Inconsistencies

**Design System Variables**:
```css
--border-subtle: rgba(255, 255, 255, 0.08);
--border-default: rgba(255, 255, 255, 0.15);
--border-strong: rgba(255, 255, 255, 0.3);
--border-color: var(--border-default);  /* Alias */
```

**Inconsistent Usage Found**:

| Class | Current | Issue |
|-------|---------|-------|
| `.simulator-header-bar` | `--border-color` | OK (alias) |
| `.simulator-btn-secondary` | `--border-default` | OK |
| `.simulator-table-wrapper` | `--border-color` | OK |
| `.chart-bar-item + .chart-bar-item` | `--border-color` | OK |
| `.position-detail-row` | `rgba(6, 182, 212, 0.1)` | **Hardcoded** - should use variable |

**Recommendation**: Standardize on `--border-default` for standard borders, `--border-subtle` for internal dividers, and create a new variable `--border-primary-subtle` for the aqua-tinted borders.

### 3.4 Hardcoded Color Values

**Violations** (should use CSS variables):

| Location | Hardcoded Value | Should Be |
|----------|-----------------|-----------|
| `.simulator-table tbody tr:hover` | `rgba(6, 182, 212, 0.05)` | `var(--primary-light)` with adjusted opacity |
| `.slider-item` | `rgba(6, 182, 212, 0.05)` | `var(--primary-light)` variant |
| `.chart-bar-expanded` | `rgba(6, 182, 212, 0.08)` | Variable needed |
| `.combobox-option:hover` | `rgba(6, 182, 212, 0.1)` | `var(--primary-light)` |
| `.combobox-toggle:hover` | `rgba(6, 182, 212, 0.1)` | `var(--primary-light)` |
| `.value-mode-toggle.mode-percent` | `rgba(6, 182, 212, 0.15)` | `var(--primary-light)` |
| `.position-simulated` | `rgba(6, 182, 212, 0.08) !important` | Variable needed |
| `.simulated-badge` | `rgba(6, 182, 212, 0.15)` | `var(--primary-light)` |
| `.simulated-badge border` | `rgba(6, 182, 212, 0.3)` | `var(--info-border-light)` |
| `.position-detail-row border` | `rgba(6, 182, 212, 0.1)` | Variable needed |

**Recommendation**: Create additional opacity variants in `ocean-depth.css`:
```css
--primary-light-subtle: rgba(6, 182, 212, 0.05);  /* Very subtle */
--primary-light-medium: rgba(6, 182, 212, 0.08);  /* Medium subtle */
--primary-light: rgba(6, 182, 212, 0.15);         /* Standard (exists) */
```

### 3.5 Spacing Inconsistencies

**Design System Spacing Scale**:
```css
--space-xs: 0.25rem;  /* 4px */
--space-sm: 0.5rem;   /* 8px */
--space-md: 1rem;     /* 16px */
--space-lg: 1.5rem;   /* 24px */
--space-xl: 2rem;     /* 32px */
```

**Violations Found**:

| Location | Current | Issue |
|----------|---------|-------|
| `.existing-badge gap` | `4px` | Should be `var(--space-xs)` |
| `.existing-badge padding` | `2px 6px` | Non-standard - should be `var(--space-xs) var(--space-sm)` |
| `.simulated-badge gap` | `4px` | Should be `var(--space-xs)` |
| `.simulated-badge padding` | `2px 8px` | Non-standard |
| `.ticker-badge padding` | `4px 10px` | Non-standard - close to `var(--space-xs) var(--space-sm)` |
| `.combobox-dropdown margin-top` | `4px` | Should be `var(--space-xs)` |

**Recommendation**: Audit all pixel values and convert to spacing variables. For 2px padding, consider creating `--space-2xs: 0.125rem` or accept slight variance.

### 3.6 Font Size Inconsistencies

**Design System Type Scale**:
```
Page Title:   1.5rem / 700
Section:      1.25rem / 600
Card Title:   1rem / 600
Body:         0.875rem (14px) / 400-500
Small/Meta:   0.75rem (12px) / 400-500
Large Value:  1.5rem / 600
```

**Inconsistent Sizes Found**:

| Element | Current Size | Expected | Issue |
|---------|--------------|----------|-------|
| `.chart-title` | `0.9rem` | `1rem` (card title) | Off-scale |
| `.chart-title i` | `0.85rem` | Match parent | Unnecessary override |
| `.bar-label` | `0.85rem` | `0.875rem` (body) | Off-scale |
| `.bar-percentage` | `0.85rem` | `0.875rem` (body) | Off-scale |
| `.chart-empty` | `0.85rem` | `0.875rem` (body) | Off-scale |
| `.name-display` | `0.9rem` | `0.875rem` (body) | Off-scale |
| `.editable-cell` | `0.9rem` | `0.875rem` (body) | Off-scale |
| `.combobox-option-name` | `0.9rem` | `0.875rem` (body) | Off-scale |
| `.col-value-hint` | `0.7rem` | `0.75rem` (small) | Off-scale |
| `.simulated-badge` | `0.7rem` | `0.75rem` (small) | Off-scale |
| `.existing-badge` | `0.7rem` | `0.75rem` (small) | Off-scale |
| `.position-detail-percent-glob` | `0.7rem` | `0.75rem` (small) | Off-scale |
| `.combobox-toggle i` | `0.7rem` | `0.75rem` (small) | Off-scale |
| `.bar-expand-icon` | `0.6rem` | `0.75rem` (small) | Too small |
| `.existing-badge i` | `0.6rem` | `0.75rem` (small) | Too small |

**Recommendation**: Normalize all font sizes to the type scale. Create CSS variables for font sizes:
```css
--font-size-xs: 0.75rem;   /* 12px */
--font-size-sm: 0.875rem;  /* 14px */
--font-size-md: 1rem;      /* 16px */
--font-size-lg: 1.25rem;   /* 20px */
--font-size-xl: 1.5rem;    /* 24px */
```

### 3.7 Button Pattern Duplication

**Current Button Classes in Simulator**:

1. `.simulator-btn-primary` - Custom primary button
2. `.simulator-btn-secondary` - Custom secondary button
3. `.btn-primary` - Bootstrap/Bulma primary
4. `.btn-secondary` - Bootstrap/Bulma secondary
5. `.btn-outline-primary` - Outlined primary
6. `.btn-outline-secondary` - Outlined secondary
7. `.btn-outline-danger` - Outlined danger
8. `.btn-delete` - Icon-only delete button
9. `.modal-close` - Modal close button

**Issues**:
- Duplicate definitions for similar buttons
- Inconsistent padding across button types
- Mix of class naming conventions

**Recommendation**: Consolidate to a single button system following design system patterns:
```css
.btn { /* Base button styles */ }
.btn-primary { /* Primary action */ }
.btn-secondary { /* Secondary action */ }
.btn-ghost { /* Text/icon only */ }
.btn-danger { /* Destructive action */ }
.btn-sm { /* Compact size */ }
.btn-icon { /* Icon-only button */ }
```

### 3.8 Modal Pattern Duplication

**Design System Modal** (from `DESIGN_SYSTEM.md`):
```html
<div class="modal">
  <div class="modal-background"></div>
  <div class="modal-card">
    <header class="modal-card-head">...</header>
    <section class="modal-card-body">...</section>
    <footer class="modal-card-foot">...</footer>
  </div>
</div>
```

**Simulator Modal** (current):
```html
<div class="modal-overlay">
  <div class="modal-content">
    <div class="modal-header">...</div>
    <div class="modal-body">...</div>
    <div class="modal-footer">...</div>
  </div>
</div>
```

**Issues**:
- Different class naming convention
- Different structure hierarchy
- Separate CSS definitions duplicating the design system patterns

**Recommendation**: Migrate to design system modal pattern or create a documented exception with proper aliasing.

---

## 4. Component-Specific Issues

### 4.1 Scope Toggle

**Current Issues**:
- Radio button text uses custom `.scope-option-text` class
- Checked state uses `background: var(--primary)` which is correct
- Hover states conflict with checked states

**Recommended Improvements**:
```css
/* Simplify to use design system button pill pattern */
.scope-toggle { /* Container */ }
.scope-option { /* Individual toggle */ }
.scope-option.is-active { /* Active state */ }
```

### 4.2 Chart Bar Items

**Current Issues**:
- Uses grid layout with fixed column widths
- Expand icon uses non-standard sizing (`0.6rem`)
- Border-left for expanded state doesn't follow design patterns

**Visual Inconsistencies**:
- Bar labels truncate differently across panels
- Progress bar height varies (20px in charts vs 8px in design system)
- Hover states use different opacity levels

**Recommended Improvements**:
- Standardize bar height to `8px` per design system
- Use consistent hover background (`--primary-light`)
- Align expand/collapse icons with standard icon sizing

### 4.3 Position Details Panel

**Current Issues**:
- Custom animation `@keyframes slideDown` could use design system transition
- Multi-level percentage colors are well-designed but lack documentation
- Grid column widths are hardcoded pixel values

**Recommended Improvements**:
- Use `--transition-smooth` for animations
- Document percentage hierarchy in design system
- Convert pixel widths to relative units or CSS variables

### 4.4 Combobox Dropdown

**Current Issues**:
- Shadow violation (mentioned above)
- Animation duplicates dropdown pattern
- Z-index (100) may conflict with other components

**Recommended Improvements**:
- Remove shadow, add `border: 1px solid var(--border-strong)`
- Use design system dropdown animation
- Document z-index hierarchy

### 4.5 Toast Notifications

**Current Issues**:
- Shadow violation
- Fixed positioning may conflict with other toasts
- No stacking behavior defined

**Recommended Improvements**:
- Remove shadow, increase border width or use `--border-strong`
- Consider using design system alert pattern instead
- Add proper toast queue management in JS

---

## 5. JavaScript-Generated Styles

The `simulator.js` file generates HTML with inline classes. These need review:

### 5.1 Dynamic Class Applications

| JS Method | Classes Applied | Issue |
|-----------|-----------------|-------|
| `renderTable()` | `.simulator-table`, `.ticker-badge` | OK |
| `renderCharts()` | `.chart-bar-item`, `.bar-label`, etc. | OK |
| `renderPositionDetails()` | `.position-detail-row`, percentage classes | OK |
| `showToast()` | `.simulator-toast-*` | Shadow issue |

### 5.2 Inline Styles in JS

Search for any inline `style=` attributes that override CSS:
- Value input widths
- Position detail grid columns
- Animation transforms

**Recommendation**: Move all inline styles to CSS classes where possible.

---

## 6. Responsive Design Issues

### 6.1 Breakpoint Alignment

**Design System Breakpoints**:
```css
@media (max-width: 992px) { /* Tablet */ }
@media (max-width: 576px) { /* Mobile */ }
```

**Simulator Breakpoints Used**:
- `992px` - OK
- `768px` - Non-standard (between tablet and mobile)
- `576px` - OK

**Recommendation**: Consolidate `768px` queries into either `992px` or `576px`.

### 6.2 Mobile Usability

**Issues**:
- 3-column input forms stack to 1 column but may still be cramped
- Chart bars may be too small to tap on mobile
- Combobox dropdown max-height changes at breakpoints

**Recommendations**:
- Test touch target sizes (minimum 44x44px)
- Consider bottom sheet pattern for mobile dropdowns
- Increase bar interaction area on touch devices

---

## 7. Implementation Plan

### Phase 1: Variable Normalization (Low Risk)
**Estimated Effort**: 2-3 hours

1. Replace all hardcoded font-family with `var(--font-mono)`
2. Replace hardcoded rgba colors with CSS variables
3. Normalize font sizes to type scale
4. Convert pixel spacing to spacing variables

### Phase 2: Shadow Removal (Medium Risk)
**Estimated Effort**: 1-2 hours

1. Remove box-shadow from toast notifications
2. Remove box-shadow from combobox dropdown
3. Replace focus ring shadows with border changes
4. Test visual hierarchy without shadows

### Phase 3: Component Consolidation (Medium Risk)
**Estimated Effort**: 3-4 hours

1. Consolidate button classes
2. Align modal structure with design system
3. Standardize chart bar heights
4. Unify hover/active states

### Phase 4: Responsive Cleanup (Low Risk)
**Estimated Effort**: 1-2 hours

1. Consolidate breakpoints
2. Test mobile touch targets
3. Verify dropdown behavior on mobile

### Phase 5: Documentation Update
**Estimated Effort**: 1 hour

1. Update DESIGN_SYSTEM.md with simulator-specific patterns
2. Document percentage hierarchy system
3. Add component examples to design system

---

## 8. Testing Checklist

### Visual Regression Testing

- [ ] Screenshot all simulator states before changes
- [ ] Compare after each phase
- [ ] Test in both light and dark modes
- [ ] Test at all breakpoints (desktop, tablet, mobile)

### Functional Testing

- [ ] Add ticker form works
- [ ] Add category/country forms work
- [ ] Table editing works (all cells)
- [ ] Value mode toggle works
- [ ] Chart bar expansion works
- [ ] Position details render correctly
- [ ] Save/Load/Delete simulations work
- [ ] Scope toggle works
- [ ] Toast notifications appear correctly
- [ ] Modal opens/closes correctly

### Accessibility Testing

- [ ] Focus states visible without shadows
- [ ] Touch targets meet 44px minimum
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader announces changes

---

## 9. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Hardcoded color values | ~25 | 0 |
| Non-standard font sizes | ~15 | 0 |
| Box shadow usages | 4 | 0 |
| Hardcoded font-family | ~8 | 0 |
| CSS lines in simulator section | ~1,430 | <1,200 |
| Duplicate button definitions | 9 | 4-5 |

---

## 10. Appendix: Quick Reference

### A. Color Variables to Use

```css
/* Backgrounds */
--bg-primary, --bg-secondary, --bg-tertiary

/* Text */
--text-primary, --text-secondary, --text-muted

/* Accents */
--primary, --primary-hover, --success, --warning, --danger

/* Borders */
--border-subtle, --border-default, --border-strong

/* State overlays */
--primary-light, --danger-light, --warning-light, --success-light
```

### B. Spacing Variables to Use

```css
--space-xs: 0.25rem;  /* 4px - tight padding */
--space-sm: 0.5rem;   /* 8px - standard padding */
--space-md: 1rem;     /* 16px - card padding */
--space-lg: 1.5rem;   /* 24px - section gaps */
--space-xl: 2rem;     /* 32px - large gaps */
```

### C. Font Size Variables to Use

```css
0.75rem   /* 12px - small, meta */
0.875rem  /* 14px - body */
1rem      /* 16px - card title */
1.25rem   /* 20px - section title */
1.5rem    /* 24px - page title */
```

---

*Document Version 1.0 - Ready for Implementation Review*
