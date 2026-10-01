#!/bin/sh
set -eu
# Resolve the repository relative to this script, including when invoked by Automator.
MORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:$PATH"
cd "$MORY_ROOT"
npm run cms:build
exec npm run cms:serve
