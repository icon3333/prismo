#!/bin/bash
# Thin wrapper — see start.py for the real launcher.
exec python3 "$(dirname "$0")/start.py" "$@"
