# Product Requirements Document: Anonymous Mode

## Executive Summary

### Problem Statement
Users need to share their screen or demonstrate the portfolio management application to others (colleagues, family, financial advisors, or during screen recordings) without revealing sensitive financial information. Currently, all monetary values are fully visible, making screen sharing uncomfortable and potentially risky from a privacy perspective.

### Solution Overview
Introduce an "Anonymous Mode" toggle that applies CSS blur effects to all absolute monetary values while preserving the analytical utility of the application through percentages, allocations, and relative metrics. This UI-only feature allows users to quickly hide sensitive data with a single click, making the application safe for demonstrations, screenshots, and screen sharing.

### Success Criteria
- Users can toggle anonymous mode in <2 seconds from any page
- All absolute monetary values are immediately obscured when enabled
- Percentage-based analytics remain fully functional and visible
- Zero impact on application performance or existing functionality
- Toggle state persists across page navigation within the same browser session

---

## User Stories & Personas

### Primary Persona: Privacy-Conscious Investor
**Background**: Home investor managing personal portfolio, occasionally needs to share screen with financial advisor or create tutorial content.

**User Stories**:

1. **As a user sharing my screen**, I want to quickly hide all monetary values so that I can demonstrate portfolio allocation strategies without revealing my actual wealth.

2. **As a user creating screenshots**, I want to blur financial amounts so that I can share portfolio analysis on social media or forums without privacy concerns.

3. **As a user showing the app to family**, I want to hide specific dollar amounts so that I can teach investment concepts without revealing exact position sizes.

4. **As a user recording tutorials**, I want anonymous mode to persist across pages so that I don't accidentally reveal values while navigating during recording.

5. **As a privacy-focused user**, I want anonymous mode to reset when I close my browser so that the default state is always "values visible" for my normal usage.

---

## Functional Requirements

### FR-1: Toggle Control

**FR-1.1 Toggle Button Placement**
- Location: Top right navigation bar, immediately left of the existing dark/light mode toggle
- Visual hierarchy: Same size and prominence as theme toggle
- Spacing: 8px gap between anonymous mode toggle and theme toggle (consistent with design system)

**FR-1.2 Toggle Icon**
- Default state (values visible): Outlined eye icon with slash through it (`eye-off` or similar)
- Active state (anonymous mode ON): Filled incognito/spy icon (like Chrome incognito icon)
- Color: Follows existing button styling (aqua #06B6D4 accent on hover/active)
- Accessibility: `aria-label="Toggle anonymous mode"` with `aria-pressed` state

**FR-1.3 Toggle Behavior**
- Single click toggles between states
- Immediate visual feedback (icon change)
- No loading state or confirmation dialog
- No toast notification (silent operation)
- State change applies instantly across current page

### FR-2: Value Obfuscation

**FR-2.1 Sensitive Values to Hide**

The following elements must be blurred when anonymous mode is enabled:

1. **Currency amounts** (any text matching pattern `€X,XXX.XX` or `€X.XX`)
2. **Share counts** (text like "15 shares", "0.5 shares")
3. **Total portfolio value** (sidebar and dashboard)
4. **Position-level values**:
   - Current value
   - Total invested
   - Custom values (from Enrich page)
   - P&L absolute amounts
5. **Aggregate totals**:
   - Portfolio total value
   - Total invested across portfolio
   - Total P&L (absolute)
6. **Table cell values** containing any of the above
7. **Hover tooltips** that display absolute monetary amounts
8. **Input field values** showing monetary amounts (on Enrich page custom value inputs)

**FR-2.2 Values to Keep Visible**

The following must remain clearly visible:

1. **All percentages**: allocation %, P&L %, country breakdown %
2. **Position identifiers**: Company names, ticker symbols, ISINs
3. **Categorical data**: Investment type (Stock/ETF), country, sector
4. **Charts and visualizations**: All Apex charts (they use percentages)
5. **UI labels and headers**: "Total Value", "P&L", etc. (just not the amounts)
6. **Non-financial counts**: Number of positions (e.g., "12 positions")

**FR-2.3 Visual Treatment**

- **Blur intensity**: `filter: blur(8px)` on sensitive elements
- **CSS class approach**: Add `.sensitive-value` class to sensitive elements
- **Body class**: Add `.anonymous-mode` class to `<body>` when active
- **Selection prevention**: `user-select: none` on blurred elements (prevent copy-paste)
- **Consistent blur**: Same blur intensity across all pages for visual consistency

### FR-3: Persistence & State Management

**FR-3.1 Session Persistence**
- Toggle state stored in `sessionStorage` (key: `anonymousModeEnabled`)
- State persists across page navigation within same browser tab
- State isolated per browser tab (each tab has independent toggle)

**FR-3.2 Default Behavior**
- Default state on fresh browser session: Anonymous mode OFF (values visible)
- Rationale: Safer default for primary use case (solo portfolio management)
- User explicitly opts into hiding values when needed

**FR-3.3 Session Expiry**
- State resets when browser tab closes
- State resets when browser application closes
- No localStorage or cookie persistence (intentional security feature)

### FR-4: Page-Specific Implementation

**FR-4.1 Index Page (Dashboard)**
- Blur portfolio summary card values
- Blur "Total Value" display
- Keep allocation breakdown percentages visible
- Blur sidebar portfolio value

**FR-4.2 Analyse Page**
- Blur all currency columns in positions table:
  - Current Value
  - Total Invested
  - P&L (Absolute)
- Blur share count column
- Keep P&L % column visible
- Keep allocation % column visible
- Blur total row values

**FR-4.3 Build Page**
- Blur "Current Value" column
- Blur "Desired Value" input field values (but keep input editable)
- Blur "Difference" column amounts
- Keep allocation percentages visible
- Keep position counts visible (number of positions, not share counts)

**FR-4.4 Allocate Page**
- Blur all currency amounts in allocation suggestions
- Blur "Amount to Invest" input value
- Keep allocation target percentages visible
- Keep position names/tickers visible

**FR-4.5 Enrich Page**
- Blur existing market values
- Blur custom value input fields
- Blur share counts
- Keep position identifiers visible
- Keep "Last Updated" timestamps visible

**FR-4.6 Risk Overview Page**
- Blur any absolute value metrics if present
- Keep percentage-based risk metrics visible
- Keep country/sector breakdowns (as %) visible

**FR-4.7 Account Page**
- Blur portfolio values in portfolio selection dropdown
- Keep portfolio names visible

**FR-4.8 Sidebar (All Pages)**
- Blur portfolio total value display
- Keep portfolio name visible
- Keep navigation items visible

---

## Technical Requirements

### TR-1: Frontend Architecture

**TR-1.1 HTML Markup Strategy**

Add semantic classes to all sensitive value elements during template rendering:

```html
<!-- Example: Analyse page table -->
<td class="sensitive-value currency-value">€12,345.67</td>
<td class="sensitive-value share-count">15 shares</td>
<td class="allocation-percentage">25.5%</td> <!-- No sensitive class -->
```

**TR-1.2 CSS Implementation**

Create new stylesheet `static/css/anonymous-mode.css`:

```css
/* Anonymous mode styles */
body.anonymous-mode .sensitive-value {
    filter: blur(8px);
    user-select: none;
    cursor: default;
    transition: filter 0.2s ease-in-out;
}

/* Prevent tooltip display on blurred values */
body.anonymous-mode .sensitive-value[title]:hover::after {
    display: none;
}

/* Special handling for input fields */
body.anonymous-mode input.sensitive-value {
    filter: blur(8px);
    pointer-events: auto; /* Still allow interaction */
}

/* Toggle button styles */
.anonymous-mode-toggle {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
}

.anonymous-mode-toggle:hover {
    background: var(--color-hover);
    border-color: var(--color-aqua);
}

.anonymous-mode-toggle.active {
    background: var(--color-aqua);
    border-color: var(--color-aqua);
}

.anonymous-mode-toggle svg {
    width: 20px;
    height: 20px;
    stroke: currentColor;
}
```

**TR-1.3 JavaScript Implementation**

Create new module `static/js/anonymous-mode.js`:

```javascript
/**
 * Anonymous Mode Toggle
 * Manages visibility of sensitive financial values
 */

class AnonymousModeManager {
    constructor() {
        this.storageKey = 'anonymousModeEnabled';
        this.toggleButton = null;
        this.isEnabled = false;

        this.init();
    }

    init() {
        // Restore state from sessionStorage
        this.isEnabled = sessionStorage.getItem(this.storageKey) === 'true';

        // Apply state immediately (before DOM ready)
        if (this.isEnabled) {
            document.body.classList.add('anonymous-mode');
        }

        // Setup toggle button when DOM ready
        document.addEventListener('DOMContentLoaded', () => {
            this.setupToggleButton();
            this.updateToggleButton();
        });
    }

    setupToggleButton() {
        this.toggleButton = document.getElementById('anonymous-mode-toggle');
        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => this.toggle());
        }
    }

    toggle() {
        this.isEnabled = !this.isEnabled;
        sessionStorage.setItem(this.storageKey, this.isEnabled.toString());

        if (this.isEnabled) {
            document.body.classList.add('anonymous-mode');
        } else {
            document.body.classList.remove('anonymous-mode');
        }

        this.updateToggleButton();
    }

    updateToggleButton() {
        if (!this.toggleButton) return;

        // Update aria-pressed state
        this.toggleButton.setAttribute('aria-pressed', this.isEnabled.toString());

        // Toggle active class
        this.toggleButton.classList.toggle('active', this.isEnabled);

        // Update icon (swap between eye-off and incognito)
        const icon = this.toggleButton.querySelector('svg');
        if (icon) {
            this.updateIcon(icon);
        }
    }

    updateIcon(iconElement) {
        // Replace SVG based on state
        if (this.isEnabled) {
            iconElement.innerHTML = // incognito icon path
        } else {
            iconElement.innerHTML = // eye-off icon path
        }
    }
}

// Initialize on script load
window.anonymousModeManager = new AnonymousModeManager();
```

**TR-1.4 Template Modifications**

Update base template (`templates/base.html`) to include toggle button:

```html
<!-- In top navigation bar, before theme toggle -->
<button
    id="anonymous-mode-toggle"
    class="anonymous-mode-toggle"
    aria-label="Toggle anonymous mode"
    aria-pressed="false"
    title="Hide monetary values for screen sharing">
    <svg><!-- eye-off icon --></svg>
</button>
```

Include new assets:
```html
<link rel="stylesheet" href="{{ url_for('static', filename='css/anonymous-mode.css') }}">
<script src="{{ url_for('static', filename='js/anonymous-mode.js') }}"></script>
```

### TR-2: Backend Requirements

**TR-2.1 No Backend Changes Required**
- This is a pure frontend feature
- No new API endpoints needed
- No database schema changes
- No service layer modifications

**TR-2.2 Template Rendering**
- Add `.sensitive-value` class to appropriate Jinja2 template elements
- Systematic review of all 8 pages to mark sensitive values
- Use consistent class naming across all templates

### TR-3: Browser Compatibility

**TR-3.1 Supported Browsers**
- Chrome/Edge (Chromium) 90+
- Firefox 88+
- Safari 14+

**TR-3.2 Required Features**
- CSS `filter: blur()` support (universal in modern browsers)
- `sessionStorage` API (universal support)
- ES6 JavaScript (classes, arrow functions)

### TR-4: Performance Requirements

**TR-4.1 Toggle Response Time**
- Toggle action must complete in <100ms
- CSS blur application is instant (hardware accelerated)
- No network requests on toggle

**TR-4.2 Page Load Impact**
- Anonymous mode CSS/JS adds <5KB total payload
- No impact on initial page render time
- State restoration from sessionStorage is synchronous (<1ms)

---

## Non-Functional Requirements

### NFR-1: Security & Privacy

**NFR-1.1 Data Exposure**
- Blurred values remain in HTML/DOM (not removed)
- Values are accessible via browser DevTools (this is acceptable for the use case)
- Not a security feature, purely a visual privacy tool for screen sharing
- Document this limitation clearly in UI (tooltip or help text)

**NFR-1.2 No Server-Side Filtering**
- API responses contain full unfiltered data
- No changes to JSON payloads
- No authentication bypass risk (feature is purely cosmetic)

### NFR-2: Accessibility

**NFR-2.1 Screen Reader Support**
- Toggle button has proper `aria-label` and `aria-pressed` attributes
- Blurred values still read by screen readers (cannot hide from assistive tech without removing from DOM)
- Keyboard navigation: Toggle button accessible via Tab key
- Keyboard activation: Space/Enter keys toggle the feature

**NFR-2.2 Visual Accessibility**
- Toggle button meets WCAG 2.1 AA contrast requirements
- Icon clearly distinguishable in both light and dark modes
- Blur effect works across different display DPI settings

### NFR-3: User Experience

**NFR-3.1 Visual Consistency**
- Same blur intensity across all pages (8px)
- Consistent icon styling with existing theme toggle
- Smooth transitions (0.2s ease-in-out)
- No layout shift when toggling (blur is visual-only)

**NFR-3.2 Predictability**
- Toggle state persists across page navigation (session-only)
- Clear visual feedback (icon change, button highlight)
- No unexpected resets during normal usage
- Resets only on browser close (expected behavior)

---

## User Interface Specifications

### UI-1: Toggle Button Design

**Visual States:**

1. **Default State (Anonymous Mode OFF)**
   - Icon: Eye with diagonal slash (eye-off)
   - Border: 1px solid `--color-border` (#334155)
   - Background: Transparent
   - Icon color: `--color-text-secondary` (#94A3B8)

2. **Hover State (OFF)**
   - Background: `--color-hover` (#1E293B)
   - Border: 1px solid `--color-aqua` (#06B6D4)
   - Icon color: `--color-aqua`

3. **Active State (Anonymous Mode ON)**
   - Icon: Incognito spy icon (glasses and hat silhouette)
   - Background: `--color-aqua` (#06B6D4)
   - Border: 1px solid `--color-aqua`
   - Icon color: `--color-surface` (#0F172A)

4. **Hover State (ON)**
   - Background: Lighter aqua (#22D3EE)
   - Border: 1px solid #22D3EE
   - Icon color: `--color-surface`

**Positioning:**
```
[Logo]  [Portfolio Dropdown]          [Anonymous Toggle] [Theme Toggle] [Account]
```

**Spacing:**
- 16px margin-right from theme toggle
- 8px padding inside button
- 20x20px icon size
- 8px border radius (matches design system)

### UI-2: Blurred Value Examples

**Example 1: Analyse Page Table**
```
┌─────────────────┬──────────────┬──────────┬──────────┐
│ Position        │ Current Value│ P&L (€)  │ P&L (%)  │
├─────────────────┼──────────────┼──────────┼──────────┤
│ AAPL            │ ▓▓▓▓▓▓▓      │ ▓▓▓▓▓    │ +12.5%   │
│ MSFT            │ ▓▓▓▓▓▓▓▓     │ ▓▓▓▓     │ +8.3%    │
└─────────────────┴──────────────┴──────────┴──────────┘
```
(▓ represents blurred text)

**Example 2: Sidebar Portfolio Value**
```
┌─────────────────────────┐
│ My Portfolio ▼          │
│ Total Value: ▓▓▓▓▓▓▓    │
└─────────────────────────┘
```

---

## Edge Cases & Error Handling

### EC-1: Dynamic Content Loading
**Scenario**: User toggles anonymous mode, then loads more data via AJAX.
**Solution**: CSS selectors automatically apply to dynamically added `.sensitive-value` elements.

### EC-2: Copy-Paste Bypass
**Scenario**: User tries to copy blurred text to clipboard.
**Solution**: CSS `user-select: none` prevents text selection.

### EC-3: Page Refresh
**Scenario**: User refreshes page while anonymous mode is enabled.
**Solution**: JavaScript reads sessionStorage on init and applies state before DOM render.

### EC-4: Print/PDF Export
**Scenario**: User prints page while anonymous mode is enabled.
**Solution**: CSS blur effects apply to print media (blurred in printout too).

---

## Implementation Plan

### Phase 1: Foundation (~6-8 hours)
1. Create `static/css/anonymous-mode.css` with blur styles
2. Create `static/js/anonymous-mode.js` with toggle logic
3. Update `templates/base.html` to include toggle button
4. Create icon assets (eye-off SVG, incognito SVG)

### Phase 2: Template Markup (~10-12 hours)
1. Audit all 8 pages for sensitive value locations
2. Add `.sensitive-value` class to currency amounts
3. Add `.sensitive-value` class to share counts
4. Update sidebar portfolio value display
5. Test each page with anonymous mode ON/OFF

**Page Checklist:**
- [ ] Index: Portfolio summary card, sidebar value
- [ ] Analyse: Table columns (value, invested, P&L, shares), totals row
- [ ] Build: Current value, desired value inputs, difference column
- [ ] Allocate: Allocation amounts, invest amount input
- [ ] Enrich: Market values, custom value inputs, share counts
- [ ] Risk Overview: Any absolute metrics
- [ ] Account: Portfolio dropdown values
- [ ] Sidebar: Total value display (affects all pages)

### Phase 3: Polish (~4-6 hours)
1. Add tooltip prevention for blurred elements
2. Test print/PDF export with blur
3. Add keyboard navigation support
4. Test across Firefox, Chrome, Safari
5. Add hover state transitions

### Phase 4: Documentation (~3-4 hours)
1. Update CLAUDE.md with anonymous mode description
2. Add section to DESIGN_SYSTEM.md with implementation guide
3. Create developer checklist for new sensitive values

---

## Success Metrics

1. **Functionality Coverage**: 100% of currency amounts blurred across all 8 pages
2. **Performance Impact**: <50ms toggle response time, <5KB payload increase
3. **User Satisfaction**: Feature works as expected for screen sharing use case

---

## Limitations

**Important**: Anonymous mode is a **visual privacy tool**, not a security feature.
- Values remain in HTML/DOM and are accessible via browser DevTools
- API responses still contain full data
- Designed for screen sharing privacy, not data protection
