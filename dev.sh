#!/bin/bash
# Start Flask backend and Next.js frontend together.
# If either process exits, shut the other down instead of silently continuing.
set -u
trap 'kill 0 2>/dev/null' EXIT INT TERM

if [ ! -x "./venv/bin/python3" ]; then
  echo "ERROR: ./venv/bin/python3 not found." >&2
  echo "Run: python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

./venv/bin/python3 run.py --port 8065 &
FLASK_PID=$!

# Next 16 / Turbopack panics on Node 25. Prefer Homebrew's node@22 if present.
NODE_BIN="/opt/homebrew/opt/node@22/bin"
if [ -x "$NODE_BIN/node" ]; then
  FRONTEND_PATH="$NODE_BIN:$PATH"
else
  FRONTEND_PATH="$PATH"
  echo "WARN: node@22 not found at $NODE_BIN; using default node ($(node --version 2>/dev/null))." >&2
fi
(cd frontend && PATH="$FRONTEND_PATH" npm run dev) &
NEXT_PID=$!

while kill -0 "$FLASK_PID" 2>/dev/null && kill -0 "$NEXT_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$FLASK_PID" 2>/dev/null; then
  echo "ERROR: Flask backend exited. Check output above." >&2
else
  echo "ERROR: Next.js dev server exited. Check output above." >&2
fi
exit 1
