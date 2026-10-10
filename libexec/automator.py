"""Launch this service from its Automator application."""
from pathlib import Path
import sys
from log_run import capture

SERVICE_DIR = Path(__file__).resolve().parent.parent
SERVICE_NAME = 'mory'
if len(sys.argv) != 2 or sys.argv[1] != SERVICE_NAME:
    raise SystemExit("Unexpected service")
script = SERVICE_DIR / "server.sh"
log = SERVICE_DIR / 'runtime' / "automator.log"
raise SystemExit(capture([str(script), "start"], SERVICE_DIR, log))
