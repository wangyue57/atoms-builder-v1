#!/usr/bin/env sh
set -eu
"$(dirname "$0")/healthcheck.sh"
echo "API/database connectivity and SPA health checks passed; account/task verification uses npm run verify."
