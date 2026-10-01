#!/bin/zsh
set -euo pipefail
MORY_ROOT="${0:A:h}"
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$MORY_ROOT"
exec node --import tsx "$MORY_ROOT/cms/scripts/service.ts" "${1:-start}"
