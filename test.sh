#!/bin/bash
# Run the full test suite: backend (pytest) + frontend (vitest).
# Usage: ./test.sh [backend|frontend]

set -e
cd "$(dirname "$0")"

run_backend() {
    echo "── Backend tests (pytest) ──────────────────────────────"
    python3 -m pytest tests/ -q
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
