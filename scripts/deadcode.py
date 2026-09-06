#!/usr/bin/env python3
"""Find code nothing uses — in both languages, and across the HTTP boundary.

The boundary check is the one that matters here. A Flask blueprint registered in
main.py has an inbound reference and looks alive to any single-language search,
even when the Next.js frontend never calls a single one of its URLs. That is how
a whole dead admin blueprint survived in this repo.

Heuristics, not a compiler. Everything it prints needs a human look — dynamic
lookups, decorator registration, and string-built URLs can all produce false
positives. It is a place to start reading, not a delete list.

Usage:
    python3 scripts/deadcode.py                # everything
    python3 scripts/deadcode.py routes py      # only those sections
    python3 scripts/deadcode.py --strict       # exit 1 if anything was found
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
APP = REPO_ROOT / "app"
TESTS = REPO_ROOT / "tests"
WEB = REPO_ROOT / "frontend" / "src"

SKIP_DIRS = {"node_modules", ".next", "venv", "__pycache__", ".git", "dist", "build"}
findings: dict[str, list[str]] = defaultdict(list)


def walk(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    if not root.exists():
        return []
    return sorted(
        p for p in root.rglob("*")
        if p.suffix in suffixes and not any(part in SKIP_DIRS for part in p.parts)
    )


def report(section: str, item: str) -> None:
    findings[section].append(item)


# --------------------------------------------------------------------------
# Python: top-level defs/classes referenced nowhere but their own file
# --------------------------------------------------------------------------
def check_python() -> None:
    prod = walk(APP, (".py",)) + [REPO_ROOT / f for f in ("run.py", "config.py", "start.py")]
    prod = [p for p in prod if p.exists()]
    sources = {p: p.read_text() for p in prod + walk(TESTS, (".py",))}

    # Views wired via add_url_rule are referenced by string, not by call.
    wired = set()
    for text in sources.values():
        wired |= set(re.findall(r"view_func=(\w+)", text))

    defined: dict[str, list[Path]] = defaultdict(list)
    for path in prod:
        for match in re.finditer(r"^(?:def|class)\s+(\w+)", sources[path], re.M):
            defined[match.group(1)].append(path)

    for name, owners in sorted(defined.items()):
        if name in wired or name.startswith("__"):
            continue
        prod_refs = test_refs = 0
        for path, text in sources.items():
            hits = len(re.findall(rf"\b{re.escape(name)}\b", text))
            if path in owners:  # discount the declaration itself
                hits -= len(re.findall(rf"^(?:def|class)\s+{re.escape(name)}\b", text, re.M))
            if path.is_relative_to(TESTS):
                test_refs += hits
            else:
                prod_refs += hits
        if prod_refs == 0:
            where = ", ".join(str(p.relative_to(REPO_ROOT)) for p in owners)
            # Route handlers and Flask lifecycle hooks are called by the framework,
            # never by name. Decorators come both with args (@bp.route("/x")) and
            # bare (@bp.after_request), so the trailing "(...)" is optional.
            decorated = any(
                re.search(
                    r"@[\w.]+(?:route|before_request|after_request|before_app_request|"
                    r"teardown_\w+|errorhandler|cli\.command|command)\b[^\n]*\n"
                    rf"(?:\s*@[^\n]+\n)*\s*(?:def|class)\s+{re.escape(name)}\b",
                    sources[p],
                )
                for p in owners
            )
            if decorated:
                continue
            tag = f"used only by tests ({test_refs} refs)" if test_refs else "no references at all"
            report("PY", f"{where}::{name} — {tag}")


# --------------------------------------------------------------------------
# TypeScript: exported symbols referenced in no other file
# --------------------------------------------------------------------------
NEXT_CONVENTION = {"page.tsx", "layout.tsx", "route.ts", "loading.tsx", "error.tsx",
                   "not-found.tsx", "template.tsx", "default.tsx"}


def check_typescript() -> None:
    files = walk(WEB, (".ts", ".tsx"))
    sources = {p: p.read_text() for p in files}
    pattern = re.compile(
        r"^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)", re.M)

    for path in files:
        if path.name in NEXT_CONVENTION:
            continue  # default-exported by convention, imported by the framework
        for match in pattern.finditer(sources[path]):
            name = match.group(1)
            prod = tests = 0
            for other, text in sources.items():
                if other == path:
                    continue
                hits = len(re.findall(rf"\b{re.escape(name)}\b", text))
                if "__tests__" in other.parts or other.name.endswith((".test.ts", ".test.tsx")):
                    tests += hits
                else:
                    prod += hits
            if prod == 0:
                rel = path.relative_to(REPO_ROOT)
                own_body = len(re.findall(rf"\b{re.escape(name)}\b", sources[path])) - 1
                if tests:
                    report("TS", f"{rel}::{name} — used only by tests")
                elif own_body == 0:
                    report("TS", f"{rel}::{name} — no references at all")
                else:
                    report("TS-EXPORT", f"{rel}::{name} — used in-file only, `export` is unnecessary")


# --------------------------------------------------------------------------
# Files nothing imports
# --------------------------------------------------------------------------
def check_orphan_files() -> None:
    files = walk(WEB, (".ts", ".tsx"))
    blob = "\n".join(p.read_text() for p in files)
    for path in files:
        if path.name in NEXT_CONVENTION or path.name == "index.ts":
            continue
        # Test files are entry points — the runner discovers them, nothing imports them.
        if "__tests__" in path.parts or path.name.endswith((".test.ts", ".test.tsx")):
            continue
        stem = path.stem
        if not re.search(rf"""["'](?:[^"']*/)?{re.escape(stem)}["']""", blob):
            report("ORPHAN", str(path.relative_to(REPO_ROOT)))


# --------------------------------------------------------------------------
# The boundary check: Flask routes the frontend never calls
# --------------------------------------------------------------------------
BUILD_ONLY = {"tailwindcss", "typescript", "eslint", "eslint-config-next", "postcss",
              "@tailwindcss/postcss", "shadcn", "vitest", "tw-animate-css", "apexcharts"}


def check_routes() -> None:
    web_blob = "\n".join(p.read_text() for p in walk(WEB, (".ts", ".tsx")))
    next_config = REPO_ROOT / "frontend" / "next.config.ts"
    if next_config.exists():
        web_blob += "\n" + next_config.read_text()

    rules: set[str] = set()
    for path in walk(APP, (".py",)):
        text = path.read_text()
        rules |= set(re.findall(r"add_url_rule\(\s*[\"']([^\"']+)", text))
        rules |= set(re.findall(r"@\w*_?bp\.route\(\s*[\"']([^\"']+)", text))

    for rule in sorted(rules):
        # /portfolio/api/x is reached from the client as /api/x (next.config rewrite),
        # and the client builds paths as template literals, so probe on the literal
        # prefix before the first <param> rather than the whole rule. Probing the
        # full rule with params stripped produces "a//b" and false-flags live
        # routes. The cost is that a dead segment AFTER a param won't be caught —
        # a deliberate trade: this report is only useful if it can be trusted.
        literal = rule.split("<")[0]
        probe = literal.split("/api/")[-1] if "/api/" in literal else literal
        probe = probe.strip("/")
        if probe and probe not in web_blob:
            report("ROUTES", f"{rule} — no frontend reference to '{probe}'")


def check_npm() -> None:
    pkg_path = REPO_ROOT / "frontend" / "package.json"
    if not pkg_path.exists():
        return
    pkg = json.loads(pkg_path.read_text())
    blob = "\n".join(p.read_text() for p in walk(REPO_ROOT / "frontend" / "src", (".ts", ".tsx")))
    for dep in sorted({**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}):
        if dep in BUILD_ONLY or dep.startswith(("@types/", "next", "react")):
            continue
        if dep not in blob:
            report("NPM", f"{dep} — not imported anywhere in frontend/src")


SECTIONS = {
    "py": check_python,
    "ts": check_typescript,
    "orphan": check_orphan_files,
    "routes": check_routes,
    "npm": check_npm,
}

# TS-EXPORT is real but low-value — an over-wide `export`, not dead code. It runs
# with the rest and is simply not printed unless asked, because ~40 lines of it
# buries the sections that matter. A report nobody reads finds nothing.
NOISY = {"TS-EXPORT"}

HEADERS = {
    "PY": "Python symbols with no production references",
    "TS": "TypeScript exports with no production references",
    "TS-EXPORT": "Exported but only used in their own file",
    "ORPHAN": "Files nothing imports",
    "ROUTES": "Flask routes the frontend never calls  ← the cross-boundary blind spot",
    "NPM": "Declared npm packages never imported",
}


def main(argv: list[str]) -> int:
    strict = "--strict" in argv
    verbose = "--all" in argv
    wanted = [a for a in argv if not a.startswith("-")] or list(SECTIONS)

    unknown = [w for w in wanted if w not in SECTIONS]
    if unknown:
        print(f"unknown section(s): {unknown}. choose from: {', '.join(SECTIONS)}")
        return 2

    for name in wanted:
        SECTIONS[name]()

    shown = 0
    for key, header in HEADERS.items():
        items = findings.get(key)
        if not items:
            continue
        if key in NOISY and not verbose:
            print(f"\n── {header}: {len(items)} (run with --all to list) ──")
            continue
        shown += len(items)
        print(f"\n── {header} ──")
        for item in items:
            print(f"  {item}")

    print(f"\n{shown} candidate(s). Heuristics — verify each before deleting.")
    return 1 if (strict and shown) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
