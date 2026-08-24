#!/usr/bin/env bash
# ============================================================================
# supabase/schema.sql 을 임시 로컬 PostgreSQL 에 실제로 적용해 검증한다.
#
#   ./scripts/sqltest/run.sh
#
# 운영에서 처음 돌리지 않기 위한 장치다. tsc 도 vite build 도 SQL 은 잡아 주지 않는다.
# 임시 클러스터를 만들어 쓰고 끝나면 지우므로 기존 PostgreSQL 설치에 영향이 없다.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-}"

if [ -z "$PGBIN" ]; then
  for c in /usr/local/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@17/bin \
           /usr/local/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@16/bin; do
    [ -x "$c/initdb" ] && PGBIN="$c" && break
  done
fi
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then
  echo "PostgreSQL 을 찾지 못했습니다. 'brew install postgresql@17' 후 다시 실행하세요." >&2
  exit 1
fi

TMP="$(mktemp -d)"
PGDATA="$TMP/data"
PGSOCK="$TMP/sock"
mkdir -p "$PGSOCK"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "임시 PostgreSQL 준비 중… ($PGBIN)"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-k $PGSOCK -h '' -c listen_addresses=''" -w start >/dev/null
"$PGBIN/createdb" -h "$PGSOCK" -U postgres hdp11_test

PSQL=("$PGBIN/psql" -h "$PGSOCK" -U postgres -d hdp11_test -v ON_ERROR_STOP=1 -q)

echo "① Supabase 환경 스텁 적용"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/00_supabase_stub.local.sql"

echo "② schema.sql 적용 (1회차)"
"${PSQL[@]}" -f "$ROOT/supabase/schema.sql"

echo "③ schema.sql 재적용 (재실행 안전한가)"
"${PSQL[@]}" -f "$ROOT/supabase/schema.sql"

echo "④ 검증"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/01_assert.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo ""
echo "SQL 검증 통과."
