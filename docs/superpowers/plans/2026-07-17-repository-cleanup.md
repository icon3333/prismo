# Prismo Repository Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete documentation and duplicated GitNexus scaffolding without changing Prismo behavior.

**Architecture:** Preserve the live application, its tests, and the two active design references. Make `AGENTS.md` the only GitNexus contract and keep `CLAUDE.md` focused on Prismo-specific commands and architecture.

**Tech Stack:** Markdown, Git, Python/pytest, Next.js/Vitest

## Global Constraints

- Do not modify application source, dependencies, lockfiles, tests, CI, or environment examples.
- Preserve `docs/design_readme.md`, `docs/colors_and_type.css`, `run.py`, `start.py`, and `dev.sh`.
- Do not publish or change GitHub repository settings.

---

### Task 1: Remove completed and duplicated repository scaffolding

**Files:**
- Delete: `docs/archive/`
- Delete: `docs/plans/`
- Delete: `frontend/README.md`
- Delete: `.agents/skills/gitnexus/`
- Modify: `CLAUDE.md:145-end`

**Interfaces:**
- Consumes: current `AGENTS.md` GitNexus contract
- Produces: one authoritative GitNexus contract and no completed planning residue in the current tree

- [ ] **Step 1: Record baseline references**

Run: `rg -n '\.agents/skills|docs/(archive|plans)|frontend/README|gitnexus:start' --glob '!docs/archive/**' --glob '!docs/plans/**'`

Expected: GitNexus markers in `AGENTS.md` and `CLAUDE.md`; no live source dependency on the removal targets.

- [ ] **Step 2: Delete the stale paths**

Delete the four paths listed above. In `CLAUDE.md`, remove the complete block from `<!-- gitnexus:start -->` through `<!-- gitnexus:end -->`, leaving the preceding Prismo configuration section intact.

- [ ] **Step 3: Verify references and whitespace**

Run: `rg -n '\.agents/skills|docs/(archive|plans)|frontend/README' --glob '!.git/**' || true`

Expected: no output.

Run: `git diff --check`

Expected: exit 0 with no output.

- [ ] **Step 4: Run existing verification**

Run: `./test.sh`

Expected: backend pytest and frontend Vitest both pass.

Run: `cd frontend && npm run build`

Expected: Next.js production build exits 0.

- [ ] **Step 5: Remove transient planning artifacts and commit**

Delete `docs/superpowers/`, then run:

```bash
git add -A
git commit -m "chore: remove obsolete repository scaffolding"
```

Expected: commit contains only the approved deletions and the `CLAUDE.md` consolidation.
