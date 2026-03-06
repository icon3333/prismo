# App Shell + Rebalancer Migration Design

## Overview

Migrate the Flask frontend to Next.js, starting with the app shell (sidebar, layout, API plumbing) and the Rebalancer page.

## Architecture

Pure SPA: Next.js serves React app, fetches data from Flask backend via proxy rewrite.

```
Next.js (localhost:3000)          Flask (localhost:8065)
  App Shell (layout)       -->     /portfolio/api/*
    Sidebar                        JSON responses
    Page content
      /rebalancer
```

### API Proxy

`next.config.ts` rewrites `/api/*` to `http://localhost:8065/portfolio/api/*`. No CORS needed. Cookie/session forwarded automatically.

## App Shell

### Layout

Route group `(dashboard)` wraps all portfolio pages in `app/(dashboard)/layout.tsx`.

**Sidebar design** (sleek, modern):
- Collapsed by default (icon-only, ~64px wide)
- Expands on hover (~240px) with smooth transition
- No separate top navbar — brand and user menu live in sidebar
- Active route: aqua left border accent
- Mobile: slide-out sheet triggered by hamburger

**Navigation structure:**
- Overview (home)
- Portfolios section: Enrich, Concentrations, Performance
- Allocation section: Builder, Rebalancer, Simulator
- Bottom-pinned: Account settings, Anonymous mode toggle

### Shared State

React context providers in `(dashboard)/layout.tsx`:
- `AnonymousModeProvider` — blur sensitive values (existing component)
- API fetch wrapper — configurable base URL, error handling

## Rebalancer Page

### Route

`app/(dashboard)/rebalancer/page.tsx`

### API

Single endpoint: `GET /api/simulator/portfolio-data`

Returns: portfolio data with companies, sectors, allocations, targets.

### Component Tree

```
RebalancerPage
  RebalancerTabs (shadcn Tabs)
    GlobalOverview
      RebalanceControls (radio group + investment input)
      PortfolioTable (allocation table with current/target/delta)
    DetailedOverview
      PortfolioSelector (dropdown)
      ExpandCollapseControls
      CategoryTable (existing domain component, per-sector collapsible)
```

### State & Logic

`useRebalancer` hook encapsulates:
- Portfolio data fetching (single fetch on mount)
- Rebalance mode: 'existing-only' | 'new-only' | 'new-with-sells'
- Investment amount (for new capital modes)
- Allocation calculation (ported from PortfolioAllocator class)
- Expand/collapse state for sector groups

Rebalance calculation is pure: mode + amount + portfolio data = rendered allocations. No server round-trips for recalculation.

### Rebalance Modes

1. **Existing Only** — redistribute current holdings to match targets (shows buy/sell deltas)
2. **New Capital Only** — allocate new money to underweight positions (no sells)
3. **New Capital With Sales** — combine new money + proceeds from selling overweight positions

## Design Decisions

- **Proxy rewrite over CORS**: simpler, no Flask changes needed
- **Collapsed sidebar**: modern, saves space, shows full labels on hover
- **No top navbar**: brand + user menu in sidebar reduces visual noise
- **Single hook for rebalancer logic**: keeps component tree clean, logic testable
- **Reuse existing domain components**: CategoryTable, AnonymousMode already built
