# Portfolio Simulator — Terminal Design System

> A Bloomberg-flavored, expert-density operator's terminal for modeling stock/ETF portfolio allocations in EUR against live market data. Dark charcoal canvas. Mono-dominant typography. Tonal depth, zero shadows, square corners. Every number is tabular. Every accent is semantic.

This is the canonical spec. If a pattern isn't documented here, derive it from the principles below — don't invent new ones.

---

## 1. Product context

**Portfolio Simulator** (codename **PTSIM**) is a single-user, local-first web app. It is not a broker, not a robo-advisor, and not a consumer finance product. Its users are operators: people who already understand cost basis, allocation drift, and FX normalization, and who want a dense, keyboard-first tool that gets out of the way.

**Primary flows.**
1. **Home — portfolio list.** Scan every portfolio in one glance: NAV, daily delta, positions count, last-refresh staleness.
2. **Portfolio detail — positions.** The hero ticker cells show NAV / invested / cash / positions count. A dense table lists every holding with ticker, name, sector, allocation %, shares, value, gain/loss.
3. **Portfolio detail — simulation.** A hypothetical layer stacked on top of the locked base portfolio. Simulated positions are amber, base positions are cyan-sourced, and the two layers never mutate each other.

**Non-goals.**
- No trading, no quotes feed, no news, no charting beyond sparklines.
- No social, no sharing, no multi-user permissions.
- No onboarding, no marketing surface, no empty-state illustrations.

**Data model, at the level the UI cares about.**
- Portfolios contain positions and cash.
- Each position has a **source**: `csv` (imported, refreshed, cyan) or `manual` (typed, static, amber). Source is visible on every row.
- All values are **EUR-normalized** at display time. Native currency is metadata; it never replaces the EUR figure.
- The **base layer** is the real portfolio. The **simulation layer** is a sandbox stacked on top — additive, non-destructive.

The entire visual system exists to serve these flows. Every token, every pattern, every rule below is in service of dense numerical scanning by someone who already knows what they're looking at.

---

## 2. Design principles

1. **Density is the feature.** 13px body. 10–11px labels. 4px spacing base. If a screen looks "empty," that's correct — users come here to read, not to be welcomed.
2. **Depth is tonal, never cast.** Surfaces step through `#0B0D0E → #111416 → #171B1E → #1E2328`. No drop shadows. Ever.
3. **Corners are square.** `border-radius: 0` everywhere. The only exception is 2px on `<kbd>` chips, because keyboard caps read as keyboard caps.
4. **Hairlines, not walls.** Borders are 1px, in `#242A30` (subtle) or `#30373E` (emphasized). Never thicker, never colored-for-decoration.
5. **Mono carries meaning.** JetBrains Mono for every number, ticker, label, kicker, table header, badge, and keyboard chip. Inter only for prose (titles, names, descriptive text).
6. **Color is semantic.** Cyan = live / CSV / primary. Amber = simulation / manual / warn. Green = gain. Red = loss. Violet = ETF sector. Never mix roles. Never decorate.
7. **Numbers are tabular.** `font-variant-numeric: tabular-nums` on every figure. Two decimals for money, four for shares, two for percent. German formatting (`de-DE`): thousands `.`, decimal `,`, currency suffixed. Signs on deltas always: `+4.215,20 € · +2,80 %` or `−294,00 € · −6,20 %`.
8. **Latin minus, not hyphen.** Negative numbers use `−` (U+2212), not `-`.
9. **Fully keyboard-accessible, no shortcuts.** Every interactive surface is tab-reachable. No command palette, no hotkeys, no `⌘K` chip. Hover reveals refinements; it never gates primary actions.
10. **Motion is short and mechanical.** 80–120ms transitions. 1.4s pulse on the live dot. Honor `prefers-reduced-motion`.

If a proposed design violates any of these without a specific justification, it's wrong.

---

## 3. Voice & copy

**Tone.** Direct, competent, finance-literate. The user knows what a position is. Don't explain.

- ✅ "Model allocations against live market data."
- ❌ "Welcome to your portfolio! Let's get started."

**Casing.**
| Element | Case | Example |
|---|---|---|
| Page titles (sans) | Sentence | `Aggressive Growth` |
| Section titles (sans) | Sentence | `Allocation by sector` |
| Kickers (mono) | UPPERCASE · 0.16em | `PORTFOLIO · 01 · UPDATED 14M AGO` |
| Labels (mono) | UPPERCASE · 0.12em | `TOTAL NAV` |
| Buttons (mono) | UPPERCASE · 0.06em | `IMPORT CSV`, `+ ADD POSITION` |
| Table headers (mono) | UPPERCASE · 0.12em | `TICKER`, `ALLOC`, `VALUE` |
| Tickers (mono) | UPPERCASE | `AAPL`, `VWCE.DE` |
| Company names (sans) | As reported | `Apple Inc.`, `Nestlé S.A.` |
| Sectors (mono) | UPPERCASE · 0.04em | `TECHNOLOGY`, `ETF` |
| Badges (mono) | UPPERCASE · 0.12em | `LIVE`, `CSV`, `MANUAL`, `LOCKED` |

**Writing rules.**
- No exclamation points. No emoji.
- No "please," no "welcome," no "let's."
- Abbreviate when the user already knows the term: `NAV`, `AUM`, `YTD`, `POS`, `UPD`.
- Timestamps are terse: `14m`, `2h`, `1d`, `14:32 CET`.
- Numbers have signs, separators, and 2dp — even zero: `0,00 €`, `+0,00 %`.
- Use `·` (middot) as an in-line separator: `+4.215,20 € · +2,80 %`.
- Formatting is locked to `Intl.NumberFormat('de-DE', …)`. Thousands separator `.`, decimal `,`, EUR suffixed with a non-breaking space. Percent suffixed with a non-breaking space and `%`.
- "Add" buttons lead with `+ `: `+ Add position`, `+ New portfolio`.

---

## 4. Typography

### 4.1 Faces

| Role | Family | Why |
|---|---|---|
| UI / prose | **Inter** | Neutral, excellent at 12–14px, wide character set for European tickers |
| Numbers / labels / tickers | **JetBrains Mono** | Tabular figures, distinct `0/O`, `1/l`, authoritative at small sizes |

Load via Google Fonts — the system does not ship local font files.

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Weights used: **400 / 500 / 600 / 700**. Never italic (mono italics are noise). Never `font-stretch`, never decorative weights.

### 4.2 Scale

Terminal type is **small on purpose**. The default body is 13px, not 16px.

| Token | Size | Family | Weight | Tracking | Line-height | Purpose |
|---|---|---|---|---|---|---|
| `.ds-hero` | 40px | mono | 600 | −0.02em | 1.1 | Ticker-cell main figure (e.g. Total NAV) |
| `.ds-h1` | 26px | sans | 600 | −0.015em | 1.1 | Page title (portfolio name) |
| `.ds-h2` | 18px | sans | 600 | −0.005em | 1.25 | Section title |
| `.ds-h3` | 15px | sans | 600 | 0 | 1.25 | Card / block title |
| `.ds-body` | 13px | sans | 400 | 0 | 1.5 | Default prose |
| `.ds-body-sm` | 12px | sans | 400 | 0 | 1.5 | Secondary prose, meta |
| `.ds-mono` / `.ds-number` | 13px | mono | — | 0.02em | 1.5 | Any figure in the body |
| `.ds-kicker` | 11px | mono | 600 | 0.16em UPPER | 1 | Breadcrumb / ID kicker, cyan |
| `.ds-label` | 11px | mono | 500 | 0.12em UPPER | 1 | Labels above figures |
| `.ds-micro` | 10px | mono | 500 | 0.12em UPPER | 1 | Badges, meta rows |
| (kbd) | 10px | mono | 500 | 0 | 1 | Keyboard chips only |

**Hero figures** (`.ds-hero`) are the visual anchor of every screen. They're mono because a 40px tabular `436.207,16 €` reads at a glance; a proportional one doesn't.

**Why negative tracking?** At 26–40px, Inter and JetBrains Mono both open up slightly. `-0.015em` / `-0.02em` pulls them back to the density the rest of the page expects.

### 4.3 Tabular numerals

Every number gets `font-variant-numeric: tabular-nums`. This is the single most-important detail in the whole system — it's what makes columns of figures line up and what makes the screen read as a terminal instead of a dashboard.

```css
.ds-number, table td.num, .ticker .val { font-variant-numeric: tabular-nums; }
```

When hand-writing one-off numbers, use `.ds-number` as a wrapper class; don't rely on the mono font alone.

---

## 5. Color

### 5.1 Canvas & panels (tonal depth)

Four-step neutral stack, near-black with a cool cast. Every surface picks one.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0B0D0E` | App canvas |
| `--bg-1` | `#111416` | Panels, masthead, table headers, alloc card |
| `--bg-2` | `#171B1E` | Raised: ticker cells, buttons, inputs |
| `--bg-3` | `#1E2328` | Hover state on rows, active pressed |
| `--bg-4` | `#262C32` | Deep press / held |

**The rule.** Elevation is expressed by climbing this ladder, never by casting a shadow. A "raised" panel is +1 step above its container. A hovered row is +1 step above the table. A pressed button is +1 step above its resting state.

### 5.2 Rules (borders)

| Token | Hex | Use |
|---|---|---|
| `--rule` | `#242A30` | Default: row separators, panel borders, masthead cells |
| `--rule-2` | `#30373E` | Emphasized: button borders, input borders |
| `--rule-3` | `#454D56` | Strong: rarely used — focused input, modal edge |

All rules are **1px**. Never 2px, never doubled. If something needs more weight, it wants color (cyan, amber) or elevation (a panel), not a thicker border.

### 5.3 Ink (text hierarchy)

Four steps, top-down contrast.

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#E8ECEF` | Primary text — titles, figures, table cells |
| `--ink-1` | `#B4BBC2` | Secondary — body prose, name cells |
| `--ink-2` | `#7A838C` | Tertiary — labels, sectors, meta |
| `--ink-3` | `#4A5057` | Quaternary — muted indices, disabled |
| `--ink-inv` | `#041015` | On-cyan / on-amber fills (primary buttons) |

Pair rule: a label (`ink-2`) sits above a figure (`ink`). Never invert.

### 5.4 Accents — semantic only

Each of these four colors maps to exactly one meaning. They are **never** decorative.

| Token | Hex | Means |
|---|---|---|
| `--cyan` | `#00D4E6` | Live data, CSV source, primary action, focus ring |
| `--amber` | `#FFB020` | Simulation layer, manual source, warning, editing |
| `--green` | `#00C16A` | Gain, success, "connected" state |
| `--red` | `#FF5360` | Loss, error, destructive action |

**Cyan** is the identity color. The brand glyph, the masthead wordmark, the primary button, the active tab underline, and the focus ring are all cyan. Cyan also means **CSV-sourced**: the 3×16px source bar in a ticker cell is cyan when the price comes from an imported feed.

**Amber** is the simulation color. Anywhere the user is operating on hypothetical data — the simulation tab, the simulation banner, amber source bars on manual positions — amber signals "this is not live." It also does double duty as a warning color, which is semantically consistent (both mean "pay attention before acting").

**Green / Red** only mean gain / loss. Never success/failure for non-financial outcomes. A saved portfolio is not green; it's just saved.

Accent hover / press tones (available in tokens):

```
--cyan-1  #3BE1EF   hover
--cyan-2  #0093A0   pressed
--amber-1 #FFC34D   hover
--amber-2 #CC8A10   pressed
--green-1 #37D88C   hover
--red-1   #FF7A83   hover
```

### 5.5 Categorical — sectors

For the allocation legend / donut only. Never use sector colors for state or interaction.

| Token | Hex | Sector |
|---|---|---|
| `--sec-tech` | `#00D4E6` | Technology (shares cyan — intentional; tech is the default sector for this product) |
| `--sec-etf` | `#8B7CF6` | ETF |
| `--sec-consumer` | `#FFB020` | Consumer (shares amber) |
| `--sec-energy` | `#00C16A` | Energy (shares green) |
| `--sec-finance` | `#E85AA0` | Finance |
| `--sec-health` | `#5AC8FA` | Healthcare |
| `--sec-cash` | `#4A5057` | Cash reserve |

The overlap between sector colors and semantic accents is deliberate: the allocation bar is the one place where a user is reading category, not state, so the reuse doesn't collide with gain/loss semantics.

### 5.6 Alpha & tint

When an accent needs to tint a surface (simulation banner, focus glow), use a **rgba of the accent at 0.08–0.12 opacity** over `--bg-1`. No other tints exist.

```css
.sim-banner { background: rgba(255,176,32,0.08); border-left: 2px solid var(--amber); }
```

### 5.7 Light mode

Ships as `[data-theme="light"]` on `<html>` or `<body>`. It inverts the canvas/ink ladder, darkens accents for AA contrast, and otherwise changes nothing — same type scale, same density, same square corners.

**Not the default.** Terminal is designed dark. Light mode is a courtesy for users working in bright rooms or printing.

---

## 6. Spacing, sizing, radii

### 6.1 Spacing

4px base. Denser than the standard 8pt grid. Every gap, padding, and margin snaps to this scale.

| Token | px |
|---|---|
| `--sp-1` | 4 |
| `--sp-2` | 8 |
| `--sp-3` | 12 |
| `--sp-4` | 16 |
| `--sp-5` | 20 |
| `--sp-6` | 24 |
| `--sp-8` | 32 |
| `--sp-10` | 40 |
| `--sp-12` | 48 |
| `--sp-16` | 64 |

Common uses: row padding `12px`, cell padding `20–22px`, section gap `24–32px`, page padding `28px`.

### 6.2 Control sizes

| Token | px | Use |
|---|---|---|
| `--btn-h-sm` | 22 | Inline actions, row icons |
| `--btn-h` | 28 | Default button |
| `--btn-h-lg` | 34 | Primary page-level action (rare) |
| `--input-h` | 30 | Inputs, selects |
| `--bar-h` | 40 | Masthead |
| `--row-h` | 44 (min) | Table row |

### 6.3 Radii

| Token | px | Use |
|---|---|---|
| `--radius-none` | 0 | Everything |
| `--radius-sm` | 2 | `<kbd>` chips, pill-shaped status dots (rare) |
| `--radius-md` | 3 | Reserved; avoid unless absolutely warranted |

**Default is zero.** If a component's figma has rounded corners, change the figma.

### 6.4 Focus ring

```css
--focus: 0 0 0 2px var(--cyan);
:focus-visible { outline: none; box-shadow: var(--focus); }
```

2px cyan. No offset. Applies to every interactive element. Never replaced by a colored border — the border stays; the ring adds on top.

---

## 7. Motion

Short, mechanical, almost imperceptible. Nothing eases in from offscreen. Nothing bounces.

| Token | Value | Use |
|---|---|---|
| `--t-fast` | `80ms linear` | Color / border hover |
| `--t-base` | `120ms cubic-bezier(.4,0,.2,1)` | Background hover, tab swap |
| `--t-smooth` | `200ms cubic-bezier(.4,0,.2,1)` | Panel reveal, rare |
| `--pulse-dur` | `1.4s` | Live-dot pulse (opacity 1 → 0.35) |

```css
@media (prefers-reduced-motion: reduce) {
  .live-dot { animation: none; }
  * { transition-duration: 0ms !important; }
}
```

The live-dot pulse is the only animation that loops. Everything else is event-driven.

---

## 8. Signature patterns

These are the patterns that make Terminal recognizable. Reuse them verbatim. Don't reinvent them.

### 8.1 The masthead bar

A 40px-tall strip at the top of every page. `background: var(--bg-1)`. `border-bottom: 1px solid var(--rule)`. Divided into cells by vertical 1px rules. Every cell is mono 11px UPPERCASE.

```
┌──────────┬───────────────────┬──────────────────┬────────────────────────┐
│ ▪ PTSIM  │ PORTFOLIOS        │ NAV 436.207,16 € │ ● LIVE · EUR · 14:32 … │
└──────────┴───────────────────┴──────────────────┴────────────────────────┘
```

- **Brand cell.** Cyan wordmark `PTSIM`, 0.12em tracking, preceded by a 10×10px solid cyan glyph. Never changes.
- **Breadcrumb cell.** Current location, `·`-separated. `ink-2` for prior crumbs, `ink` for current.
- **NAV cell.** Live portfolio NAV, `ink-2` label + `ink` value.
- **Live cell.** Staleness classifier (see §12.1). Pulsing green dot when live; steady cyan / amber / red as data ages.

### 8.2 Ticker cells (the hero row)

A 3- or 4-up grid of raised (`--bg-2`) cells, separated by 1px `--rule`. The first (`main`) cell hosts:
- 10px UPPERCASE mono label with a pulsing live dot
- 40px mono hero figure (`.ds-hero`)
- Signed delta in green/red mono
- A 22px mini-sparkline — cyan bars with the last bar at full opacity, the rest at 0.6

Secondary cells drop the sparkline and use 22px mono figures at `ink-1`. This is **the** hero pattern for portfolio detail.

### 8.3 Left-rule row hover

Table rows don't get background fills that scream. On hover:

```css
tbody tr:hover td { background: var(--bg-1); }
tbody tr:hover td:first-child { box-shadow: inset 2px 0 0 var(--cyan); }
```

A 2px cyan bar slides in on the left edge of the hovered row. It's the single most satisfying micro-detail in the whole system. Don't skin it out.

### 8.4 Source strip

Every position row leads with a **3px × 16px** vertical bar telling the user where the price came from.

- **Cyan** — CSV / live feed.
- **Amber** — manual entry.

This replaces the icon set. There are no icons on rows.

### 8.5 Inline allocation bar

The allocation % column has a 2px cyan line underneath the percent, width proportional to allocation. It's a sparkbar and a number at once, so the user doesn't need a separate chart to feel the distribution.

```css
.pct-cell { position: relative; }
.pct-cell .fill { position: absolute; right: 12px; bottom: 4px; height: 2px; background: var(--cyan); opacity: 0.5; }
```

### 8.6 Live dot

6px solid circle, pulses 1 → 0.35 opacity on a 1.4s ease-in-out loop. Cyan for live primary, green for "connected," amber for "paused / editing."

```html
<span class="live-dot"></span>         <!-- green, default -->
<span class="live-dot cyan"></span>
<span class="live-dot amber"></span>
```

### 8.7 Simulation layer banner

When the user is in simulation mode, a 2px amber left-rule banner sits above the table with an amber-tinted background (`rgba(255,176,32,0.08)`):

```
▌ SIMULATION MODE — base portfolio is locked; changes here won't affect your real allocation
```

And the layer toggle below shows the base as `● LOCKED` (ink-3 dot) and the simulation as `● SIMULATION` (amber dot). The active layer sits on `--bg-3`.

### 8.8 Allocation bar

A full-width horizontal stacked bar of 1px-separated colored segments, sector-colored, 14px tall, under a mono label. Below it: a `repeat(auto-fit, minmax(180px, 1fr))` legend grid with indexed items (`01`, `02`, …), 10px swatch, sector name (mono UPPER, ink-1), and bold percent.

### 8.9 Kicker / ID line

Every detail page leads with a kicker above the H1:

```
PORTFOLIO · 01 · UPDATED 14M AGO
Aggressive Growth
```

Kicker is `.ds-kicker` (mono 11px, cyan, 0.16em, UPPER). The ID number is highlighted cyan; everything else is `ink-3`.

---

## 9. Components

### 9.1 Buttons

| Variant | Resting | Hover | Pressed |
|---|---|---|---|
| **Primary** | `bg: cyan; color: ink-inv; border: cyan; weight: 700` | `bg: cyan-1; border: cyan-1` | `bg: cyan-2` |
| **Default** | `bg: bg-2; color: ink; border: rule-2` | `bg: bg-3; border: cyan; color: cyan` | `bg: bg-4` |
| **Ghost** | `bg: transparent; color: ink-2; border: transparent` | `color: ink; border: rule-2` | — |
| **Danger** | `bg: bg-2; color: red; border: rule-2` | `bg: red; color: ink-inv; border: red` | — |

All buttons: 28px tall (`--btn-h`), 0 12px padding, mono 11px, 500 weight, UPPERCASE, 0.06em tracking. Small variant: 22px × 8px padding × 10px font. Icons (rare) go on the left, 6px gap.

Add actions lead with `+ `: `+ Add position`, `+ New portfolio`, `+ Add simulated`.

### 9.2 Badges

28px wide padding, 3px vertical, mono 9px, 600 weight, UPPERCASE, 0.12em tracking. 1px colored border. No fill.

```
LIVE (green) · CSV (cyan) · MANUAL (amber) · LOCKED (ink-2)
```

`LIVE` badge includes a pulsing live-dot to its left.

### 9.3 Inputs & keys

- **Input.** 30px tall, `bg-2` fill, `rule-2` border, mono 12px. Focus = cyan border (no ring).
- **Select.** Same, chevron in `ink-2`.
- **Kbd.** 2px radius, mono 10px, `bg-2`, `rule-2` border. Reserved for documentation / legend use; no shortcuts are wired in the product.

### 9.4 Tabs

Underline-style. Mono 11px UPPERCASE, 0.12em tracking. Inactive = `ink-2`. Hover = `ink`. Active = cyan with a 2px cyan bottom-border sitting flush with the 1px panel rule (use `margin-bottom: -1px`).

Optional count: append `<span class="count">12</span>` after the label, in `ink-3`.

### 9.5 Data table

Every table in the product follows this skeleton.

```
┌ Ticker  Name                Alloc    Shares      Value         Gain / loss
│ ▎AAPL   Apple Inc.          12,40 %  72          17.722,80 €   +7.759,24 € (+77,80 %)
│         Technology
```

**Rules.**
- `thead th` — `bg-1`, mono 10px, 500, UPPER, 0.12em, `ink-2`, 10px 12px padding, bottom-border `rule`.
- `tbody td` — mono 13px, `ink`, 12px padding, bottom-border `rule`.
- Numeric columns right-aligned (`.num`).
- Row hover → `bg-1` fill + 2px cyan inset on first cell.
- Cash row → `bg-1` fill, cyan source bar, `CASH` ticker in cyan.
- Name cell stacks sans name (`ink`) over mono 10px UPPER sector (`ink-2`).
- Gain/loss stacks signed EUR over signed % in 10px at 0.7 opacity.
- Remove button (`×`) in a 22px ghost button in the rightmost column, revealed on row hover.

### 9.6 Ticker hero block

4-column grid (`2fr 1fr 1fr 1fr`), 1px gapped, rule-bordered. See 8.2 for spec.

### 9.7 Portfolio row (home list)

```
grid-template-columns: 40px 1fr 160px 180px 140px;
```

`idx · name/meta · sparkline · value/delta · actions (hover-revealed)`. 14px 16px padding, hover fills `bg-1`, sparkline bars swap from `ink-3` to cyan on hover.

### 9.8 Layer toggle (simulation)

Segmented, 3px padding inside `bg-1` with a 1px `rule` border. Each segment is a 10px mono UPPER button with a 6px square status dot (`ink-3` lock, `amber` edit). Active segment sits on `bg-3`.

---

## 10. Iconography

**The product has essentially no icons.** Source indicators are colored bars, status is dots, hierarchy is type.

If an icon is genuinely required (e.g. a third-party settings panel, an unavoidable UI affordance), load **Lucide** from CDN at 14px or 16px stroke 1.5, color `currentColor`. Flag the addition to the user — icons are not part of the base system.

No emoji. No Font Awesome. No hand-drawn SVG illustrations. Ever.

---

## 11. Layout

- **Page shell.** `max-width: 1200px`, centered, `padding: 28px 28px 60px`.
- **Masthead.** Full-width, sits above the shell.
- **Section spacing.** 24–32px between major blocks.
- **Hairline rules** separate sections — never blank whitespace alone for major divisions.
- **Ticker row** always sits between the page header and the tab bar.

Tables and lists bleed to the page edge via negative margin (`margin: 0 -16px; padding: 14px 16px`) so row hovers extend cleanly past text content.

---

## 12. System behaviors

These are product-level rules the designer commits to, not CSS. Document once, implement in one place, reuse everywhere.

### 12.1 Staleness thresholds

One function, `classifyStaleness(lastUpdateMs)`, drives the masthead live-cell, the ticker-cell dots, and the row-level "updated Xm ago" meta.

| Age | Class | Visual | Masthead label |
|---|---|---|---|
| ≤ 30s | `live` | Green **pulsing** dot | `LIVE · EUR · 14:32 CET` |
| 30s – 5m | `recent` | Cyan steady dot | `UPDATED 3m AGO` |
| 5m – 1h | `stale` | Amber steady dot | `STALE · 12m AGO` |
| > 1h | `disconnected` | Red steady dot | `DISCONNECTED · 4h AGO` |

Only `live` pulses. The same classifier picks the color for the hero ticker-cell dot on the detail screen.

### 12.2 Number format

Locked to `de-DE` everywhere. Build once, import everywhere.

```js
// format.js — the only place these are constructed
const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shareFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export const eur = n => eurFmt.format(n).replace('-', '−');                    // 1.234,56 €
export const signedEur = n => (n >= 0 ? '+' : '−') + eurFmt.format(Math.abs(n));
export const pct = n => pctFmt.format(n / 100).replace('-', '−');              // 12,40 %
export const signedPct = n => (n >= 0 ? '+' : '−') + pctFmt.format(Math.abs(n) / 100);
export const shares = n => shareFmt.format(n);
```

Output examples: `436.207,16 €` · `+4.215,20 €` · `−294,00 €` · `+2,80 %` · `257,6400`.

### 12.3 Empty & error states

One pattern, centered in the container, no illustrations.

```
NO PORTFOLIOS                    ← .ds-label (mono UPPER, ink-2, red if error)
Create one to start modeling.    ← .ds-body (ink-1)
[ + New portfolio ]              ← primary button (or Retry / Reconnect)
```

- **Empty list** → mono label + sentence + primary action, centered.
- **Empty table** → same pattern inline, as a single full-span `<tr><td colspan>…</td></tr>`.
- **Error** → identical shape; label in red (`CSV FAILED`, `STALE QUOTE`, `DISCONNECTED`), second line explains, action is `Retry` / `Reconnect`. Never a modal.
- **Loading** → do not use spinners. Show `—` in place of the figure and set the masthead to amber `FETCHING…`.

### 12.4 Simulation delta semantics

Simulated positions compare **vs. their hypothetical buy-in price** (the price at which the sim position was added). Column header: `Gain since add`. This tells the operator "how is this specific hypothetical trade doing?"

Worked example: add 50 AAPL at 246,00 € in simulation. Tomorrow AAPL is 250,00 €. Row shows `+200,00 € · +1,63 %`. The base portfolio's 72 existing shares are untouched by the sim layer.

A "blended view" that merges sim + base cost basis is not part of v1.

### 12.5 Persistence

- **Primary store.** `localStorage` under key `ptsim.v1`. Single JSON blob, written on every state mutation, read once at boot.
- **Export.** `Backup` in the row menu downloads `ptsim-backup-YYYY-MM-DD.json`. Human-readable, git-able.
- **Import.** File picker on Home; confirms inline (row-level banner), replaces or merges. Never a modal.
- **No IndexedDB, no cloud, no account.** Local only.

### 12.6 Icon policy

No icon library loaded by default. Five text-glyph exceptions:

| Need | Glyph | Notes |
|---|---|---|
| Close / remove | `×` (U+00D7) | In a 22px ghost button |
| Chevron | `▾` (U+25BE) | `ink-2`, mono |
| Sort indicator | `▲` / `▼` | Cyan when active, `ink-3` when inactive |
| Breadcrumb separator | `·` (U+00B7) | `ink-3` |
| External link hint | `↗` (U+2197) | `ink-2`, trailing |

Anything beyond this is a conversation, not a new dependency.

---

## 13. Accessibility

- **Contrast.** All ink-on-bg combinations pass WCAG AA at their size. `ink-3` (`#4A5057`) is AA-large only — use it for ≥14px text.
- **Focus.** 2px cyan ring on every interactive element. Never remove.
- **Motion.** `prefers-reduced-motion` disables live-dot pulse and all transitions.
- **Color-only state.** Gain/loss is always paired with a sign (`+`/`−`) and sometimes with directional micro-copy; never color alone.
- **Keyboard.** Every interactive surface is tab-reachable in visual order. No custom shortcuts — the product is click-and-tab only.
- **Screen readers.** Masthead NAV cell uses `aria-live="polite"` so refreshes announce without flooding.
- **Semantic tables.** Use `<table>/<thead>/<tbody>` — never div-tables.

---

## 14. File index

| Path | Purpose |
|---|---|
| `README.md` | This document — the canonical spec |
| `SKILL.md` | Agent skill entry point |
| `colors_and_type.css` | All tokens + `.ds-*` semantic type classes + base reset |
| `assets/` | Logo mark, wordmark, favicon (placeholders — flag to user if used in production) |
| `preview/colors.html` | Color swatch specimen |
| `preview/typography.html` | Type scale specimen |
| `preview/components.html` | Buttons, badges, inputs, ticker cells |
| `preview/table.html` | Positions table specimen |
| `preview/brand.html` | Masthead + mark lockups |
| `ui_kits/app/` | Interactive recreation of Home + Portfolio Detail + Simulation |
| `directions/terminal.html` | Self-contained reference build of the full app |
| `directions/editorial.html` | Archived alternate direction (not in use) |
| `directions/canvas.html` | Design-canvas view of both directions |
| `static/`, `templates/` | Imported upstream source — reference only, not part of the design system |

---

## 15. Quick start

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="dark">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="colors_and_type.css">
</head>
<body>
  <!-- your terminal goes here -->
</body>
</html>
```

Use `.ds-hero`, `.ds-h1`–`.ds-h3`, `.ds-body`, `.ds-label`, `.ds-kicker`, `.ds-micro`, `.ds-number` for type. Use `.up` / `.down` / `.live` / `.warn` for semantic color. Wrap every figure in `.ds-number` so it picks up tabular figures.

---

## 16. The five rules, posted on the wall

1. **Square corners.** `border-radius: 0`.
2. **No shadows.** Depth is tonal.
3. **Mono for numbers.** Tabular, always.
4. **Accents are semantic.** Cyan / amber / green / red mean something.
5. **Density is the feature.** When in doubt, make it smaller and tighter.

If you're unsure whether a change belongs in the system, ask: *does an operator scanning this screen in their twelfth hour of the day read it faster?* If yes, ship it. If no, don't.
