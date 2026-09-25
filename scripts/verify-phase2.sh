#!/usr/bin/env bash
# Checks: auth, RBAC, jurisdiction scoping, audit chain, and the UI guards.
set -uo pipefail
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok(){ printf '  \033[32mok  \033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
PW='Suraksha@Bhoomi2026'
# The database comes from .env, so this follows DATABASE_URL instead of a hard-coded name.
[ -f .env ] && { set -a; . ./.env; set +a; }
DB="${DATABASE_URL%%\?*}"
PORT=3100
BASE="http://localhost:$PORT"

echo; echo "AUTH, RBAC, AUDIT"; echo "=================================================================="

echo; echo "Code:"
chk "permission matrix exists"      '[ -f backend/rbac/permissions.ts ]'
chk "jurisdiction scoping exists"   '[ -f backend/rbac/scope.ts ]'
chk "page guard exists"             '[ -f backend/rbac/guard.ts ]'
chk "audit hash chain exists"       '[ -f backend/audit/chain.ts ]'
chk "session handling exists"       '[ -f backend/auth/session.ts ]'
# Jurisdiction logic must live in exactly one source file. Excludes build output.
chk "scoping logic is in ONE file"  '[ "$(grep -rl --exclude-dir=.next --exclude-dir=node_modules "jurisdictionLevel ===" backend frontend 2>/dev/null | wc -l)" -eq 1 ]'
chk "typecheck passes"              'npm run -s typecheck'

echo; echo "Logic (no server needed):"
chk "auth/rbac/audit smoke passes"  'npm run -s smoke:auth'

echo; echo "Users:"
U=$(psql "$DB" -tAc 'select count(*) from "User"' 2>/dev/null | tr -d ' ')
[ "${U:-0}" -ge 11 ] && ok "$U demo users seeded" || bad "users = ${U:-0} (expected >=11)"
C=$(psql "$DB" -tAc $'select count(distinct "districtId") from "User" where "jurisdictionLevel"=\'DISTRICT\'' 2>/dev/null | tr -d ' ')
[ "${C:-0}" -ge 2 ] && ok "collectors span $C different districts" || bad "district-scoped users span ${C:-0} districts"

echo; echo "HTTP enforcement:"
npm run -s build >/dev/null 2>&1
PORT=$PORT npx next start frontend -p $PORT >/tmp/p2srv.log 2>&1 &
SRV=$!
for _ in $(seq 1 40); do curl -sf -m 2 "$BASE/login" >/dev/null 2>&1 && break; sleep 1; done

code(){ curl -sS -m 15 -o /dev/null -w "%{http_code}" --max-redirs 0 ${2:+-b "$2"} "$BASE/$1"; }
# Two steps: password → one-time code (returned by the API in demo mode) → session.
login(){
  local body code
  body=$(curl -sS -m 15 -c "/tmp/p2_$2.txt" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
         -d "{\"email\":\"$1\",\"password\":\"$PW\"}")
  code=$(printf '%s' "$body" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("demoCode",""))' 2>/dev/null)
  [ -z "$code" ] && { echo "401"; return; }
  curl -sS -m 15 -b "/tmp/p2_$2.txt" -c "/tmp/p2_$2.txt" -X POST "$BASE/api/auth/verify-otp" -H 'Content-Type: application/json' \
       -d "{\"code\":\"$code\"}" -o /dev/null -w "%{http_code}"
}

[ "$(code login)" = "200" ] && ok "login page serves" || bad "login page did not serve"
[ "$(code dashboard)" = "307" ] && ok "anonymous is redirected from /dashboard" || bad "anonymous reached /dashboard"
[ "$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$BASE/api/audit/verify")" = "401" ] \
  && ok "audit API rejects anonymous" || bad "audit API allowed anonymous"

[ "$(login collector.agra@bhoominayan.gov.in agra)" = "200" ] && ok "collector can sign in" || bad "collector sign-in failed"
[ "$(login landowner.agra@example.in owner)" = "200" ] && ok "landowner can sign in" || bad "landowner sign-in failed"
[ "$(login nhai.officer@bhoominayan.gov.in nhai)" = "200" ] && ok "requiring body can sign in" || bad "requiring body sign-in failed"

[ "$(code dashboard /tmp/p2_agra.txt)" = "200" ] && ok "collector may open /dashboard" || bad "collector blocked from /dashboard"
[ "$(code audit /tmp/p2_agra.txt)" = "200" ] && ok "collector may open /audit" || bad "collector blocked from /audit"
[ "$(code permissions /tmp/p2_agra.txt)" = "307" ] && ok "collector is blocked from /permissions" || bad "collector reached /permissions"
[ "$(code dashboard /tmp/p2_owner.txt)" = "307" ] && ok "landowner is blocked from /dashboard" || bad "landowner reached /dashboard"
[ "$(code my-land /tmp/p2_owner.txt)" = "200" ] && ok "landowner may open /my-land" || bad "landowner blocked from /my-land"
[ "$(code audit /tmp/p2_nhai.txt)" = "307" ] && ok "requiring body is blocked from /audit" || bad "requiring body reached /audit"

# Bad credentials must not authenticate.
BADC=$(curl -sS -m 15 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
       -d '{"email":"collector.agra@bhoominayan.gov.in","password":"nope"}' -o /dev/null -w '%{http_code}')
[ "$BADC" = "401" ] && ok "wrong password returns 401" || bad "wrong password returned $BADC"

# Regression: the nav once linked to /inbox, /parcels and /rnr, none of which existed.
curl -sS -m 15 -b /tmp/p2_agra.txt "$BASE/dashboard" -o /tmp/p2_nav.html 2>/dev/null
NAVBAD=0
for L in $(grep -oE 'href="/[a-z-]+"' /tmp/p2_nav.html 2>/dev/null | sed 's/href="//;s/"//' | sort -u); do
  RC=$(curl -sS -m 15 -b /tmp/p2_agra.txt -o /dev/null -w '%{http_code}' --max-redirs 0 "$BASE$L")
  [ "$RC" = "200" ] || { NAVBAD=$((NAVBAD+1)); echo "       dead nav link: $L -> $RC"; }
done
[ "$NAVBAD" -eq 0 ] && ok "every rendered nav link resolves" || bad "$NAVBAD dead nav link(s)"

# The root route is the public landing page (it once rendered a build-status page).
curl -sS -m 15 "$BASE/" 2>/dev/null | grep -q "Track an application" \
  && ok "root serves the public landing page" || bad "root did not serve the landing page"

# Regression: the inbox was gated on scrutiny:read, which hid s.3D cases from the Central Ministry —
# the very authority that must act on them.
[ "$(code inbox /tmp/p2_agra.txt)" = "200" ] && ok "collector may open /inbox" || bad "collector blocked from /inbox"
login morth@bhoominayan.gov.in morth >/dev/null
[ "$(code inbox /tmp/p2_morth.txt)" = "200" ] \
  && ok "Central Ministry may open /inbox (acts on s.3D)" || bad "Ministry blocked from its own inbox"

# Regression: designation was hardcoded null in the login route.
curl -sS -m 15 -b /tmp/p2_agra.txt "$BASE/account" 2>/dev/null | grep -q "District Collector, Agra" \
  && ok "officer designation reaches the session" || bad "designation missing from session"
psql "$DB" -tAc "UPDATE \"User\" SET \"failedLoginAttempts\"=0,\"lockedUntil\"=NULL;" >/dev/null 2>&1

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

echo; echo "=================================================================="
printf 'PASSED %d   FAILED %d\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
