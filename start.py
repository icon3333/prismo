#!/usr/bin/env python3
"""One-shot dev launcher: bootstraps venv + deps, then runs Flask + Next.js.

Usage:
    python3 start.py            # start everything on :8065 (Flask) + :3000 (Next.js)
    python3 start.py --port 9000
    python3 start.py --no-frontend   # backend only
    python3 start.py --reinstall     # force pip + npm reinstall

Idempotent — safe to re-run. Uses stdlib only so it works without an active venv.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / "venv"
VENV_PY = VENV / "bin" / "python3"
VENV_PIP = VENV / "bin" / "pip"
REQ = ROOT / "requirements.txt"
FRONTEND = ROOT / "frontend"
NODE22_BIN = Path("/opt/homebrew/opt/node@22/bin")

CYAN = "\033[36m"
MAGENTA = "\033[35m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"


def log(msg: str, color: str = "") -> None:
    print(f"{color}[start]{RESET} {msg}", flush=True)


def find_python() -> str:
    """Prefer python3.12 (Next 16 / build chain is happiest there), fall back to current."""
    for candidate in ("python3.12", "python3.11", "python3"):
        path = shutil.which(candidate)
        if path:
            return path
    return sys.executable


def ensure_venv() -> None:
    if VENV_PY.exists():
        return
    py = find_python()
    log(f"creating venv at ./venv (using {py})", CYAN)
    subprocess.check_call([py, "-m", "venv", str(VENV)])


def pip_install(force: bool) -> None:
    marker = VENV / ".deps-installed"
    needs_install = force or not marker.exists()
    if not needs_install:
        # Re-install if requirements.txt is newer than the marker
        if REQ.stat().st_mtime > marker.stat().st_mtime:
            needs_install = True
    if not needs_install:
        return
    log("installing Python dependencies", CYAN)
    subprocess.check_call([str(VENV_PIP), "install", "--upgrade", "pip", "--quiet"])
    subprocess.check_call([str(VENV_PIP), "install", "-r", str(REQ), "--quiet"])
    marker.touch()


def frontend_path_env() -> dict[str, str]:
    """PATH with Homebrew node@22 prepended if available (Next 16 / Turbopack panics on Node 25)."""
    env = os.environ.copy()
    if (NODE22_BIN / "node").exists():
        env["PATH"] = f"{NODE22_BIN}:{env.get('PATH', '')}"
    else:
        log(f"node@22 not found at {NODE22_BIN}; using system node", YELLOW)
    return env


def npm_install(force: bool, env: dict[str, str]) -> None:
    node_modules = FRONTEND / "node_modules"
    if not force and node_modules.exists():
        return
    log("installing frontend dependencies (npm install)", CYAN)
    subprocess.check_call(["npm", "install"], cwd=FRONTEND, env=env)


def stream_output(proc: subprocess.Popen, label: str, color: str) -> None:
    """Prefix and forward subprocess output. Returns when stdout closes."""
    assert proc.stdout is not None
    prefix = f"{color}[{label}]{RESET}"
    for raw in proc.stdout:
        line = raw.rstrip("\n")
        print(f"{prefix} {line}", flush=True)


def run(port: int, no_frontend: bool) -> int:
    flask_env = os.environ.copy()
    flask_proc = subprocess.Popen(
        [str(VENV_PY), str(ROOT / "run.py"), "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=flask_env,
    )

    next_proc: subprocess.Popen | None = None
    if not no_frontend:
        next_env = frontend_path_env()
        next_proc = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=FRONTEND,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=next_env,
        )

    import threading

    threads = [
        threading.Thread(target=stream_output, args=(flask_proc, "flask", CYAN), daemon=True),
    ]
    if next_proc is not None:
        threads.append(
            threading.Thread(target=stream_output, args=(next_proc, "next", MAGENTA), daemon=True)
        )
    for t in threads:
        t.start()

    log(f"backend: http://localhost:{port}", DIM)
    if next_proc is not None:
        log("frontend: http://localhost:3000 (open this one)", DIM)
    log("press Ctrl-C to stop", DIM)

    def shutdown(*_: object) -> None:
        log("shutting down…", YELLOW)
        for p in (next_proc, flask_proc):
            if p and p.poll() is None:
                try:
                    p.terminate()
                except ProcessLookupError:
                    pass
        deadline = time.time() + 5
        for p in (next_proc, flask_proc):
            if p is None:
                continue
            remaining = max(0.1, deadline - time.time())
            try:
                p.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                p.kill()

    signal.signal(signal.SIGINT, lambda *_: shutdown())
    signal.signal(signal.SIGTERM, lambda *_: shutdown())

    try:
        while True:
            if flask_proc.poll() is not None:
                log(f"Flask exited with code {flask_proc.returncode}", RED)
                shutdown()
                return flask_proc.returncode or 1
            if next_proc is not None and next_proc.poll() is not None:
                log(f"Next.js exited with code {next_proc.returncode}", RED)
                shutdown()
                return next_proc.returncode or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        shutdown()
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8065, help="Flask port (default: 8065)")
    parser.add_argument("--no-frontend", action="store_true", help="Skip Next.js, run Flask only")
    parser.add_argument("--reinstall", action="store_true", help="Force pip + npm reinstall")
    parser.add_argument(
        "--setup-only", action="store_true", help="Bootstrap venv/deps and exit without starting servers"
    )
    args = parser.parse_args()

    os.chdir(ROOT)

    ensure_venv()
    pip_install(force=args.reinstall)

    if not args.no_frontend:
        env = frontend_path_env()
        if shutil.which("npm", path=env["PATH"]) is None:
            log("npm not found — install Node.js (Homebrew: `brew install node@22`)", RED)
            return 1
        npm_install(force=args.reinstall, env=env)

    if args.setup_only:
        log("setup complete", CYAN)
        return 0

    return run(port=args.port, no_frontend=args.no_frontend)


if __name__ == "__main__":
    sys.exit(main())
