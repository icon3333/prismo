# Design Audit — Prismo vs. Terminal Design System

**Audit date:** 2026-04-24
**Audit scope:** `frontend/` (Next.js 16 + React 19 + Tailwind v4 + shadcn/ui)
**Target spec:** `design_readme.md` + `colors_and_type.css` (Terminal DS, dark-first, mono-dominant, square corners, zero shadows)
**Mode:** Read-only. No code changes were made.

---

## Executive summary

The app ships a completely different design system — "Ocean Depth" (OKLCH-based aqua/teal/coral palette, light-first, rounded corners, shadcn defaults). Every signature Terminal pattern (masthead bar, ticker hero cells, left-rule hover, source strip, live-dot, kicker) is missing. Every shadcn component ships with rounded corners (`rounded-lg` / `rounded-xl` / `rounded-4xl`) and most still contain `shadow-*` class literals even though `@theme` nulls the shadow values. Default font is Geist, not Inter + JetBrains Mono. Three `Intl.NumberFormat` call sites use `en-US`. Spinners are used in nine places. The app shell is a vertical sidebar (`shell/sidebar.tsx`) rather than a horizontal masthead.

This is closer to "replace" than "skin" for 80% of the UI primitives.

---

## 1. Inventory

### Stack
| Concern | What's in use |
|---|---|
| Framework | Next.js 16.2.4 (App Router), React 19.2.3 |
| CSS | Tailwind v4 (`@tailwindcss/postcss`), configured via `@theme inline {}` inside `frontend/src/app/globals.css:11` — no `tailwind.config.ts` |
| Primitive library | `@base-ui/react` (`^1.2.0`) — shadcn's new base-ui variant |
| Component library | shadcn/ui (via `shadcn@^4.0.0`), configured in `frontend/components.json` |
| Fonts | `geist/font/sans` + `geist/font/mono` via `frontend/src/app/layout.tsx:2-3` — NOT Inter / JetBrains Mono |
| Theme provider | `next-themes` in `frontend/src/app/layout.tsx:4`, `defaultTheme="system"`, attribute="class" |
| Icons | `lucide-react@^0.577.0` — 40+ distinct icons referenced across the app |
| Charts | `apexcharts@^5.10.3` + `react-apexcharts@^2.1.0` |
| PDF | `jspdf@^4.2.0` |
| Animations utility | `tw-animate-css@^1.4.0` (imported at `globals.css:2`) |
| Toasts | `sonner@^2.0.7` |

### App file map

**App shell**
- `frontend/src/app/layout.tsx` — root, wires Geist fonts + ThemeProvider
- `frontend/src/app/(dashboard)/layout.tsx` — sidebar + main (no masthead)
- `frontend/src/components/shell/sidebar.tsx` — vertical left nav, 60/w-16 collapsible
- `frontend/src/components/shell/account-picker.tsx`
- `frontend/src/components/shell/error-boundary.tsx`

**Pages (`(dashboard)/`)**
- `page.tsx` (Overview home)
- `enrich/` — page.tsx, enrich-table, table-row, summary-bar, portfolio-footer, csv-upload-dialog, add-position-dialog, bulk-action-bar
- `performance/` — page.tsx, summary-panel, performance-chart, allocation-table, concentration-heatmap
- `rebalancer/` — page.tsx, summary-footer, detailed-overview
- `simulator/` — page.tsx, simulator-header, items-table, items-table-row, item-input-forms, allocation-bar, allocation-charts, save-dialog, clone-dialog, investment-progress, position-details-panel
- `builder/` — page.tsx, portfolio-list, portfolio-row, position-table, allocation-summary, budget-section, rules-section
- `concentrations/` — page.tsx, donut-chart, distribution-bar, portfolio-filter
- `account/page.tsx`

**Theme playground**
- `frontend/src/app/theme/page.tsx` — Ocean Depth component specimen page (also contains a gradient at line 326)

**shadcn `ui/` components (21 files)**
alert, alert-dialog, badge, button, checkbox, command, dialog, dropdown-menu, input, input-group, popover, progress, radio-group, select, sheet, skeleton, sonner, table, tabs, textarea, tooltip

**Domain components (`components/domain/`)**
anonymous-mode, category-table, chart-wrapper, constraint-warnings, panel-layout, slider-item

**Lib**
- `lib/format.ts` — `en-US` Intl formatter (non-conformant)
- `lib/api.ts`
- `lib/utils.ts`
- `lib/*-calc.ts` — pure domain calc modules (performance, rebalancer, simulator, builder, enrich, overview, concentrations, portfolio-state)

**Hooks** — one per page domain, all under `hooks/use-*.ts`

**Types** — one per page domain, under `types/*.ts`

---

## 2. Token gap analysis

All Tailwind tokens live in `frontend/src/app/globals.css`. Column "current" is what exists; "target" is the Terminal value.

### 2.1 Surface / canvas

| Token | Terminal target | Current | Verdict |
|---|---|---|---|
| `--bg` `#0B0D0E` | canvas | `--background` = `oklch(0.984 0.003 248.2)` (light `#F8FAFC`); dark = `oklch(0.129 0.041 264.7)` (≈`#020617`) | **Diverges**. Default theme is LIGHT (`html { color-scheme: light }` at `globals.css:210`). Dark bg is `#020617` not `#0B0D0E`. |
| `--bg-1` `#111416` | panel / masthead | `--card` = `oklch(1 0 0)` light / `oklch(0.208 0.040 265.8)` dark (≈`#0F172A`) | **Diverges**. |
| `--bg-2` `#171B1E` | raised / ticker cell | no equivalent | **Missing**. |
| `--bg-3` `#1E2328` | hover row | `--muted` in dark mode ≈ `#1E293B` | **Missing** as a named token; `--muted` overloaded. |
| `--bg-4` `#262C32` | pressed | no equivalent | **Missing**. |

### 2.2 Rules (borders)

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--rule` `#242A30` | default 1px | `--border` = `oklch(1 0 0 / 15%)` dark | **Diverges** (alpha-based, not a tonal step). |
| `--rule-2` `#30373E` | emphasized | no equivalent | **Missing**. |
| `--rule-3` `#454D56` | strong | no equivalent | **Missing**. |

### 2.3 Ink ladder

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--ink` `#E8ECEF` | primary | `--foreground` = `oklch(0.984 0.003 248.2)` dark (≈`#F8FAFC`) | **Diverges**. |
| `--ink-1` `#B4BBC2` | secondary | no equivalent | **Missing**. |
| `--ink-2` `#7A838C` | tertiary / labels | `--muted-foreground` = `oklch(0.711 0.035 256.8)` dark (≈`#94A3B8`) | **Diverges** and single step, not a ladder. |
| `--ink-3` `#4A5057` | quaternary | no equivalent | **Missing**. |
| `--ink-inv` `#041015` | on-accent | `--primary-foreground` | **Diverges** (mapping different). |

### 2.4 Accents (semantic)

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--cyan` `#00D4E6` | live / CSV / primary | `--primary` / aqua = `oklch(0.715 0.126 215.2)` (≈`#06B6D4`) | **Diverges** — wrong hue, too muted. |
| `--cyan-1/-2` hover/pressed | | no equivalent | **Missing**. |
| `--amber` `#FFB020` | sim / manual / warn | `--warning` = coral-500 `oklch(0.705 0.187 47.6)` (≈`#F97316`) | **Diverges** (orange, not amber). |
| `--amber-1/-2` | | none | **Missing**. |
| `--violet` `#8B7CF6` | ETF | none | **Missing**. |
| `--green` `#00C16A` | gain | `--success` = teal-500 `oklch(0.704 0.123 182.5)` (≈`#14B8A6`) | **Diverges** — teal, not green. |
| `--green-1` | hover | none | **Missing**. |
| `--red` `#FF5360` | loss | `--destructive` = `oklch(0.637 0.208 25.3)` (≈`#EF4444`) | **Diverges** (too red/dark). |
| `--red-1` | hover | none | **Missing**. |

### 2.5 Source-of-truth

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--src-csv` | `var(--cyan)` | none | **Missing**. |
| `--src-manual` | `var(--amber)` | none | **Missing**. |

### 2.6 Sector palette

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--sec-tech` / `-etf` / `-consumer` / `-energy` / `-finance` / `-health` / `-cash` | per spec | `--chart-1..5` = aqua/teal/coral/aqua-400/pearl-400 at `globals.css:122-126` | **Missing** sector semantics; only 5 generic chart colors exist. |

### 2.7 Typography scale

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--sans` | Inter | Geist Sans (`layout.tsx:2`, `globals.css:25`) | **Diverges**. |
| `--mono` | JetBrains Mono | Geist Mono (`layout.tsx:3`, `globals.css:26`) | **Diverges**. |
| `--fs-hero` 40px | | no equivalent | **Missing**. |
| `--fs-h1` 26px | | no equivalent | **Missing**. |
| `--fs-h2` 18px | | no equivalent | **Missing**. |
| `--fs-h3` 15px | | no equivalent | **Missing**. |
| `--fs-body` 13px | | Tailwind default (16px root) — pages use `text-sm` (14px) | **Diverges** (too large by default). |
| `--fs-label` 11px | | `text-[11px]` used ad-hoc, not tokenized (e.g. `(dashboard)/page.tsx:146,154,162`) | **Missing** token. |
| `--fs-kbd` / `--fs-micro` / `--fs-mono` | | none | **Missing**. |
| `--tr-label` 0.12em / `--tr-wide` 0.16em / `--tr-tight` −0.02em | | `tracking-wider` (~0.05em) ad-hoc | **Missing** named tokens. |
| `.ds-hero` / `.ds-h1..h3` / `.ds-label` / `.ds-kicker` / `.ds-micro` / `.ds-mono` semantic classes | | none | **Missing** entirely. |

### 2.8 Spacing

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--sp-1..16` (4px base: 4/8/12/16/20/24/32/40/48/64) | | `--space-xs..xl` (0.25/0.5/1/1.5/2rem) at `globals.css:151-155` + Tailwind's 4px scale | **Partial**. Tailwind scale (4px base) already matches numerically, but the named `--sp-*` tokens don't exist; the `--space-*` names use a different naming convention and a 4-step ladder. |

### 2.9 Radii

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--radius-none` 0 | default everywhere | `--radius: 0.5rem` (`globals.css:119`); `--radius-sm: 0.375rem`, `--radius-md: 0.5rem`, `--radius-lg: 0.75rem`, `--radius-xl: 1rem`, `--radius-2xl..4xl` (`globals.css:38-44`) | **Diverges**. Everything is rounded. |
| `--radius-sm` 2px | kbd only | `0.375rem` (6px) | **Diverges**. |
| `--radius-md` 3px | reserved | `0.5rem` | **Diverges**. |

### 2.10 Motion

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--t-fast` 80ms linear | color hover | `--transition-fast: 150ms cubic-bezier(.4,0,.2,1)` (`globals.css:158`) | **Diverges** (too slow, wrong easing for fast tier). |
| `--t-base` 120ms cubic-bezier | bg hover, tab swap | `--transition-base: 250ms` (`globals.css:159`) | **Diverges**. |
| `--t-smooth` 200ms | panel reveal | `--transition-smooth: 350ms` (`globals.css:160`) | **Diverges**. |
| `--pulse-dur` 1.4s | live dot | none | **Missing**. |
| `@keyframes ds-pulse` | | none | **Missing**. |

### 2.11 Elevation

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--elev-0..3` (tonal only) | | `--shadow-* : none` overrides at `globals.css:28-35` (good!) but many components still carry `shadow-sm`/`shadow-md`/`shadow-lg` class names (dropdown-menu, select, popover, sheet, tabs, simulator-header, performance/allocation-table, concentration-heatmap, simulator/allocation-charts, performance/performance-chart). | **Partial** — tokens nulled, but class-level literals would re-activate if `--shadow-*` are ever restored, and some (`shadow-lg` on Sheet, default `--radius` still applied) remain visually active via fallbacks. |

### 2.12 Control sizing

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--btn-h` 28 / `--btn-h-sm` 22 / `--btn-h-lg` 34 | | Button sizes ship as `h-8 / h-6 / h-7 / h-9` (`button.tsx:26-35`) | **Diverges** (32/24/28/36 px). |
| `--input-h` 30 | | Input `h-8` (`input.tsx:11`) | **Diverges**. |
| `--bar-h` 40 (masthead) | | no masthead exists | **Missing**. |
| `--row-h` 44 min | | Table rows default, no min-h set | **Missing** |

### 2.13 Focus ring

| Token | Target | Current | Verdict |
|---|---|---|---|
| `--focus: 0 0 0 2px var(--cyan)` | 2px cyan, no offset | `focus-visible:ring-3 focus-visible:ring-ring/50` on every component (`button.tsx:9`, `input.tsx:12`, `select.tsx:44`, etc.) | **Diverges** — 3px, 50% opacity, plus `focus-visible:border-ring`. |

### 2.14 Light/Dark orientation

| Target | Current | Verdict |
|---|---|---|
| Dark-first; light optional via `[data-theme="light"]` | Light-first (`:root` = light, `.dark` overrides); toggled via next-themes `system` default (`layout.tsx:20`, `globals.css:210-214`) | **Diverges** — inverted default. |

---

## 3. Component conformance

| Component | File | Issues vs. Terminal §9 |
|---|---|---|
| **Button** (`button.tsx:9-43`) | | `rounded-lg` on all sizes; `rounded-[min(var(--radius-md),10px)]` on `xs`/`sm`/`icon-xs`/`icon-sm`; `text-sm` / `text-xs` / `text-[0.8rem]`, NOT mono, NOT uppercase, NO 0.06em tracking, NO `font-weight: 500`; heights `h-6/h-7/h-8/h-9` (24/28/32/36px) vs. spec 22/28/34; no Danger variant as spec'd (current `destructive` uses destructive-tinted bg, not the spec "resting `bg: bg-2; color: red`"). |
| **Badge** (`badge.tsx:8`) | | `rounded-4xl` = fully pill-rounded (spec: 0 radius). `h-5`, `text-xs`, NOT mono, NOT uppercase, NO 0.12em tracking, NO 1px colored border / transparent fill (spec). No `LIVE` / `CSV` / `MANUAL` / `LOCKED` variants. No pulsing live-dot on `LIVE`. |
| **Input** (`input.tsx:11`) | | `rounded-lg`; `h-8` (spec 30). Sans font (spec mono 12px). `focus-visible:border-ring` + `ring-3 ring-ring/50` (spec: single cyan border on focus, no ring). |
| **Select** (`select.tsx:44,86,120`) | | Trigger `rounded-lg` + size-conditional `rounded-[min(var(--radius-md),10px)]`. Popup `rounded-lg` + `shadow-md` literal + `ring-1 ring-foreground/10`. Items `rounded-md`. Chevron: lucide `ChevronDownIcon` (spec: `▾` U+25BE text glyph). |
| **Dialog** (`dialog.tsx:56,105`) | | Content `rounded-xl`. Footer `rounded-b-xl`. Close button uses lucide `XIcon` (spec: `×` U+00D7 text glyph). Title is sans `text-base` (no mono kicker pattern). Overlay uses `bg-black/10` with `backdrop-filter: backdrop-blur-xs` (spec has no blur). Animations `duration-100` → OK-ish. |
| **Alert-Dialog** (`alert-dialog.tsx:55`) | | `rounded-xl`. Same kicker/text issues as Dialog. |
| **Sheet** (`sheet.tsx:56`) | | `shadow-lg` class literal. `data-[side]:border-*` 1px border (OK). `duration-200` (spec `--t-smooth` 200ms — OK for this). |
| **Tabs** (`tabs.tsx:27,61-64`) | | List `rounded-lg`. Trigger `rounded-md` + `shadow-sm` on active (spec: underline-style, cyan 2px bottom-border). `line` variant exists (line 28,62) and comes closer to spec but is opt-in; default variant is pill/filled. No 0.12em UPPER mono trigger label. Optional `count` suffix missing. |
| **Table** (`table.tsx`) | | `TableHead` is `h-10 px-2 text-left font-medium` — NO mono, NO uppercase, NO `bg-1` fill. `TableRow` has `hover:bg-muted/50` — NO 2px cyan left-rule on `td:first-child`. No `.num` right-align convention. No source-strip `td::before` slot. No cash-row styling. Remove-on-hover not baked in. |
| **Dropdown Menu** (`dropdown-menu.tsx:44,91,116,139,165,207`) | | Popup `rounded-lg` + `shadow-md` + `ring-1`. Items + sub-trigger + submenu-popup all `rounded-md`/`rounded-lg`. `ChevronRightIcon` lucide for submenu (spec: `▾` / text). |
| **Popover** (`popover.tsx:40`) | | `rounded-lg` + `shadow-md`. |
| **Tooltip** (`tooltip.tsx:53`) | | `rounded-md`. Uses `bg-foreground text-background` (inversion OK aesthetically, but Terminal would use `bg-2` raised surface). |
| **Alert** (`alert.tsx:7`) | | `rounded-lg` + `border` (spec: 0 radius, 2px left-rule accent, rgba tint on `bg-1`). `destructive` variant is text-only tint on `bg-card` — no left-rule. |
| **Skeleton** (`skeleton.tsx:7`) | | `animate-pulse rounded-md` — spec forbids spinners and Terminal has no equivalent skeleton pattern (empty/loading is a mono label, not an animated gray block). |
| **Checkbox** (`checkbox.tsx:13`) | | `rounded-[4px]`. |
| **Radio-group** (`radio-group.tsx:23`) | | `rounded-full` (acceptable as radio; but `data-checked:bg-primary` uses aqua-primary, not cyan). |
| **Progress** (`progress.tsx:68`) | | Tabular-nums present — one of the few. |
| **Command** (`command.tsx:75,159`) | | `rounded-lg`, `rounded-sm`, `in-data-[slot=dialog-content]:rounded-lg!`. Spec: no `⌘K` palette exists (§2.9 "no command palette"). The command primitive's presence implies a palette — flag for discussion. |
| **Sonner / Toast** (`sonner.tsx:5,28`) | | Uses lucide `CircleCheckIcon`, `InfoIcon`, `TriangleAlertIcon`, `OctagonXIcon`, `Loader2Icon`. Terminal forbids spinners (§12.3) and constrains icons to 5 glyphs (§12.6). |
| **Input-group** (`input-group.tsx:17,26,127,143`) | | `rounded-lg`; inner controls `rounded-none` (OK). Kbd slot present with `[&>kbd]:rounded-[calc(var(--radius)-5px)]`. |

**Non-zero radius** — every component listed above except `input-group`'s inner controls.
**`shadow-*` class literals remaining** — `dropdown-menu.tsx:44,139`, `select.tsx:86`, `popover.tsx:40`, `sheet.tsx:56`, `tabs.tsx:61`, `command.tsx:75`, `simulator/simulator-header.tsx:57,69`, `simulator/allocation-charts.tsx:96,107`, `performance/concentration-heatmap.tsx:150`, `performance/allocation-table.tsx:219`, `performance/performance-chart.tsx:293,311`, `input-group.tsx:69,127,143` (explicitly `shadow-none`), `item-input-forms.tsx:157,261`. The `@theme` nulls `--shadow-*` variables, but leaving the class names wired up is fragile and inconsistent with the spec.
**Non-semantic accents** — gradient at `frontend/src/app/theme/page.tsx:326` and `components/domain/slider-item.tsx:47-48`. Aqua used decoratively as brand (sidebar `Gem` glyph at `sidebar.tsx:87`, "Go to Builder" link `(dashboard)/page.tsx:179`). "Success" for non-financial ops implied by `--success`.
**Lucide icons** — 40+ distinct symbols imported across 30+ files (see §3-table in grep output, and Section 6 below). Terminal §12.6 allows five text glyphs only.
**Motion** — all shadcn components use `duration-100` / `duration-200` (OK for spec `--t-base` 120ms / `--t-smooth` 200ms, but `--transition-fast: 150ms` at `globals.css:158` exceeds the 80ms Terminal fast tier; no 80ms usages anywhere).

No use of emoji found. No hero-image / illustration in shipped pages.

---

## 4. Typography audit

**Fonts**

- `frontend/src/app/layout.tsx:2-3,18` — `GeistSans` + `GeistMono` imported and applied as `className={${GeistSans.variable} ${GeistMono.variable}}`.
- `frontend/src/app/globals.css:25-26` — `--font-sans: var(--font-geist-sans), …`, `--font-mono: var(--font-geist-mono), 'Fira Code', …`. Geist ≠ Inter / JetBrains Mono.
- No `<link>` to Google Fonts for Inter / JetBrains Mono anywhere.

**Numbers not in mono / not tabular**

Tabular-nums appears in only 21 locations (grep `tabular-nums`): `simulator/allocation-bar.tsx`, `simulator/position-details-panel.tsx`, `simulator/items-table-row.tsx`, `builder/position-table.tsx`, `builder/allocation-summary.tsx`, `builder/portfolio-row.tsx`, `builder/budget-section.tsx`, `ui/progress.tsx`. Every other numeric cell renders without `tabular-nums` or `font-mono`.

Examples of bare-numeric surfaces:
- `(dashboard)/page.tsx:141,151,159` — "Total Value" / "Portfolios" / "Assets" metric pills use `font-mono` + `font-bold` but no `tabular-nums`.
- `(dashboard)/page.tsx:81` — violation delta `{(v.currentPercentage - v.maxPercentage).toFixed(1)}%` rendered in `font-semibold font-mono` only (no tabular).
- `rebalancer/summary-footer.tsx` — currency via `en-US` formatter, rendered inline.
- `enrich/table-row.tsx`, `performance/allocation-table.tsx` — values rendered without `tabular-nums` class on the `<td>` (some have `font-mono` but inconsistent).

**Label / kicker / table-header casing**

- Table-header UPPERCASE applied **ad-hoc**, never via `TableHead` component. Seen in `rebalancer/page.tsx:191-212`, `rebalancer/detailed-overview.tsx:141-165`, `performance/summary-panel.tsx:148-174`, `performance/allocation-table.tsx:234-241`, `account/page.tsx:142`, `theme/page.tsx:340-346`, `(dashboard)/page.tsx:146,154,162` (metric pill labels). Each site repeats a variant of `text-xs font-semibold uppercase tracking-wider` — sans, not mono, not the 0.12em spec tracking, not 11px-tokenized.
- No `.ds-kicker` — no detail page opens with `PORTFOLIO · 01 · UPDATED 14M AGO` above the H1. All dashboard H1s are plain: e.g. `(dashboard)/page.tsx:109,129` = `<h1 className="text-2xl font-bold">Overview</h1>`.

**de-DE vs. en-US**

- `frontend/src/lib/format.ts:2,8` — both formatters `en-US`. `rebalancerFmt.currency` / `.percent`. Used by `rebalancer/summary-footer.tsx` and anywhere else that imports from `lib/format`.
- `frontend/src/app/(dashboard)/page.tsx:17` — `currencyFmt` `en-US` for Overview "Total Value".
- `frontend/src/app/(dashboard)/rebalancer/summary-footer.tsx:12` — `fmt` `en-US`.
- **de-DE correct** at: `concentrations/portfolio-filter.tsx:9`, `enrich/summary-bar.tsx:19`, `enrich/table-row.tsx:22-23`, `performance/allocation-table.tsx:33`, `performance/summary-panel.tsx:30`, `lib/simulator-calc.ts:28`.

**Latin minus (U+2212)**

- No occurrence of U+2212 found anywhere under `frontend/src`. All signed negatives render as ASCII hyphen from `Intl.NumberFormat` without a post-format `.replace('-', '−')` step.
- Spec `format.ts` in `design_readme.md` §12.2 calls for `eur = n => eurFmt.format(n).replace('-', '−')`. Current `lib/format.ts:15-27` uses `formatAction` which concatenates `"Buy"` / `"Sell"` prefixes with a positive EUR — sidesteps the sign instead of honoring `−`.

---

## 5. Pattern coverage

| Pattern | Status | Evidence |
|---|---|---|
| **Masthead bar** (40px, 1px-divided mono 11px UPPER cells) | **Missing** | App shell is a vertical sidebar (`components/shell/sidebar.tsx`), not a horizontal masthead. Dashboard layout has no top bar (`app/(dashboard)/layout.tsx:14`). |
| **Ticker hero cells** (4-up raised grid, 40px mono figure, mini-sparkline) | **Missing** | Closest approximation: `(dashboard)/page.tsx:139-166` "metric pills" — 3-up grid of `rounded-md bg-muted p-4 text-center` with `text-lg font-bold font-mono` (lg ≠ 40px, center-aligned, no sparkline). `performance/summary-panel.tsx` also has a summary block — not the ticker-cell pattern. |
| **Left-rule row hover** (`inset 2px 0 0 cyan` on first td) | **Missing** | `ui/table.tsx:60` has `hover:bg-muted/50` on `TableRow`, no `td:first-child` box-shadow. No custom variant in any page extends it. |
| **Source strip** (3×16px cyan/amber bar per row) | **Missing** | `enrich/table-row.tsx` renders a text-only source label. No vertical colored bar pattern. |
| **Inline allocation bar** (2px cyan underline in % column) | **Partial** | `simulator/allocation-bar.tsx` renders a full-width horizontal stacked bar (not per-row underline). No per-`.pct-cell` `::before` fill. |
| **Live dot** (6px pulsing, 1.4s, cyan/green/amber) | **Missing** | No `.live-dot` class; no `@keyframes ds-pulse`. `animate-pulse` (Tailwind default) is used at `simulator/simulator-header.tsx:292`, `builder/page.tsx:47`, `ui/skeleton.tsx:7` for loading/skeleton states, not as a live-data indicator. |
| **Simulation banner** (2px amber left-rule, rgba tint) | **Missing** | No tinted amber banner found. Simulator page (`simulator/page.tsx`) has `simulator-header.tsx` with mode toggle but no "SIMULATION MODE — base portfolio is locked" banner. |
| **Kicker / ID line** (mono 11px UPPER cyan above H1) | **Missing** | No `.ds-kicker` pattern. H1s render bare. |
| **Allocation bar** (full-width sector-colored 14px stacked) | **Partial** | `simulator/allocation-bar.tsx` + `simulator/allocation-charts.tsx` draw stacked bars, but with ApexCharts donut/bar components and aqua/teal/coral palette, not the sector-tokened 14px 1px-gapped segments with indexed legend (`01`, `02`, …). |

---

## 6. Behavioral checks

### 6.1 `Intl.NumberFormat`

Already enumerated in §4. Three sites on `en-US`; six on `de-DE`. No central module yet — each page declares its own formatter.

### 6.2 Persistence

- `frontend/src/hooks/use-simulator.ts:45` — `const LS_KEY = "simulator_state";`
- Only the simulator uses localStorage. No other page uses `localStorage` or `IndexedDB`.
- Spec §12.5: single JSON blob under key `ptsim.v1`, written on every mutation. Current: simulator-only; no import/export, no backup, no central hydration.
- No `IndexedDB` anywhere. No cloud / no account backend (matches spec intent — but note the app does use a Flask backend over HTTP, which is a deeper divergence from the "local-first" §1 non-goal; flag for discussion).

### 6.3 Empty / error states

Spec §12.3: centered mono label + sentence + primary action. No illustrations.

Current implementations:
- `(dashboard)/page.tsx:116-125` — `<Alert variant="destructive">` for errors (card+border). Not spec.
- `concentrations/distribution-bar.tsx:29` / `donut-chart.tsx:29` / `performance/concentration-heatmap.tsx:40` — plain `"No data"` text, not the label/sentence/action triptych.
- `performance/summary-panel.tsx:73` — `<strong>No portfolios with holdings found.</strong>` inside an alert card. Not spec.
- `rebalancer/page.tsx:134` — `"No portfolios with target allocations found. Configure…"` inline paragraph.
- `builder/allocation-summary.tsx:87` — `"No portfolios configured."`
- `simulator/allocation-charts.tsx:159` — `"No data to display"`.
- No `<tr><td colspan>…</td></tr>` pattern for empty-table rows.

### 6.4 Loading states — spinners

Spec §12.3: **no spinners**; show `—` and set masthead to amber `FETCHING…`.

Current `animate-spin` Loader2 usages:
- `simulator/save-dialog.tsx:85`
- `simulator/clone-dialog.tsx:161`
- `simulator/simulator-header.tsx:299`
- `simulator/item-input-forms.tsx:148`
- `enrich/summary-bar.tsx:174`
- `enrich/add-position-dialog.tsx:167,306`
- `enrich/portfolio-footer.tsx:142`
- `enrich/csv-upload-dialog.tsx:233`
- `ui/sonner.tsx:28` (toast loading state)

Plus `animate-pulse` on skeleton/placeholder surfaces (`ui/skeleton.tsx:7`, `simulator/simulator-header.tsx:292`, `builder/page.tsx:47`) which is a different animation but still motion-heavy.

### 6.5 Staleness classifier

No `classifyStaleness` function exists anywhere (grep confirmed empty). No `live` / `recent` / `stale` / `disconnected` enumeration. No "UPDATED Xm AGO" kicker. Timestamp copy like `simulator/simulator-header.tsx:299` says "Saving" (bare word) — no staleness semantics.

---

## 7. shadcn skinning verdict

| Component | File | Skinning effort | Reason |
|---|---|---|---|
| Button | `ui/button.tsx` | **Moderate** | Rewrite cva: replace 6 variants × 8 size strings, drop all `rounded-*` + `shadow-*`, add mono/UPPER/0.06em typography. Primary/Default/Ghost/Danger mapping exists conceptually. |
| Badge | `ui/badge.tsx` | **Moderate** | `rounded-4xl` → 0. Rewrite variants per §9.2 (LIVE pulsing dot, CSV, MANUAL, LOCKED). Currently entirely color-based, not token+border. |
| Input | `ui/input.tsx` | **Trivial** | One-line: swap `rounded-lg` → square, swap height `h-8` → 30, drop `ring-3`. |
| Select | `ui/select.tsx` | **Moderate** | Popup + trigger + items all need radius/shadow strip. Base-ui animations (`data-open:*` / `slide-in-from-*`) mostly OK but spec is much terser. |
| Dialog / Alert-Dialog | `ui/dialog.tsx`, `ui/alert-dialog.tsx` | **Moderate** | `rounded-xl` → 0. Replace lucide `XIcon` with `×`. Backdrop `backdrop-blur-xs` → none. Title/description restyle (kicker + H1 pattern). |
| Sheet | `ui/sheet.tsx` | **Moderate** | `shadow-lg` strip; animation translations are "-10" — fine, keep. 1px border per side (already present) matches spec. |
| Tabs | `ui/tabs.tsx` | **Heavy** | Current default variant is pill/filled with `shadow-sm` active; spec is underline-only with cyan 2px bottom-border and `margin-bottom: -1px`. The built-in `line` variant is closer but also needs cleanup (mono, UPPER, 0.12em, inactive `ink-2` / active cyan). Essentially rewrite. |
| Table | `ui/table.tsx` | **Heavy** | Current wrapper is a bare HTML table with loose Tailwind; spec has source strip, left-rule hover, dual-line name cell, stacked gain/loss, hover-reveal remove button, cash row. This is more a domain table than a primitive. Best to keep `Table/TableHeader/TableBody/TableRow/TableHead/TableCell` as thin structural shells and build a **`DataTable`** wrapper at the domain layer. |
| Dropdown-menu | `ui/dropdown-menu.tsx` | **Moderate** | Strip all `rounded-*` + `shadow-*` + `ring-1`. Replace lucide `ChevronRightIcon` with `▾`. Items already near-minimal. |
| Popover | `ui/popover.tsx` | **Trivial** | Swap `rounded-lg` + `shadow-md`. |
| Tooltip | `ui/tooltip.tsx` | **Trivial** | Swap `rounded-md`. |
| Alert | `ui/alert.tsx` | **Moderate** | Rebuild around 2px left-rule + rgba tint pattern. |
| Skeleton | `ui/skeleton.tsx` | **Replace** | Spec has no skeleton pattern — replace callsites with "—" + amber `FETCHING…`. Deleting the file is cleaner than skinning it. |
| Checkbox | `ui/checkbox.tsx` | **Trivial** | `rounded-[4px]` → square; color tokens. |
| Radio-group | `ui/radio-group.tsx` | **Trivial** | Radius OK (circle); token remap. |
| Progress | `ui/progress.tsx` | **Trivial** | Already has `tabular-nums`; just radius + color. |
| Command | `ui/command.tsx` | **Replace** | Spec says no `⌘K` palette — delete the primitive and any callsites unless the user is deliberately keeping a command palette. |
| Sonner | `ui/sonner.tsx` | **Heavy** | Four lucide icons + Loader2. Spec forbids spinners & icons. Rebuild as a minimal text toast (mono label + optional color). |
| Input-group | `ui/input-group.tsx` | **Moderate** | Radius strip; kbd calc rewrite against `--radius-sm: 2px`. |
| Textarea | `ui/textarea.tsx` | **Trivial** | Likely same pattern as Input — not reviewed line-by-line in this pass; flag. |

**Global theme file** (`frontend/src/app/globals.css`) — **Heavy replace**. All `--color-*` / `--radius` / `--transition-*` / `--space-*` tokens need to be rebuilt against the Terminal ladder. This is the single highest-leverage file in the repo: replacing its `@theme inline` block + `:root` + `.dark` rules (≈200 lines) re-skins every shadcn primitive at once.

---

## 8. Top 10 highest-impact fixes (ranked, dependency-ordered)

1. **`frontend/src/app/globals.css:11-78, 84-203`** — replace the entire `@theme inline {}` + `:root` + `.dark` blocks. Drop Ocean Depth OKLCH palette; drop all radius tokens > 0; install the Terminal ladder: `--bg`/`--bg-1..4`, `--rule`/`--rule-2..3`, `--ink`/`--ink-1..3`/`--ink-inv`, `--cyan`/`--amber`/`--green`/`--red` + hover/pressed tones, sector palette, type scale, motion tokens, `--focus`. Map shadcn's `--primary` / `--background` / `--foreground` / `--border` / `--ring` onto these. Flip default from light to dark (`html { color-scheme: dark }`). **Effort: L.** Touches one file but re-skins everything.

2. **`frontend/src/app/globals.css:38-44`** — set `--radius-sm..4xl` → `0`; keep a dedicated `--radius-kbd: 2px`. Also delete `--radius` at `:119` or set to `0`. Single token change that removes rounded corners from every shadcn primitive simultaneously. **Effort: S.**

3. **`frontend/src/app/layout.tsx:2-3,18`** — replace `geist/font/sans` + `geist/font/mono` with `next/font/google` loading Inter + JetBrains Mono (weights 400/500/600/700). Update `globals.css:25-26` `--font-sans` / `--font-mono` accordingly. **Effort: S.**

4. **`frontend/src/app/globals.css`** — append Terminal's semantic type classes (`.ds-hero`, `.ds-h1..h3`, `.ds-body`, `.ds-label`, `.ds-kicker`, `.ds-micro`, `.ds-mono`, `.ds-number`) plus `.up` / `.down` / `.live` / `.warn` / `.live-dot` + `@keyframes ds-pulse`. Copy verbatim from `colors_and_type.css:172-239`. **Effort: S.**

5. **`frontend/src/lib/format.ts` (whole file, 28 lines)** — rewrite per spec §12.2: `de-DE` formatters, post-format `.replace('-', '−')` for Latin minus, exports `eur` / `signedEur` / `pct` / `signedPct` / `shares`. Then update `(dashboard)/page.tsx:17` and `rebalancer/summary-footer.tsx:12` to import from this module instead of declaring local `en-US` formatters. Grep-find any other call sites and redirect. **Effort: S.**

6. **`frontend/src/components/ui/button.tsx:8-43`** — rewrite cva. Drop `rounded-lg` + all `rounded-[min(...)]` size overrides + focus-ring styling. Define Primary/Default/Ghost/Danger variants per §9.1 with mono 11px UPPER 0.06em tracking, 28/22/34px heights. Replace `focus-visible:ring-3 focus-visible:ring-ring/50` with `focus-visible:shadow-[var(--focus)]`. Cascades to every page because `Button` is used everywhere. **Effort: M.**

7. **`frontend/src/components/ui/table.tsx` (whole file, 117 lines)** — replace with a Terminal-conformant `DataTable` primitive: `thead th` mono 10px UPPER 0.12em `ink-2` bg-1; `tbody td` mono 13px ink 12px padding rule-bottom; `tr:hover td` bg-1 fill + `box-shadow: inset 2px 0 0 var(--cyan)` on `td:first-child`; `.num` right-align helper; source-strip slot via `td[data-source]::before`. Cash row + name-cell stacked sub-label + remove-on-hover can be composition patterns on top. Cascades to every table page. **Effort: L.**

8. **`frontend/src/components/shell/sidebar.tsx` + `frontend/src/app/(dashboard)/layout.tsx`** — flag to user: Terminal shell is a horizontal masthead (§8.1), not a vertical sidebar. This is an **architectural** decision, not a skin. Either (a) keep the sidebar and accept divergence, (b) build the masthead and collapse the sidebar into it, or (c) run both. Current sidebar also hard-codes lucide icons for nav items — remove them or switch to text-only. **Effort: L if (b) is chosen.** Do not tackle until user decides.

9. **`frontend/src/components/ui/badge.tsx:8`** — rewrite variants from scratch: `rounded-4xl` → 0, add `LIVE`/`CSV`/`MANUAL`/`LOCKED` variants per §9.2 with 1px colored border + transparent fill + mono 9px UPPER 0.12em. Include built-in pulsing live-dot slot on `LIVE`. **Effort: M.**

10. **Spinner removal** — 9 `<Loader2 … animate-spin />` sites (listed §6.4). Replace with `—` placeholder + parent masthead amber `FETCHING…` label (once the masthead exists per fix #8). Also replace `Skeleton` usages (`(dashboard)/page.tsx:110-111,170,209-215`, and wherever else) with the same pattern. **Effort: M.** Trivial per site, but spans many files.

---

## 9. Open questions

1. **Product scope.** The spec is for PTSIM — a single-user, local-first web app that **has no server backend** (§12.5 "no IndexedDB, no cloud, no account"). Current app has a Flask JSON API, account selection, CSV import from brokers, and multi-portfolio management. Is Terminal intended as a skin over the existing Flask-backed Prismo, or is the underlying product being redefined?

2. **Masthead vs. sidebar.** Terminal §8.1 specifies a 40px horizontal masthead. Current shell is a 60w collapsible vertical sidebar (`components/shell/sidebar.tsx`) with Overview / Enrich / Concentrations / Performance / Builder / Rebalancer / Simulator sections. None of Terminal's three primary flows (portfolio list, portfolio detail, simulation) map 1:1 onto these seven pages. Which navigation model wins, and how are the 7 existing pages to be reconciled with Terminal's home + detail + simulation triad?

3. **Charts.** Terminal §1 non-goals state "no charting beyond sparklines." Prismo uses ApexCharts across concentrations (donut, distribution bar, allocation donut, sector/geo/investment-type/thesis distributions), performance (performance-chart line, concentration-heatmap), simulator (allocation-charts donut). Does the spec override these, or is the charting surface grandfathered in?

4. **Light mode.** Prismo defaults to light via system preference (`layout.tsx:20` `defaultTheme="system"`). Terminal explicitly ships dark-first with light as courtesy. Confirm: switch default to `"dark"` and remove the auto-system detection?

5. **Command palette.** `frontend/src/components/ui/command.tsx` exists (cmdk). Terminal §2.9 forbids a command palette ("no command palette, no hotkeys, no ⌘K chip"). Is the file unused? (Grep for `<Command` or `cmdk` importers before deleting.)

6. **Icons in sidebar / nav.** Even if the masthead replaces the sidebar, sidebar items currently use lucide (`Home`, `Gem`, `PieChart`, `Search`, `Boxes`, `Scale`, `FlaskConical`). Terminal §10 says "essentially no icons" — is the intent that navigation is text-only, or are nav icons a pragmatic exception?

7. **Simulation delta semantics.** Terminal §12.4 says simulated positions compare vs. their hypothetical buy-in price (column "Gain since add"). Current simulator (`app/(dashboard)/simulator/*`) runs on overlay/portfolio modes toggled in the header and persisted under `simulator_state`. Which of Prismo's simulator semantics maps to "Gain since add," and which (if any) get dropped?

8. **Terminology.** Spec uses `NAV`, `YTD`, `POS`, `UPD`, `CET` (terse, finance-literate). Current copy uses full words ("Overview", "Total Value", "Portfolios", "Assets", "Concentrations", "Stock Violations"). How aggressive should the rewrite be — shorten all existing labels, or only where screen density forces it?

9. **Animations library.** `tw-animate-css` is imported at `globals.css:2`. Terminal motion is short and mechanical (80/120/200ms). Keep the animation utility but restrict to token durations, or remove entirely?

10. **Brand name.** Layout title says "Prismo" (`layout.tsx:8`), sidebar brand says "Prismo" (`sidebar.tsx:90`), README says "Prismo". Spec uses "PTSIM". Is the product being rebranded, or is PTSIM the internal codename and Prismo the surface brand?

11. **Ocean Depth theme page** (`frontend/src/app/theme/page.tsx`, 640+ lines) — is this a retained design reference to keep, a specimen to delete, or the starting point for a Terminal replacement at `/theme`?
