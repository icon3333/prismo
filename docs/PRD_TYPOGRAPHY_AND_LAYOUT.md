# PRD: Typography Scale & Layout Rhythm

## Problem Statement

The app has **two parallel type systems and no governing scale**. `globals.css` tokenizes
color, spacing (`--sp-*`), and control heights (`--btn-h`, `--input-h`) — but has **zero
typography tokens**. Every font size is hardcoded ad-hoc, producing **11 distinct sizes**
(9, 10, 11, 12, 13, 14, 18, 22, 24, 30, 40px) plus the full Tailwind named set.

### The split

| Layer | Font | Sizes today | Surfaces |
| --- | --- | --- | --- |
| **Chrome** (mono) | JetBrains Mono | 9 / 10 / 11 / 12 / 13 px | masthead, nav, buttons, badges, inputs, selects, dropdowns, tables |
| **Content** (sans) | Inter | 12 / 14 px (`text-xs` ×128, `text-sm` ×129), titles 16–24 | page bodies, prose, headings |

### Confirmed user complaint — "the top bar fonts seem too small"

The masthead is `text-[11px]` mono. Directly below, page content runs at `text-sm` = **14px**
sans. Two compounding effects: (1) a 3px absolute gap, and (2) mono has a smaller x-height
than Inter at the same nominal size, so 11px mono looks ~1px smaller still. The chrome reads
as undersized against the content it frames.

### Other friction

1. **Page titles are chaotic** — "h1/h2" headings span `text-2xl, text-xl, text-lg, text-base,
   text-sm, text-xs`. The new `PageHeader` standardizes `text-2xl` but most pages predate it,
   and Overview uses its own `text-xl`/`text-2xl uppercase` set.
2. **Sub-legible floor** — `Badge` and enrich source tags are `text-[9px]`; 22 files use
   `text-[10px]`. 9px mono is below comfortable legibility.
3. **Implicit, leaky mono/sans rule** — "chrome=mono, content=sans" is never written down, so
   small content sometimes goes sans at 10px (e.g. `allocation-table`), inconsistently.

---

## Goal

Introduce **one tokenized type scale**, expressed as Tailwind v4 `@theme` font-size tokens,
that **preserves the deliberate terminal density** while removing the friction:

- Nudge the primary chrome tier **11 → 12px** so the top bar reads as intentional, not shrunken.
- **Eliminate 9px** everywhere; cap the floor at 10px and only for uppercase tracked labels.
- **Standardize page titles** to a single size via the existing `PageHeader`.
- Write down the **mono = chrome / sans = content** rule.

Non-goal: a cosmetic enlargement of the whole app. The terminal density is intentional and stays.

---

## The Type Scale (8 role tokens)

Defined once in `globals.css` (`@theme`). Each token mints a Tailwind utility
(`text-micro`, `text-chrome`, …) with a paired line-height.

| Token | px / line-ht | Font | Role | Replaces |
| --- | --- | --- | --- | --- |
| `text-micro`   | 10 / 14 | mono | Eyebrow caps: badges, source tags, table column headers, menu group labels, kbd | **9px** + scattered 10px |
| `text-chrome`  | **12** / 16 | mono | All interactive chrome: masthead, nav tabs, buttons, inputs, selects, dropdown items, tooltips | **11px** + chrome 12px |
| `text-data`    | 13 / 18 | mono | Table body cells, tab-panel data | 13px |
| `text-body-sm` | 12 / 16 | sans | Secondary / muted content | `text-xs` (alias) |
| `text-body`    | 14 / 20 | sans | Default content prose | `text-sm` (alias) |
| `text-section` | 16 / 22 | sans | Section headings, dialog titles | `text-lg`/`text-xl`/18px |
| `text-title`   | 20 / 26 | sans | Page `<h1>` (PageHeader) | `text-2xl` + h1 spread |
| `text-display` | 22 / 26 | mono | Hero metric numbers | `text-[22px]`, `text-[40px]` |

**Sans-body equivalence (efficiency note):** Tailwind's defaults `text-sm` (14px) and `text-xs`
(12px) already equal `text-body` and `text-body-sm`. We do **not** rename the ~257 existing
`text-sm`/`text-xs` content usages — zero visual change for a huge diff. New code prefers the
semantic names; the aliases remain valid for sans content.

---

## The Rule (written down)

> **Mono = chrome. Sans = content.** Chrome is the terminal frame (nav, controls, tables,
> labels, metrics). Content is what the user reads and writes (prose, headings, descriptions).
> Small text never drops below `text-micro` (10px), and only at that size when it is an
> uppercase, letter-spaced label.

---

## Layout / Heading Rhythm

1. **One page-title size** — every page renders through `<PageHeader>` → `text-title` (20px).
   Kills the `text-2xl`/`text-xl`/`text-lg`/`text-base` h1 spread, including Overview's
   bespoke uppercase headings.
2. **Heading hierarchy** — `text-title` (page) → `text-section` (16px, blocks/dialogs) →
   `text-body`. A real 3-step ladder instead of 6 random sizes.
3. **Masthead** — 12px chrome verified to hold in the 40px (Row 1) / 32px (Row 2) rows. No
   structural change. **The nav/picker relayout is owned by
   `docs/PRD_PORTFOLIO_SELECTOR_AND_NAV.md`** — out of scope here.
4. **Spacing** — `--sp-*` tokens exist but are underused. A light consistency pass is allowed
   opportunistically; not a focus of this PRD.

---

## Implementation Plan

> Frontend-only. No backend, schema, or migration impact. Token-first, mechanical, low-risk —
> adding new utilities does not remove Tailwind defaults, so migration is incremental and safe.

### Step 1 — Define tokens (`frontend/src/app/globals.css`)
Add the 8 `--text-*` tokens (+ `--text-*--line-height`) to the `@theme inline` block, beside
the existing font stacks.

### Step 2 — Migrate UI primitives (`frontend/src/components/ui/`)
The highest-leverage edits — these cascade to most of the app:
- `badge.tsx`: `text-[9px]` → `text-micro`
- `button.tsx`: default/lg/sm/xs `text-[10/11px]` → `text-chrome` (compactness comes from
  height/padding, not font shrink)
- `table.tsx`: header `text-[10px]` → `text-micro`; body `text-[13px]` → `text-data`;
  caption `text-[12px]` → `text-body-sm`
- `input.tsx`, `select.tsx`, `dropdown-menu.tsx`: control values `text-[12px]` → `text-chrome`;
  group labels `text-[10px]` → `text-micro`
- `tabs.tsx`: trigger `text-[11px]` → `text-chrome`; panel `text-[13px]` → `text-data`
- `tooltip.tsx`: `text-[11px]` → `text-chrome`
- `dialog.tsx`: title `text-[18px]` → `text-section`; body `text-[13px]` → `text-body-sm`;
  description `text-[12px]` → `text-body-sm`
- `popover.tsx`, `textarea.tsx`: `text-[12px]` → `text-chrome`
- `sonner.tsx`: label `text-[10/11px]` → `text-micro`/`text-chrome`; description → `text-body-sm`
- Icon glyphs (`×` 14px, `✓` 10px) are intentionally left as arbitrary px — they are glyph
  metrics, not type roles.

### Step 3 — Masthead (`frontend/src/components/ptsim/Masthead.tsx`)
All `text-[11px]` chrome (brand, NAV, LIVE, ANON, theme, ACCT, Row 2 nav tabs) → `text-chrome`.
This is the direct fix for the reported complaint.

### Step 4 — Page headers
- `PageHeader` `text-2xl` → `text-title`.
- Adopt `<PageHeader>` (or `text-title`) on pages with bespoke h1s: Overview, Account,
  Simulator, and any error/loading branches that render their own `<h1>`.

### Step 5 — Page-level stray sizes
Sweep remaining `text-[9/10/11/12/13px]` and `text-[22px]`/`text-[40px]` in
`app/(dashboard)/**` to the semantic tokens (`text-micro`/`chrome`/`data`/`display`).
Fix the sans-10px leaks (e.g. `allocation-table`) to `text-body-sm`.

### Step 6 — Style guide
Update `app/theme/page.tsx` to showcase the scale (living reference).

### Step 7 — Verify
`cd frontend && npm run lint` passes; dev build renders; spot-check masthead, a table page,
and a dialog in both themes.

---

## Acceptance Criteria

1. 8 `--text-*` tokens exist in `@theme`; `text-micro/chrome/data/body/body-sm/section/title/display`
   resolve as utilities.
2. **No `text-[9px]` anywhere** in the codebase.
3. Masthead and nav tabs render at **12px** (`text-chrome`).
4. Every page title renders at `text-title` (20px); no page uses `text-2xl`/`text-xl` for its `<h1>`.
5. All UI primitives reference semantic tokens — no arbitrary `text-[NNpx]` left in
   `components/ui/`.
6. The mono/sans rule is documented (this PRD + a comment in `globals.css`).
7. `npm run lint` passes; no TypeScript errors.

---

## Out of Scope

- Nav / portfolio-picker relayout — owned by `docs/PRD_PORTFOLIO_SELECTOR_AND_NAV.md`.
- Blind rename of `text-sm`/`text-xs` content usages (they already equal `text-body`/`text-body-sm`).
- Color-token changes.
- Spacing-system overhaul (light opportunistic pass only).
