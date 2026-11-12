#!/usr/bin/env sh
set -eu
# Uses exactly the same migration runner and image as normal startup.
docker compose up -d --wait postgres
docker compose run --rm --no-deps api node apps/platform-server/dist/migrate.js
