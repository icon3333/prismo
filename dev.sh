#!/bin/bash
# Start Flask backend and Next.js frontend together
trap 'kill 0' EXIT
python3 run.py --port 8065 &
cd frontend && npm run dev &
wait
