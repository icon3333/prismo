---
title: "refactor: Remove duplicated Allocation Rules panel from Concentrations tab"
date: 2026-07-14
type: refactor
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
depth: lightweight
---

# refactor: Remove duplicated Allocation Rules panel from Concentrations tab

## Summary

The "Allocation Rules" editing panel appears on both the **Plan** tab and the **Concentrations** tab. Both instances edit the exact same persisted state, so they are a true duplicate. Remove the panel from Concentrations; Plan remains the single place to edit these limits. This is a pure UI-surface removal — no calculation, persistence, or Plan behavior changes.

---

## Problem Frame

`RulesSection` (`frontend/src/components/domain/rules-section.tsx`) renders the "Allocation Rules" card with five limit fields (max % per Stock / ETF / Crypto / Sector / Country). It is mounted in two pages:

- **Plan** — `frontend/src/app/(dashboard)/plan/page.tsx:81`, wired to `builder.rules` / `builder.setRule`.
- **Concentrations** — `frontend/src/app/(dashboard)/concentrations/page.tsx:131` via the `LimitsPanel` wrapper, which reads/writes the **same** `rules` key of the `builder` page-state.

Because both surfaces mutate the identical `builder` state key, editing on one silently changes the other — pure duplication with no benefit. Worse, the Concentrations page **does not consume** these rules: `use-concentrations.ts` never reads `rules`, and `ConcentrationHeatmap` colors cells by hardcoded ranges (`0–5 / 5–15 / 15–30 / 30–100`), not by the configured limits. So the panel on Concentrations is an orphan editor whose neighboring comment ("The limits monitored above are edited here too") is misleading — nothing above it is monitored against those limits.

Removing it leaves one clear editing home (Plan) and one clear consumer of the limits (the Overview violation panels via `use-overview.ts` → `overview-calc.ts`, which read the same `builder` `rules` key and are unaffected).

---

## Requirements

- **R1** — The Allocation Rules editing card no longer renders on the Concentrations page.
- **R2** — Allocation Rules remain fully editable on the Plan page (unchanged).
- **R3** — Stored limit values, their persistence key (`builder` page-state `rules`), and every other consumer (Plan targets, Overview violation panels) are untouched — no data migration, no default changes.
- **R4** — The Concentrations page's own displays (distribution charts, holdings, heatmap, portfolio filter) are unchanged.

---

## Key Technical Decisions

- **Delete `limits-panel.tsx` outright rather than leave it unused.** `LimitsPanel` is imported only by `concentrations/page.tsx` (verified: the sole non-definition references are that page's import and JSX usage). Once the page stops using it, the file is dead code — remove it so the build carries no orphan. `RulesSection` stays; it is still Plan's editor.
- **No shared-component or type changes.** `RulesSection`, `AllocationRules` (`frontend/src/types/builder.ts`), `DEFAULT_RULES` in `use-builder.ts`, and the `builder` `rules` persistence all remain exactly as-is — this change only unmounts a second instance, it does not alter the feature.
- **Side benefit, not a goal:** removing `LimitsPanel` also removes the only place the Concentrations page touched `page=builder` state (it otherwise persists under `risk_overview`), eliminating the fragile "hydrate full builder state before writing `rules`" dance that `LimitsPanel` had to perform to avoid clobbering budget/portfolio keys.

---

## Implementation Units

### U1. Remove the Allocation Rules panel from Concentrations

**Goal:** Stop rendering the duplicated Allocation Rules editor on the Concentrations tab and delete its now-orphaned wrapper. (R1, R2, R3, R4)

**Dependencies:** none.

**Files:**
- `frontend/src/app/(dashboard)/concentrations/page.tsx` — modify: remove the `import { LimitsPanel } from "./limits-panel";` line, and remove the trailing `<LimitsPanel />` JSX (line ~131) together with its preceding explanatory comment (lines ~129–130).
- `frontend/src/app/(dashboard)/concentrations/limits-panel.tsx` — delete: dead once U1's page edit lands (no other importer).

**Approach:**
- Both edits must land together — deleting the file without removing the import breaks the TypeScript build. Treat as one atomic change.
- Leave the rest of `concentrations/page.tsx` (the chart grid, `ConcentrationHeatmap`, `PortfolioFilter`, loading/error/skeleton states) exactly as-is. The removed panel sat below the heatmap; no layout container depends on it.
- Do **not** touch `plan/page.tsx`, `rules-section.tsx`, `use-builder.ts`, `use-overview.ts`, `overview-calc.ts`, or `types/builder.ts`.

**Patterns to follow:** none introduced — this is a straight removal mirroring the existing page structure.

**Test scenarios:** `Test expectation: none` — the repo's frontend tests cover only pure `src/lib/*-calc` modules (see `frontend/src/lib/__tests__/`); there is no page/component render harness, and no existing test references `LimitsPanel` or the Concentrations page. This unit removes UI with no calc surface, so it adds no unit test. Verification is by typecheck/lint + a visual render check (below).

**Verification:**
- `cd frontend && npm run lint` passes with no unused-import or unresolved-module errors (confirms the import was removed and nothing else imported the deleted file).
- Concentrations page renders without the "Allocation Rules" card and without console errors; all charts and the heatmap still display.
- Plan page still shows the "Allocation Rules" card and edits still save.
- Editing a limit on Plan, then reopening Plan, shows the saved value (confirms persistence path is intact).

---

## Scope Boundaries

**In scope:** Removing the Allocation Rules editing surface from the Concentrations tab and deleting its orphaned wrapper file.

**Explicitly unchanged (not non-goals — guardrails):**
- `RulesSection` shared component — still Plan's editor.
- `builder` page-state `rules` key, `AllocationRules` type, `DEFAULT_RULES` — no schema/default/persistence changes.
- Overview violation panels — continue reading the same limits.
- All Concentrations displays (charts, top holdings, heatmap, portfolio filter, include-cash toggle).

### Deferred to Follow-Up Work
- The `ConcentrationHeatmap` colors by hardcoded thresholds rather than the user's configured limits. Wiring the heatmap (or any Concentrations visual) to actually *monitor against* the allocation limits is a separate feature, not part of this removal. Noted only so it is not silently lost when the "limits monitored above" comment disappears.

---

## System-Wide Impact

Blast radius (traced by reference search, not just symbol name): `LimitsPanel` has exactly one caller (`concentrations/page.tsx`); removing both the caller line and the file affects nothing else. `RulesSection` retains its Plan caller. No backend, no API, no persisted-data, no cross-page state contract changes. Risk: **low**.
