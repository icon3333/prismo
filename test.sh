#!/bin/bash
# Run the full test suite: backend (pytest) + frontend (vitest).
# Usage: ./test.sh [backend|frontend]

set -e
cd "$(dirname "$0")"

run_backend() {
    echo "── Backend tests (pytest) ──────────────────────────────"
    # Prefer the project venv (created by ./dev.sh); fall back to system python3.
    PY="./venv/bin/python"; [ -x "$PY" ] || PY="python3"
    # Self-heal: install test deps if pytest is missing (fresh venv / clone).
    if ! "$PY" -m pytest --version >/dev/null 2>&1; then
        "$PY" -m pip install -q --upgrade "pip>=26.1.2"
        "$PY" -m pip install -q -r requirements-dev.txt
    fi
    "$PY" -m pytest tests/ -q
}

run_frontend() {
    echo "── Frontend tests (vitest) ─────────────────────────────"
    (cd frontend && npm test)
}

case "${1:-all}" in
    backend)  run_backend ;;
    frontend) run_frontend ;;
    all)      run_backend && run_frontend ;;
    *)        echo "Usage: ./test.sh [backend|frontend]" >&2; exit 1 ;;
esac
