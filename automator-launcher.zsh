#!/bin/zsh
set -euo pipefail
# macOS Run Shell Script can run in an XPC process; do not infer the app
# location from the parent process. This launcher resolves its own location.
MORY_ROOT="${0:A:h}"
if [[ ! -x "$MORY_ROOT/server.sh" || ! -f "$MORY_ROOT/cms/server/index.ts" ]]; then
  print -u2 "[mory] CMS 프로젝트 구조를 확인하세요: $MORY_ROOT"
  exit 1
fi
exec "$MORY_ROOT/server.sh" start
