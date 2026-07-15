---
title: Client-Side Surplus Cue for /plan Detailed-Overview - Plan
type: feat
date: 2026-07-15
topic: detailed-overview-surplus-cue
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
origin: GitHub issue #30 (https://github.com/icon3333/prismo/issues/30); sibling plan docs/plans/2026-07-14-003-fix-symmetric-target-deviation-plan.md (deferred this surface)
---

# Client-Side Surplus Cue for /plan Detailed-Overview - Plan

## Goal Capsule

- **Objective:** Make the `/plan` Detailed-Overview read symmetrically by rendering an amber "N positions over target" cue — computed **client-side** with the existing `computePositionDeviation` helper, mirroring the surplus dot the same page's rebalance table already shows.
- **Product authority:** the user (single-user homeserver app; sole user of `/plan`).
- **Tail ownership:** standalone — this run implements, verifies, and ships.
- **Approach decision:** client-compute, reversing this plan's original server-side construct. A `ce-doc-review` cross-persona finding (product-lens + adversarial, independently) showed the surplus is fully computable from data already in scope in `detailed-overview.tsx`; a server field would duplicate a computation the client already does three times across its sibling surfaces and require a parity test to police the copies. Verified against the code before rewriting (see Sources).
- **Follow-up:** update GitHub issue #30 (whose title says "server-side construct") to record that this shipped client-side.
- **Open blockers:** none.

---

## Summary

Render a compact amber "N positions over target" cue on the `/plan` Detailed-Overview when the selected portfolio holds more real positions than its effective target. It is computed client-side via `computePositionDeviation(effectivePositions, currentRealPositions)` — the same shared helper and the same current-count derivation the sibling rebalance table uses — so the two always agree by construction. One file changes (`detailed-overview.tsx`); no backend change, no new server fields, no type widening, no new tests. The three already-shipped client surfaces, the simulator, and the deficit ("Missing Positions") construct are untouched.

---

## Problem Frame

The `/plan` Detailed-Overview is the last surface still one-directional after the symmetric-deviation work (sibling plan `2026-07-14-003`, PR #29): it renders a server-computed, deficit-only "Missing Positions" sector (`app/services/allocation_service.py:428-447`) and nothing for the over-target case. A surplus can't mirror the deficit literally — there are no "negative slots" to synthesize — so it must be a count rendered as a cue.

The cue does not need a backend. `detailed-overview.tsx` already binds the portfolio's `rebalanced[]` entry (`rebalancedPortfolio`, a `RebalancedPortfolio` carrying `sectors`, `desiredPositions`/`minPositions`, and `currentValue`) — the same data the on-page rebalance table derives its surplus dot from via the shared `computePositionDeviation` helper. Computing the Detailed cue from that same entry reuses a tested helper, guarantees agreement with the sibling dot, and adds zero server surface.

---

## Key Decisions

- **Client-compute, not server-side.** Reuse the existing `computePositionDeviation` helper in `detailed-overview.tsx`. Chosen over emitting a new `rebalance_service` field because: parity with the sibling surfaces is guaranteed by shared-helper reuse (no policing test), there is no new backend surface for a single-maintainer app, and it avoids a split-brain where one surface is server-computed and three are client-computed. The one payoff of the server path — making the server authoritative for deviation everywhere — is speculative (the client already ignores the server's existing deficit flag).
- **Mirror the rebalance table's surplus dot exactly** — same helper, same current-count derivation, same `currentValue > 0` guard — so the Detailed cue and the table dot always show the same thing for the same portfolio, and empty portfolios show "Empty - Needs Positions" rather than a surplus cue.
- **A count cue, not a fabricated sector.** A compact amber banner, no fabricated position rows (a surplus has no real "slots" to list).

---

## Requirements

- **R1.** The `/plan` Detailed-Overview shows an amber "N positions over target" cue when the selected portfolio holds more real positions than its effective target and holds value.
- **R2.** The cue is computed client-side via `computePositionDeviation(effectivePositions, currentRealPositions)`, using the same current-count derivation as the rebalance table, so the Detailed cue and that table's surplus dot always agree.
- **R3.** No fabricated position rows; the existing Missing Positions (deficit) sector rendering and the exact-match calm state are unchanged.
- **R4.** No backend change; the three already-shipped client surfaces (`/plan` target rows, rebalance cue, dashboard callout), the simulator, and the deficit construct are untouched.

---

## Acceptance Examples

- **AE1. Covers R1, R2.** A portfolio with an effective target of 1 holding 6 real positions (with value) → the Detailed-Overview shows "5 positions over target" in amber.
- **AE2. Covers R3.** An under-target portfolio → the Missing Positions sector still renders as today; no surplus cue.
- **AE3. Covers R3.** A portfolio holding exactly its effective target → neither the sector nor the cue (calm).
- **AE4. Covers R1.** An empty portfolio (`currentValue === 0`) → no surplus cue (the existing "Empty - Needs Positions" treatment applies instead), matching the rebalance table's guard.
- **AE5. Covers R2.** For the same over-target portfolio, the Detailed cue's count equals the rebalance table's "N over target" dot tooltip.

---

## Scope Boundaries

**Deferred to Follow-Up Work:**

- Extract the duplicated current-position-count derivation — now inlined in `rebalance-plan.tsx`, `overview-calc.ts`, and (after this change) `detailed-overview.tsx` — into one shared, tested helper. A worthwhile cleanup, but out of scope for this cue; inlining here matches how the two siblings already do it.

**Outside scope — unchanged by design:**

- The backend (`rebalance_service` / `allocation_service`) — no change; the deficit "Missing Positions" construct is preserved.
- The three already-shipped client surfaces and the simulator investment-progress bar.

---

## Dependencies / Assumptions

- `RebalancedPortfolio` extends `Portfolio` (`frontend/src/types/portfolio.ts:52-83`), carrying `sectors`, `desiredPositions?`/`minPositions?`/`effectivePositions?`, and `currentValue`; `detailed-overview.tsx:48-50` already binds `rebalancedPortfolio` (the matching `rebalanced[]` entry), so all inputs are in scope with no new plumbing.
- The cue uses `desiredPositions ?? minPositions` — the exact target expression the rebalance dot uses — so AE5 parity is by construction; this equals `effectivePositions` (set together per portfolio in `app/services/allocation_service.py:378-391`), so it also matches the dashboard callout.
- "Over target" uses strict integer count comparison, no tolerance band (the helper's existing behavior).

---

## Implementation Units

### U1. Client-side surplus cue on the /plan Detailed-Overview

- **Goal:** Render the amber "N positions over target" cue in the Detailed-Overview from a client-side computation that mirrors the rebalance table's surplus dot.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** none.
- **Files:** `frontend/src/app/(dashboard)/plan/detailed-overview.tsx`.
- **Approach:** The component already binds `rebalancedPortfolio` (`detailed-overview.tsx:48-50`) — the same `rebalanced[]` entry the on-page rebalance table computes its surplus dot from, and the source of the `detailed` the table renders. Compute the cue from it (not from `selected`) so parity is truly by construction rather than dependent on two arrays matching. Import `computePositionDeviation` from `@/lib/builder-calc`. Derive `desired = rebalancedPortfolio.desiredPositions ?? rebalancedPortfolio.minPositions ?? 0` and `currentPositions` = sum over `rebalancedPortfolio.sectors`, excluding the `"Missing Positions"` sector, of `s.positions?.length ?? s.positionCount ?? 0` — the exact expressions the rebalance dot uses (`rebalance-plan.tsx:230-233`). Take `surplus` from `computePositionDeviation(desired, currentPositions)`. Render a compact amber banner — `⚠ {surplus} position{surplus > 1 ? "s" : ""} over target` — as the first element **inside the successful-table render branch** (the `selected && sectors.length > 0 && detailed` case at ~`:85`, above the `<Table>`), additionally gated by `surplus > 0 && (rebalancedPortfolio.currentValue || 0) > 0`. Rendering inside that branch matters: `detailed` truthy implies `rebalancedPortfolio` is defined, so there is no undefined dereference on the no-selection render path (where `selected`/`detailed` are undefined), and the cue can never co-appear with the "No positions" fallback. The `currentValue` guard mirrors the rebalance dot so empty portfolios keep the "Empty - Needs Positions" treatment. Wrap the decorative `⚠` glyph in `aria-hidden` (matching the expand arrows / amber dots), and style with the `text-amber` token. Leave the Missing Positions sector rendering and the exact-match calm state untouched.
- **Execution note:** Pure render reusing the already-tested `computePositionDeviation`; no new logic to unit-test. Verify visually on `/plan`.
- **Patterns to follow:** the rebalance surplus dot — derivation, helper call, `currentValue` guard, and singular/plural rule — at `frontend/src/app/(dashboard)/plan/rebalance-plan.tsx:230-273`; the amber token facts in `frontend/src/app/globals.css` (`--amber`); the existing sibling banners (`<p>` empty-states) in `detailed-overview.tsx`.
- **Test scenarios:** `Test expectation: none` — pure-render change reusing `computePositionDeviation`, which is already table-tested in `frontend/src/lib/__tests__/builder-calc.test.ts`. The repo has no RTL/jsdom (vitest `node` env, `src/**/*.test.ts` only), so there is no new behavioral logic to unit-test. Behavioral proof is AE1–AE5, manual (see Verification Contract).
- **Verification:** On `/plan`, an over-target portfolio's Detailed-Overview shows the amber cue with the correct count, and that count matches the rebalance table's surplus dot for the same portfolio (AE5); under-target still shows the Missing Positions sector; exact-match and empty portfolios show neither. `cd frontend && npm run build` (type check) and `npm run lint` clean.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Frontend type check | `cd frontend && npm run build` (or `npx tsc --noEmit`) | U1 |
| Lint | `cd frontend && npm run lint` | U1 |
| Existing helper unit tests (unchanged; regression) | `cd frontend && npm test` | `computePositionDeviation` still green |
| Behavioral (no component-test infra) | Manual on `/plan` Detailed-Overview | AE1–AE5 |

Behavioral verification is required because the repo has no component-test harness: exercise `/plan` with an over-target portfolio (cue appears, count matches the rebalance dot), an under-target portfolio (Missing Positions sector still appears), an exact-match portfolio (neither), and an empty portfolio (no cue), per AE1–AE5. The Denis Demo account holds the canonical over/under-target scenario.

---

## Definition of Done

- The Detailed-Overview shows the amber cue for over-target portfolios, with the count matching the rebalance table's surplus dot; no fabricated rows; under-target, exact-match, and empty portfolios are unchanged (AE1–AE5 verified manually).
- The cue is computed client-side via the shared `computePositionDeviation`; no backend change, no new server fields, no type widening; parity is by construction.
- `rebalance_service`, the three already-shipped client surfaces, and the simulator are untouched.
- `cd frontend && npm run build` and `npm run lint` are green; existing unit tests still pass.
- No dead-end / experimental code left in the diff.
- GitHub issue #30 updated to record that this shipped client-side.

---

## Outstanding Questions

**Deferred to Implementation (non-blocking):**

- Exact cue presentation — a concise inline `text-amber` line ("⚠ N positions over target") vs a bordered amber strip mirroring the Missing Positions left-border. Default: inline `text-amber` line; refine at review.

---

## Sources / Research

Verified against the code before rewriting (this session):

- **Data availability (the decision hinge).** `detailed-overview.tsx:42-50` — the component derives both `selected` (a `Portfolio` from `portfolioData.portfolios`) and `rebalancedPortfolio` (the matching `rebalanced[]` entry, a `RebalancedPortfolio` extending `Portfolio`). The cue computes from `rebalancedPortfolio` — the same entry the rebalance dot uses — carrying `sectors`, `desiredPositions`/`minPositions`, and `currentValue` (`frontend/src/types/portfolio.ts:52-83`). All inputs are in scope with no new plumbing.
- **The shared helper.** `frontend/src/lib/builder-calc.ts:56-68` — `computePositionDeviation(target, current)` returns `{ deficit, surplus, offTarget }` and returns all-zero / `offTarget:false` when `target == null || target <= 0`. Table-tested in `frontend/src/lib/__tests__/builder-calc.test.ts`.
- **The derivation to mirror.** `frontend/src/app/(dashboard)/plan/rebalance-plan.tsx:230-273` — `desired = p.desiredPositions ?? p.minPositions ?? 0`; `currentPositions = sectors excluding "Missing Positions", summing (positions?.length ?? positionCount ?? 0)`; surplus dot guarded by `surplus > 0 && (p.currentValue || 0) > 0`, tooltip `"{surplus} over target"`, plural rule `surplus > 1 ? "s" : ""`. `frontend/src/lib/overview-calc.ts:114-142` — the dashboard callout uses the same count derivation with `computePositionDeviation(portfolio.effectivePositions, currentPositions)`, confirming `effectivePositions` is the target field and the two siblings agree.
- **Why the reversal.** `ce-doc-review` on the original server-side plan surfaced a P1 cross-persona finding (product-lens + adversarial, independently): the Detailed-Overview has every input the helper needs, so a server field would reproduce a client computation the client already does three times across its sibling surfaces (two on `/plan`, one on the dashboard) and require a parity test to police the two copies. The client path removes the backend edit to the parity-tested rebalance engine, the type widening, and that test.
- **No institutional learnings** — `docs/solutions/` does not exist in this repo.
