# App Shell + Rebalancer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Next.js app shell (sidebar, layout, API proxy) and migrate the Rebalancer page from Flask.

**Architecture:** Pure SPA — Next.js serves React, fetches data from Flask backend via `next.config.ts` rewrites. Route group `(dashboard)` wraps all portfolio pages with shared sidebar layout. Rebalancer logic ported from vanilla JS `PortfolioAllocator` class to a `useRebalancer` React hook.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, shadcn/ui, Lucide icons, existing Ocean Depth theme.

**Design doc:** `docs/plans/2026-03-06-app-shell-rebalancer-design.md`

---

## Task 1: API Proxy Configuration

**Files:**
- Modify: `frontend/next.config.ts`

**Step 1: Add rewrite rules**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8065/portfolio/api/:path*",
      },
    ];
  },
};

export default nextConfig;
```

**Step 2: Verify proxy works**

Run: `cd frontend && curl -s http://localhost:3000/api/portfolios | head -c 200`

Expected: JSON response from Flask (or auth redirect — either confirms proxy works).

**Step 3: Commit**

```bash
git add frontend/next.config.ts
git commit -m "feat(frontend): add API proxy rewrite to Flask backend"
```

---

## Task 2: API Fetch Utility

**Files:**
- Create: `frontend/src/lib/api.ts`

**Step 1: Create the fetch wrapper**

This provides a typed, consistent way to call the Flask API with error handling.

```ts
const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const data = await res.json();
      throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    }
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  return res.json();
}
```

**Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add typed API fetch utility"
```

---

## Task 3: Dashboard Layout Shell

**Files:**
- Create: `frontend/src/app/(dashboard)/layout.tsx`
- Move: `frontend/src/app/page.tsx` content to `frontend/src/app/(dashboard)/page.tsx`

**Step 1: Create the dashboard layout**

This is the shared layout for all portfolio pages. Wraps content with sidebar + anonymous mode provider.

```tsx
import { AnonymousModeProvider } from "@/components/domain/anonymous-mode";
import { Sidebar } from "@/components/shell/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AnonymousModeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-w-0 p-6">{children}</main>
      </div>
    </AnonymousModeProvider>
  );
}
```

**Step 2: Move the home page**

Create `frontend/src/app/(dashboard)/page.tsx`:

```tsx
export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-aqua-500">Prismo</h1>
        <p className="mt-2 text-pearl-400">Portfolio management</p>
      </div>
    </div>
  );
}
```

Delete the old `frontend/src/app/page.tsx` (now lives inside route group).

**Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/layout.tsx frontend/src/app/\(dashboard\)/page.tsx
git rm frontend/src/app/page.tsx
git commit -m "feat(frontend): add dashboard layout with route group"
```

---

## Task 4: Sidebar Component

**Files:**
- Create: `frontend/src/components/shell/sidebar.tsx`

**Step 1: Build the sidebar**

Sleek, modern sidebar: collapsed (icon-only, 64px) by default, expands on hover (240px). Uses Lucide icons. Active route highlighted with aqua accent. Brand at top, account + anonymous toggle pinned to bottom.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Gem,
  PieChart,
  Search,
  Boxes,
  Scale,
  FlaskConical,
  Settings,
  EyeOff,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnonymousMode } from "@/components/domain/anonymous-mode";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ href: "/", icon: Home, label: "Overview" }],
  },
  {
    label: "Portfolios",
    items: [
      { href: "/enrich", icon: Gem, label: "Enrich" },
      { href: "/concentrations", icon: PieChart, label: "Concentrations" },
      { href: "/performance", icon: Search, label: "Performance" },
    ],
  },
  {
    label: "Allocation",
    items: [
      { href: "/builder", icon: Boxes, label: "Builder" },
      { href: "/rebalancer", icon: Scale, label: "Rebalancer" },
      { href: "/simulator", icon: FlaskConical, label: "Simulator" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isAnonymous, toggle: toggleAnonymous } = useAnonymousMode();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen flex flex-col border-r border-border bg-card transition-all duration-200 ease-in-out overflow-hidden z-50",
        expanded ? "w-60" : "w-16"
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-3 px-4 border-b border-border">
        <Gem className="size-5 shrink-0 text-aqua-500" />
        <span
          className={cn(
            "font-bold text-lg whitespace-nowrap transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0"
          )}
        >
          Prismo
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <span
              className={cn(
                "block px-4 mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap transition-opacity duration-200",
                expanded ? "opacity-100" : "opacity-0"
              )}
            >
              {section.label}
            </span>
            {section.items.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-sm transition-colors relative",
                    isActive
                      ? "text-foreground bg-muted before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-aqua-500"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span
                    className={cn(
                      "whitespace-nowrap transition-opacity duration-200",
                      expanded ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom Actions */}
      <div className="border-t border-border py-2">
        <button
          onClick={toggleAnonymous}
          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {isAnonymous ? (
            <EyeOff className="size-4 shrink-0" />
          ) : (
            <Eye className="size-4 shrink-0" />
          )}
          <span
            className={cn(
              "whitespace-nowrap transition-opacity duration-200",
              expanded ? "opacity-100" : "opacity-0"
            )}
          >
            {isAnonymous ? "Anonymous" : "Visible"}
          </span>
        </button>
        <Link
          href="/account"
          className={cn(
            "flex items-center gap-3 px-4 py-2 text-sm transition-colors",
            pathname === "/account"
              ? "text-foreground bg-muted"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <Settings className="size-4 shrink-0" />
          <span
            className={cn(
              "whitespace-nowrap transition-opacity duration-200",
              expanded ? "opacity-100" : "opacity-0"
            )}
          >
            Settings
          </span>
        </Link>
      </div>
    </aside>
  );
}
```

**Step 2: Verify it renders**

Open `http://localhost:3000` in browser. Should see:
- Collapsed sidebar with icons on left
- Hover to expand with labels
- Aqua gem icon + "Prismo" brand
- Navigation sections with icons
- Bottom anonymous toggle + settings

**Step 3: Commit**

```bash
git add frontend/src/components/shell/sidebar.tsx
git commit -m "feat(frontend): add collapsible sidebar with navigation"
```

---

## Task 5: Rebalancer Types

**Files:**
- Create: `frontend/src/types/portfolio.ts`

**Step 1: Define the portfolio data types**

These match the JSON shape returned by `GET /api/simulator/portfolio-data`.

```ts
export interface PortfolioCompany {
  name: string;
  identifier: string | null;
  investment_type: "Stock" | "ETF" | "Crypto";
  value_eur: number;
  target_weight: number;
  shares: number;
  sector: string | null;
  thesis: string | null;
  country: string | null;
}

export interface PortfolioSector {
  name: string;
  companies: PortfolioCompany[];
  positionCount: number;
}

export interface Portfolio {
  name: string;
  currentValue: number;
  targetWeight: number;
  sectors: PortfolioSector[];
  minPositions?: number;
  desiredPositions?: number;
}

export interface PortfolioData {
  portfolios: Portfolio[];
  total_value: number;
}

export type RebalanceMode = "existing-only" | "new-only" | "new-with-sells";

export interface RebalancedPortfolio extends Portfolio {
  targetValue: number;
  discrepancy: number;
  action: number;
}
```

**Step 2: Commit**

```bash
git add frontend/src/types/portfolio.ts
git commit -m "feat(frontend): add portfolio data types for rebalancer"
```

---

## Task 6: Rebalancer Calculation Logic

**Files:**
- Create: `frontend/src/lib/rebalancer-calc.ts`

**Step 1: Port the allocation calculation**

Pure functions, no React dependencies. Ported from `static/js/rebalancer.js` `PortfolioAllocator.calculateRebalancingActions()`.

```ts
import type {
  Portfolio,
  RebalancedPortfolio,
  RebalanceMode,
} from "@/types/portfolio";

export function calculateRebalancing(
  portfolios: Portfolio[],
  mode: RebalanceMode,
  investmentAmount: number
): RebalancedPortfolio[] {
  // Filter to portfolios with target allocations
  const filtered = portfolios.filter((p) => p.targetWeight > 0);
  if (filtered.length === 0) return [];

  const totalCurrentValue = filtered.reduce(
    (sum, p) => sum + (p.currentValue || 0),
    0
  );

  const newTotalValue =
    mode === "existing-only"
      ? totalCurrentValue
      : totalCurrentValue + investmentAmount;

  // Normalize target weights
  const totalTargetWeight = filtered.reduce(
    (sum, p) => sum + (p.targetWeight || 0),
    0
  );

  const result: RebalancedPortfolio[] = filtered.map((p) => {
    const normalizedWeight =
      totalTargetWeight > 0 ? (p.targetWeight / totalTargetWeight) * 100 : 0;
    const targetValue = (normalizedWeight / 100) * newTotalValue;
    return {
      ...p,
      targetValue,
      discrepancy: targetValue - (p.currentValue || 0),
      action: 0,
    };
  });

  applyRebalancingActions(result, mode, investmentAmount);
  return result;
}

function applyRebalancingActions(
  portfolios: RebalancedPortfolio[],
  mode: RebalanceMode,
  investmentAmount: number
) {
  if (mode === "existing-only") {
    const positiveGaps: RebalancedPortfolio[] = [];
    const negativeGaps: RebalancedPortfolio[] = [];
    let totalPositiveGap = 0;
    let totalNegativeGap = 0;

    for (const p of portfolios) {
      if (Math.abs(p.discrepancy) < 0.01) {
        p.action = 0;
      } else if (p.discrepancy > 0) {
        positiveGaps.push(p);
        totalPositiveGap += p.discrepancy;
      } else {
        negativeGaps.push(p);
        totalNegativeGap += Math.abs(p.discrepancy);
      }
    }

    const rebalanceAmount = Math.min(totalPositiveGap, totalNegativeGap);

    for (const p of positiveGaps) {
      p.action = (p.discrepancy / totalPositiveGap) * rebalanceAmount;
    }
    for (const p of negativeGaps) {
      p.action =
        -1 * (Math.abs(p.discrepancy) / totalNegativeGap) * rebalanceAmount;
    }
  } else if (mode === "new-only") {
    let totalGap = 0;
    const eligible: RebalancedPortfolio[] = [];

    for (const p of portfolios) {
      if (p.discrepancy <= 0) {
        p.action = 0;
      } else {
        eligible.push(p);
        totalGap += p.discrepancy;
      }
    }

    if (investmentAmount > 0 && totalGap > 0) {
      for (const p of eligible) {
        p.action = (p.discrepancy / totalGap) * investmentAmount;
      }
    }
  } else {
    // new-with-sells
    for (const p of portfolios) {
      p.action = Math.abs(p.discrepancy) < 0.01 ? 0 : p.discrepancy;
    }
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/lib/rebalancer-calc.ts
git commit -m "feat(frontend): port rebalancer calculation logic from Flask JS"
```

---

## Task 7: useRebalancer Hook

**Files:**
- Create: `frontend/src/hooks/use-rebalancer.ts`

**Step 1: Create the hook**

Manages data fetching, mode state, investment amount, and triggers recalculation.

```ts
"use client";

import { useState, useEffect, useMemo } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { calculateRebalancing } from "@/lib/rebalancer-calc";
import type {
  PortfolioData,
  RebalanceMode,
  RebalancedPortfolio,
} from "@/types/portfolio";

interface UseRebalancerReturn {
  portfolioData: PortfolioData | null;
  rebalanced: RebalancedPortfolio[];
  mode: RebalanceMode;
  setMode: (mode: RebalanceMode) => void;
  investmentAmount: number;
  setInvestmentAmount: (amount: number) => void;
  selectedPortfolio: string;
  setSelectedPortfolio: (name: string) => void;
  isLoading: boolean;
  error: string | null;
}

export function useRebalancer(): UseRebalancerReturn {
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(
    null
  );
  const [mode, setMode] = useState<RebalanceMode>("existing-only");
  const [investmentAmount, setInvestmentAmount] = useState(0);
  const [selectedPortfolio, setSelectedPortfolio] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await apiFetch<PortfolioData>(
          "/simulator/portfolio-data"
        );
        if (!cancelled) {
          setPortfolioData(data);
          // Auto-select first portfolio with target weight
          if (data.portfolios?.length) {
            const first = data.portfolios.find((p) => p.targetWeight > 0);
            if (first) setSelectedPortfolio(first.name);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load portfolio data"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const rebalanced = useMemo(() => {
    if (!portfolioData?.portfolios) return [];
    return calculateRebalancing(portfolioData.portfolios, mode, investmentAmount);
  }, [portfolioData, mode, investmentAmount]);

  return {
    portfolioData,
    rebalanced,
    mode,
    setMode,
    investmentAmount,
    setInvestmentAmount,
    selectedPortfolio,
    setSelectedPortfolio,
    isLoading,
    error,
  };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/use-rebalancer.ts
git commit -m "feat(frontend): add useRebalancer hook for data fetching and state"
```

---

## Task 8: Rebalancer Page — Global Overview Tab

**Files:**
- Create: `frontend/src/app/(dashboard)/rebalancer/page.tsx`

**Step 1: Build the rebalancer page with global overview**

This is the main page component with tabs. The Global Overview tab shows the portfolio-level allocation table with rebalancing controls.

```tsx
"use client";

import { useRebalancer } from "@/hooks/use-rebalancer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { Globe, PieChart } from "lucide-react";
import type { RebalanceMode, RebalancedPortfolio } from "@/types/portfolio";
import { DetailedOverview } from "./detailed-overview";

const fmt = {
  currency: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  percent: new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
};

function formatAction(action: number) {
  if (Math.abs(action) < 0.01) return { text: "No action", className: "text-muted-foreground" };
  if (action > 0) return { text: `Buy ${fmt.currency.format(action)}`, className: "text-emerald-400" };
  return { text: `Sell ${fmt.currency.format(Math.abs(action))}`, className: "text-coral-500" };
}

export default function RebalancerPage() {
  const {
    portfolioData,
    rebalanced,
    mode,
    setMode,
    investmentAmount,
    setInvestmentAmount,
    selectedPortfolio,
    setSelectedPortfolio,
    isLoading,
    error,
  } = useRebalancer();

  if (isLoading) return <RebalancerSkeleton />;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Rebalancer</h1>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const totalCurrentValue = rebalanced.reduce(
    (sum, p) => sum + (p.currentValue || 0),
    0
  );
  const newTotalValue =
    mode === "existing-only"
      ? totalCurrentValue
      : totalCurrentValue + investmentAmount;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Rebalancer</h1>

      <Tabs defaultValue="global">
        <TabsList>
          <TabsTrigger value="global" className="gap-1.5">
            <Globe className="size-3.5" />
            Global Overview
          </TabsTrigger>
          <TabsTrigger value="detailed" className="gap-1.5">
            <PieChart className="size-3.5" />
            Detailed Overview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="space-y-4">
          {/* Rebalance Controls */}
          <div className="flex flex-wrap items-end gap-6 rounded-md border border-border bg-card p-4">
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as RebalanceMode)}
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="existing-only" />
                Rebalance Existing Capital
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="new-only" />
                New Capital Only
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="new-with-sells" />
                New Capital (with sales)
              </label>
            </RadioGroup>

            {mode !== "existing-only" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Investment:</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    &euro;
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={investmentAmount || ""}
                    onChange={(e) =>
                      setInvestmentAmount(parseFloat(e.target.value) || 0)
                    }
                    className="w-40 pl-7 sensitive-value"
                    placeholder="0"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Portfolio Table */}
          {rebalanced.length === 0 ? (
            <Alert>
              <AlertDescription>
                No portfolios with target allocations found. Configure
                allocations in the Builder first.
              </AlertDescription>
            </Alert>
          ) : (
            <PortfolioTable
              portfolios={rebalanced}
              totalCurrentValue={totalCurrentValue}
              newTotalValue={newTotalValue}
            />
          )}
        </TabsContent>

        <TabsContent value="detailed">
          <DetailedOverview
            portfolioData={portfolioData}
            rebalanced={rebalanced}
            selectedPortfolio={selectedPortfolio}
            onSelectPortfolio={setSelectedPortfolio}
            mode={mode}
            investmentAmount={investmentAmount}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PortfolioTable({
  portfolios,
  totalCurrentValue,
  newTotalValue,
}: {
  portfolios: RebalancedPortfolio[];
  totalCurrentValue: number;
  newTotalValue: number;
}) {
  let totalBuys = 0;
  let totalSells = 0;

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead className="text-xs font-semibold uppercase tracking-wider">
              Portfolio
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              Current
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              Current %
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              Target %
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              Target
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              Action
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              After
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
              After %
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {portfolios.map((p) => {
            const currentPct =
              totalCurrentValue > 0
                ? p.currentValue / totalCurrentValue
                : 0;
            const valueAfter = (p.currentValue || 0) + p.action;
            const afterPct =
              newTotalValue > 0 ? valueAfter / newTotalValue : 0;
            const { text, className } = formatAction(p.action);

            if (p.action > 0.01) totalBuys += p.action;
            else if (p.action < -0.01) totalSells += Math.abs(p.action);

            return (
              <TableRow key={p.name}>
                <TableCell className="font-medium">
                  {p.name}
                  {(p.currentValue || 0) === 0 && (
                    <span className="ml-2 text-xs text-aqua-400">Empty</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <SensitiveValue>{fmt.currency.format(p.currentValue || 0)}</SensitiveValue>
                </TableCell>
                <TableCell className="text-right">
                  {fmt.percent.format(currentPct)}
                </TableCell>
                <TableCell className="text-right">
                  {fmt.percent.format((p.targetWeight || 0) / 100)}
                </TableCell>
                <TableCell className="text-right">
                  <SensitiveValue>{fmt.currency.format(p.targetValue)}</SensitiveValue>
                </TableCell>
                <TableCell className={`text-right ${className}`}>
                  <SensitiveValue>{text}</SensitiveValue>
                </TableCell>
                <TableCell className="text-right">
                  <SensitiveValue>{fmt.currency.format(valueAfter)}</SensitiveValue>
                </TableCell>
                <TableCell className="text-right">
                  {fmt.percent.format(afterPct)}
                </TableCell>
              </TableRow>
            );
          })}

          {/* Totals row */}
          <TableRow className="bg-muted/50 font-semibold">
            <TableCell>Total</TableCell>
            <TableCell className="text-right">
              <SensitiveValue>{fmt.currency.format(totalCurrentValue)}</SensitiveValue>
            </TableCell>
            <TableCell className="text-right">100%</TableCell>
            <TableCell className="text-right">100%</TableCell>
            <TableCell className="text-right">
              <SensitiveValue>
                {fmt.currency.format(
                  portfolios.reduce((s, p) => s + p.targetValue, 0)
                )}
              </SensitiveValue>
            </TableCell>
            <TableCell className="text-right text-xs">
              {totalBuys > 0 && (
                <span className="text-emerald-400">
                  Buy: <SensitiveValue>{fmt.currency.format(totalBuys)}</SensitiveValue>
                </span>
              )}
              {totalBuys > 0 && totalSells > 0 && <br />}
              {totalSells > 0 && (
                <span className="text-coral-500">
                  Sell: <SensitiveValue>{fmt.currency.format(totalSells)}</SensitiveValue>
                </span>
              )}
              {totalBuys === 0 && totalSells === 0 && (
                <span className="text-muted-foreground">No action</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <SensitiveValue>{fmt.currency.format(newTotalValue)}</SensitiveValue>
            </TableCell>
            <TableCell className="text-right">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function RebalancerSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

**Step 2: Verify the page renders**

Open `http://localhost:3000/rebalancer`. Should see:
- Page title "Rebalancer"
- Tab bar with "Global Overview" and "Detailed Overview"
- Radio buttons for rebalance mode
- Portfolio allocation table with data from Flask API
- Buy/Sell actions color-coded

**Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/rebalancer/page.tsx
git commit -m "feat(frontend): add rebalancer page with global overview"
```

---

## Task 9: Rebalancer Page — Detailed Overview Tab

**Files:**
- Create: `frontend/src/app/(dashboard)/rebalancer/detailed-overview.tsx`

**Step 1: Build the detailed overview**

Shows per-portfolio breakdown with collapsible sector groups. Uses the existing `CategoryTable` pattern but extended with rebalancer columns.

```tsx
"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { ChevronDown, ChevronRight, Expand, Shrink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PortfolioData, RebalancedPortfolio, RebalanceMode } from "@/types/portfolio";

interface DetailedOverviewProps {
  portfolioData: PortfolioData | null;
  rebalanced: RebalancedPortfolio[];
  selectedPortfolio: string;
  onSelectPortfolio: (name: string) => void;
  mode: RebalanceMode;
  investmentAmount: number;
}

const fmt = {
  currency: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }),
  percent: new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
  }),
};

export function DetailedOverview({
  portfolioData,
  rebalanced,
  selectedPortfolio,
  onSelectPortfolio,
}: DetailedOverviewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const validPortfolios = rebalanced.filter(
    (p) => p.targetWeight > 0 && p.name && !p.name.toLowerCase().includes("unknown")
  );

  const selected = portfolioData?.portfolios.find(
    (p) => p.name === selectedPortfolio
  );

  const sectors = selected?.sectors?.filter(
    (s) => s.name !== "Missing Positions"
  ) ?? [];

  const toggleSector = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));

  const expandAll = () =>
    setExpanded(Object.fromEntries(sectors.map((s) => [s.name, true])));

  const collapseAll = () =>
    setExpanded(Object.fromEntries(sectors.map((s) => [s.name, false])));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={selectedPortfolio} onValueChange={onSelectPortfolio}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a portfolio" />
          </SelectTrigger>
          <SelectContent>
            {validPortfolios.map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.name}
                {(p.currentValue || 0) === 0 ? " (Empty)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sectors.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={expandAll}>
              <Expand className="size-3.5 mr-1" />
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              <Shrink className="size-3.5 mr-1" />
              Collapse All
            </Button>
          </div>
        )}
      </div>

      {selected && sectors.length > 0 ? (
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="text-xs font-semibold uppercase tracking-wider">
                  Position
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                  Value
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                  Type
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sectors.map((sector) => {
                const isExpanded = expanded[sector.name] ?? true;
                return (
                  <SectorGroup
                    key={sector.name}
                    name={sector.name}
                    companies={sector.companies}
                    isExpanded={isExpanded}
                    onToggle={() => toggleSector(sector.name)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : selected ? (
        <p className="text-sm text-muted-foreground">
          No positions in this portfolio.
        </p>
      ) : null}
    </div>
  );
}

function SectorGroup({
  name,
  companies,
  isExpanded,
  onToggle,
}: {
  name: string;
  companies: { name: string; value_eur: number; investment_type: string }[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className="bg-muted/50 cursor-pointer hover:bg-muted"
        onClick={onToggle}
      >
        <TableCell colSpan={3} className="font-medium">
          <span className="flex items-center gap-1">
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {name}
            <span className="text-xs text-muted-foreground ml-1">
              ({companies.length})
            </span>
          </span>
        </TableCell>
      </TableRow>
      {isExpanded &&
        companies.map((c) => (
          <TableRow key={c.name}>
            <TableCell className="pl-8">{c.name}</TableCell>
            <TableCell className="text-right">
              <SensitiveValue>{fmt.currency.format(c.value_eur || 0)}</SensitiveValue>
            </TableCell>
            <TableCell className={cn("text-right text-xs", {
              "text-aqua-400": c.investment_type === "ETF",
              "text-coral-500": c.investment_type === "Crypto",
            })}>
              {c.investment_type}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
```

**Step 2: Verify detailed tab works**

Open `http://localhost:3000/rebalancer`, click "Detailed Overview" tab. Should see:
- Portfolio dropdown with valid portfolios
- Expand/Collapse All buttons
- Sector groups with collapsible company lists
- Values and types displayed correctly

**Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/rebalancer/detailed-overview.tsx
git commit -m "feat(frontend): add rebalancer detailed overview tab"
```

---

## Task 10: Placeholder Pages for Navigation

**Files:**
- Create: `frontend/src/app/(dashboard)/enrich/page.tsx`
- Create: `frontend/src/app/(dashboard)/concentrations/page.tsx`
- Create: `frontend/src/app/(dashboard)/performance/page.tsx`
- Create: `frontend/src/app/(dashboard)/builder/page.tsx`
- Create: `frontend/src/app/(dashboard)/simulator/page.tsx`
- Create: `frontend/src/app/(dashboard)/account/page.tsx`

**Step 1: Create placeholder pages**

Each page is a minimal placeholder so sidebar links work. All follow the same pattern:

```tsx
// Example: frontend/src/app/(dashboard)/enrich/page.tsx
export default function EnrichPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Enrich</h1>
      <p className="text-muted-foreground">Coming soon.</p>
    </div>
  );
}
```

Create one for each: `enrich`, `concentrations`, `performance`, `builder`, `simulator`, `account`. Use appropriate titles.

**Step 2: Verify navigation**

Click through each sidebar link. Each should show its placeholder page with the sidebar remaining visible and correctly highlighting the active route.

**Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/*/page.tsx
git commit -m "feat(frontend): add placeholder pages for all navigation routes"
```

---

## Task 11: Visual Polish and Build Verification

**Files:**
- Various adjustments

**Step 1: Verify build passes**

Run: `cd frontend && npm run build`

Expected: Build succeeds with no errors.

**Step 2: Cross-check responsive behavior**

- Resize browser to mobile width
- Sidebar should collapse to icons
- Tables should scroll horizontally

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(frontend): complete app shell and rebalancer migration"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | API proxy config | `next.config.ts` |
| 2 | Fetch utility | `src/lib/api.ts` |
| 3 | Dashboard layout | `src/app/(dashboard)/layout.tsx` |
| 4 | Sidebar | `src/components/shell/sidebar.tsx` |
| 5 | Portfolio types | `src/types/portfolio.ts` |
| 6 | Rebalancer calc | `src/lib/rebalancer-calc.ts` |
| 7 | useRebalancer hook | `src/hooks/use-rebalancer.ts` |
| 8 | Global overview | `src/app/(dashboard)/rebalancer/page.tsx` |
| 9 | Detailed overview | `src/app/(dashboard)/rebalancer/detailed-overview.tsx` |
| 10 | Placeholder pages | `src/app/(dashboard)/*/page.tsx` |
| 11 | Polish + build | Various |
