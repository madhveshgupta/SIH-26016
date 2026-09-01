#!/usr/bin/env bash
# Apply the PostGIS objects Prisma cannot express (see prisma/sql/postgis-setup.sql).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
PSQL_URL="${DATABASE_URL%%\?*}"
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f prisma/sql/postgis-setup.sql
