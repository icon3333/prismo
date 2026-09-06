# AGENTS.md

**Prismo** — portfolio management for Parqet/IBKR users. Flask JSON API + Next.js 16, single-user homeserver deployment.

**`CLAUDE.md` is the source of truth** for architecture, the data model, and the invariants that matter. Read it before changing code. This file is the short version: what will damage things, how to verify, and the traps that have actually bitten agents in this repo.

---

## Do not damage

- **`instance/portfolio.db` is live financial data** — 199 real positions across 5 accounts. It is gitignored, so git cannot restore it, and the only copies are `instance/backups/`. **Never** point migrations, imports, or experiments at it. Copy it first:
  ```bash
  mkdir -p /tmp/x && cp instance/portfolio.db /tmp/x/
  APP_DATA_DIR=/tmp/x DATABASE_URL=sqlite:////tmp/x/portfolio.db python3 ...
  ```
  `scripts/smoke.py` already does this correctly — prefer it over hand-rolling.
- **CSV import is destructive by design.** Each import deletes existing positions of its own `source` type. Never trigger one to "just test" something.
- **`.env` holds the generated `SECRET_KEY`.** Don't read it back into output, don't commit it.

## Run and verify

```bash
./dev.sh        # Flask :8065 + Next.js :3000
./test.sh       # pytest + tsc + vitest — this is the definition of done
```

Requires **Python 3.11+** (pandas 3.0 won't install below it) and **Node 22** (Next 16 / Turbopack panics on 25). `start.py` bootstraps the venv and prefers Homebrew's `node@22`. A `venv/` built on a different OS will fail with a missing interpreter — delete it and re-run rather than debugging it.

There is no CI. Nothing is finished until `./test.sh` is green locally.

## Scripts

```bash
python3 scripts/smoke.py       # boot against a COPY of the real DB, and a fresh one
python3 scripts/deadcode.py    # unused symbols/files/deps — both languages + the HTTP boundary
```

Run `smoke.py` after touching anything in `app/db_manager.py`, `app/main.py`, or `app/schema.sql`. The unit tests pass on a synthetic database; `smoke.py` is what proves the app still starts on the *real* one. A startup-blocking bug shipped to `main` once because only the synthetic path was covered.

## Traps

These are real, each cost someone time here.

1. **Dead code hides at the language boundary.** A Flask blueprint can look alive — registered in `main.py`, referenced by its decorator — while no frontend code ever calls its URLs. Single-language reference searches say "alive". Search `frontend/src` for the URL string itself; `scripts/deadcode.py` reports this as `ROUTES`.

2. **Imports are often function-local.** Many modules `import` inside a function body rather than at module top. So: grep the bare symbol name, not the import line. And in tests, `monkeypatch.setattr(importing_module, "name", ...)` is a **silent no-op** — patch the module that *defines* the symbol.

3. **vitest does not typecheck.** It transpiles. A changed interface passes every test and fails the build. `npm run typecheck` (`tsc --noEmit`) is the real check; `./test.sh` runs it.

4. **Comments and docstrings here have lied.** A test docstring described a parity contract with a TypeScript file that did not exist. Before trusting a path in a comment, `ls` it.

5. **`schema.sql` re-runs on every boot and can only CREATE.** It cannot add a column to an existing table, which is why migrations must run *before* it. See the Database section of `CLAUDE.md` — getting this order wrong means the app won't start on an existing database, while every test still passes.

6. **Reads are memoized 30–60s** and invalidated by a `portfolio_bp.after_request` hook. If a write appears not to take effect, suspect the cache before suspecting the query.

## Style

The repo philosophy is 80/20: simple, modular, elegant, efficient, robust.

- Prefer **deleting** over simplifying, **simplifying** over optimizing, **optimizing** over automating.
- Speculative abstraction is treated as a defect. Don't add an exception class, a config flag, a service layer, or a "Phase 2" field until something uses it — a feature was persisted end-to-end through this codebase for months and rendered by nothing.
- Match the surrounding style rather than importing your own.
- When you delete something non-obvious, say *why* it was safe (no callers / no frontend reference / superseded by X), not just that you did.
- Update `CLAUDE.md` in the same change when you alter architecture, the data model, or an invariant. Stale docs here have actively misled agents.
