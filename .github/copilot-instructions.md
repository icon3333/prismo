# Copilot instructions

Read **`AGENTS.md`** in the repo root first, then **`CLAUDE.md`** for architecture and invariants. Both are kept current; this file is only an entry point and deliberately duplicates nothing.

The three things worth repeating:

1. **`instance/portfolio.db` is live financial data and is gitignored.** Never run migrations, imports, or experiments against it — copy it to a temp directory first. `scripts/smoke.py` does this correctly.
2. **`./test.sh` (pytest + tsc + vitest) is the definition of done.** There is no CI.
3. **Prefer deleting over adding.** Speculative abstraction is treated as a defect in this repo.
