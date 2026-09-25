#!/usr/bin/env bash
# Foundation checks: structure, toolchain, schema, database, seed data, PostGIS and build.
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { printf '  \033[32mok  \033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

DB_URL=$(grep -E '^DATABASE_URL=' .env 2>/dev/null | head -1 | cut -d'"' -f2)
DB_NAME=$(printf '%s' "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')

echo
echo "FOUNDATION & DATA MODEL"
echo "=================================================================="

echo
echo "Structure:"
check "README.md is the only .md at root"      '[ "$(ls *.md | wc -l)" -eq 1 ]'
check "scripts/ holds the tooling"             '[ -f scripts/state-verify.py ]'
check "backend/ is a top-level folder"         '[ -d backend ]'
check "frontend/ is a top-level folder"        '[ -d frontend ]'
check "no leftover src/"                       '[ ! -d src ]'
check "Next app lives in frontend/app"         '[ -d frontend/app ]'
check "backend has no UI, frontend no server"  '! ls frontend/*.prisma 2>/dev/null && [ ! -d backend/components ]'
check "prisma/schema.prisma exists"            '[ -f prisma/schema.prisma ]'
check "prisma/seed.ts exists"                  '[ -f prisma/seed.ts ]'
check "docker-compose.yml exists"              '[ -f docker-compose.yml ]'
check ".env.example exists"                    '[ -f .env.example ]'
check ".env is gitignored"                     'grep -qx ".env" .gitignore'

echo
echo "Toolchain:"
check "prisma installed"                       '[ -x node_modules/.bin/prisma ]'
check "tsx installed"                          '[ -x node_modules/.bin/tsx ]'
check "@prisma/client installed"               '[ -d node_modules/@prisma/client ]'
check "prisma client generated"                '[ -d node_modules/.prisma/client ]'

echo
echo "Schema:"
check "schema validates"                       'node_modules/.bin/prisma validate'
ENTITIES=$(grep -cE '^model ' prisma/schema.prisma 2>/dev/null || echo 0)
if [ "$ENTITIES" -ge 30 ]; then ok "schema defines $ENTITIES models (>=30)"; else bad "schema defines $ENTITIES models (expected >=30)"; fi
check "LandParcel has PostGIS geometry"        'grep -q "Unsupported(\"geometry(Polygon, 4326)\")" prisma/schema.prisma'
check "multi-Act support (NH Act 1956)"        'grep -q "NH_ACT_1956" prisma/schema.prisma'
check "audit hash chain fields present"        'grep -q "prevHash" prisma/schema.prisma'
check "s.77 uses LARR Authority not court"     'grep -q "DEPOSITED_WITH_AUTHORITY" prisma/schema.prisma'

echo
echo "Seed constants (static check, no DB needed):"
check "seed referential integrity" 'npm run -s verify:seed'

echo
echo "Database:"
check "postgres reachable"                     'pg_isready -q'
check "database $DB_NAME exists"               "psql -d '$DB_NAME' -tAc 'select 1'"
check "postgis extension installed"            "psql -d '$DB_NAME' -tAc \"select 1 from pg_extension where extname='postgis'\" | grep -q 1"
check "LandParcel table exists"                "psql -d '$DB_NAME' -tAc \"select to_regclass('\\\"LandParcel\\\"')\" | grep -q LandParcel"
check "geom column is a real geometry type"    "psql -d '$DB_NAME' -tAc \"select udt_name from information_schema.columns where table_name='LandParcel' and column_name='geom'\" | grep -q geometry"
check "GiST spatial index present"             "psql -d '$DB_NAME' -tAc \"select 1 from pg_indexes where indexname='LandParcel_geom_gist'\" | grep -q 1"
check "geometry validity constraint present"   "psql -d '$DB_NAME' -tAc \"select 1 from pg_constraint where conname='LandParcel_geom_valid'\" | grep -q 1"

echo
echo "Seed data (real geography):"
sql() { psql -d "$DB_NAME" -tAc "$1" 2>/dev/null | tr -d ' '; }
S=$(sql 'select count(*) from "State"');    [ "${S:-0}" -eq 36 ] && ok "28 states and 8 UTs seeded" || bad "states/UTs = ${S:-0} (expected 28 states + 8 UTs = 36)"
C=$(sql 'select count(*) from "State" where "cadastralBaseUrl" is not null')
[ "${C:-0}" -eq 14 ] && ok "14 states carry a verified cadastral API" || bad "cadastral-enabled states = ${C:-0} (expected 14)"
D=$(sql 'select count(*) from "District"');  [ "${D:-0}" -ge 20 ] && ok "$D districts seeded" || bad "districts = ${D:-0} (expected >=20)"
V=$(sql 'select count(*) from "Village"');   [ "${V:-0}" -ge 5 ]  && ok "$V villages seeded" || bad "villages = ${V:-0} (expected >=5)"
P=$(sql 'select count(*) from "Project"');   [ "${P:-0}" -ge 4 ]  && ok "$P projects seeded" || bad "projects = ${P:-0} (expected >=4)"
R=$(sql 'select count(*) from "Role"');      [ "${R:-0}" -eq 8 ] && ok "8 roles seeded" || bad "roles = ${R:-0} (expected 8)"
NH=$(sql $'select count(*) from "Project" where "governingAct"=\'NH_ACT_1956\'')
[ "${NH:-0}" -ge 1 ] && ok "highway projects use the NH Act, not LARR" || bad "no NH_ACT_1956 project seeded"
UP=$(sql $'select count(*) from "District" d join "State" s on s.id=d."stateId" where s."lgdCode"=\'09\'')
[ "${UP:-0}" -ge 5 ] && ok "UP districts present ($UP)" || bad "UP districts = ${UP:-0}"

echo
echo "PostGIS actually works:"
check "ST_Area computes"    "psql -d '$DB_NAME' -tAc \"select ST_Area(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326))\" | grep -q 1"
check "ST_Intersects works" "psql -d '$DB_NAME' -tAc \"select ST_Intersects(ST_GeomFromText('POLYGON((0 0,0 2,2 2,2 0,0 0))',4326), ST_GeomFromText('POLYGON((1 1,1 3,3 3,3 1,1 1))',4326))\" | grep -q t"

echo
echo "Build:"
check "typecheck passes" 'npm run -s typecheck'

echo
echo "=================================================================="
printf 'PASSED %d   FAILED %d\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
