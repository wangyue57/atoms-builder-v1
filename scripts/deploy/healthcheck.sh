#!/usr/bin/env sh
set -eu
origin=${APP_ORIGIN:-http://localhost:8787}
curl --fail --silent --show-error "${origin%/}/healthz" >/dev/null
curl --fail --silent --show-error "${origin%/}/" >/dev/null
