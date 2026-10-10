"""Bounded stdout/stderr capture; no timer, network listener or automatic restart."""
from __future__ import annotations

import argparse
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import subprocess


def capture(command, cwd, log_path, on_start=None):
    os.umask(0o077)
    path = Path(log_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    path.chmod(0o600)
    handler.setFormatter(logging.Formatter("%(message)s"))
    child = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def forward(signum, _frame):
        if child.poll() is None:
            child.send_signal(signum)

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, forward)
    if on_start:
        on_start(child.pid)
    try:
        for raw in iter(lambda: child.stdout.readline(16384), b""):
            handler.emit(logging.LogRecord("service", logging.INFO, "", 0,
                                          raw.decode("utf-8", "replace").rstrip("\n"), (), None))
        return child.wait()
    finally:
        handler.close()
        child.stdout.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", required=True)
    parser.add_argument("--cwd")
    parser.add_argument("--pid-file")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("command required")
    def remember(pid):
        if args.pid_file:
            path = Path(args.pid_file)
            path.write_text(str(pid) + "\n")
            path.chmod(0o600)
    raise SystemExit(capture(command, args.cwd, args.log, remember))
