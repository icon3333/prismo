# Prismo Repository Cleanup Design

## Goal

Reduce repository noise without changing Prismo's runtime behavior, developer commands, test coverage, design authority, or application architecture.

## Scope

- Remove `docs/archive/`, whose own README states that its contents do not describe current behavior.
- Remove the three completed implementation plans under `docs/plans/`; Git history remains the historical record.
- Remove the unchanged Create Next App boilerplate at `frontend/README.md`.
- Keep `AGENTS.md` as the single GitNexus operating contract.
- Remove the duplicated GitNexus block from `CLAUDE.md` while preserving its Prismo-specific architecture and command guidance.
- Remove the six generic, vendored GitNexus skills under `.agents/skills/gitnexus/` because the repository contract is already self-contained in `AGENTS.md`.

## Explicitly Preserved

- `docs/design_readme.md` and `docs/colors_and_type.css`, which are referenced by the live frontend stylesheet.
- `run.py`, `start.py`, and `dev.sh`, which have distinct backend, combined-launcher, and wrapper responsibilities.
- All lockfiles, tests, CI configuration, environment examples, and application code.

## Verification

- Confirm no live source or root documentation references removed paths.
- Run the existing backend and frontend test suites.
- Run the frontend production build.
- Review the final diff for documentation-only and tooling-only changes.

## Non-Goals

No dependency changes, source refactors, screenshot changes, GitHub settings changes, or branch changes.
