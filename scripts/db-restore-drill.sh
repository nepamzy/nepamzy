#!/usr/bin/env bash
# LOCAL backup + restore rehearsal. Dumps the application schemas (public, app_private) from the local Supabase
# database, restores them into a scratch database on the same local server, and compares a catalog + row-count
# fingerprint of both. Nothing leaves this machine; no remote database is touched. The scratch database is dropped.
#
# What this proves: the dump is complete enough to rebuild the application schema and data (tables, constraints,
# functions, triggers, policies, grants, rows). What it does NOT prove: restoring a hosted Supabase project, point-in-time
# recovery, auth.users/password-hash recovery, storage objects, or any production backup. See docs/operations/recovery.md.
set -euo pipefail
cd "$(dirname "$0")/.."
C="${DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
[ -n "$C" ] || { echo "local database container not running (pnpm db:start)"; exit 2; }
SCRATCH=restore_check
OUT="${BACKUP_DIR:-/tmp/afit-backups}"; mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/afit-local-$STAMP.dump"
psqlc() { docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

echo "1/6 dump -> $FILE"
docker exec "$C" pg_dump -U postgres -Fc -n public -n app_private -d postgres -f /tmp/drill.dump
docker cp "$C:/tmp/drill.dump" "$FILE"
SIZE=$(wc -c <"$FILE"); echo "    $SIZE bytes"

echo "2/6 scratch database"
psqlc -d postgres -c "drop database if exists $SCRATCH" -c "create database $SCRATCH" >/dev/null
# The application schemas reference Supabase's auth schema; recreate the minimum it needs and copy only user ids.
psqlc -d $SCRATCH <<'SQL' >/dev/null
create schema auth; create schema extensions;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
SQL
docker exec "$C" psql -U postgres -d postgres -qAt -c "copy (select id from auth.users) to stdout" \
  | docker exec -i "$C" psql -U postgres -d $SCRATCH -qAt -c "copy auth.users(id) from stdin" >/dev/null

echo "3/6 restore"
docker exec "$C" pg_restore -U postgres --no-owner -d $SCRATCH /tmp/drill.dump 2>"$OUT/restore-$STAMP.log" || true
# Note: run this on data created through normal flows. The DB test helpers purge with session_replication_role=replica,
# which can leave orphan rows that a real restore (correctly) rejects; reset first (pnpm db:reset) if the drill reports FK errors.
# Benign by construction: the scratch database already has a public schema, and ALTER DEFAULT PRIVILEGES FOR supabase_admin
# is a Supabase platform grant that this local role may not repeat. Any other error fails the drill.
ERRS=$({ grep -E "^pg_restore: error|^ERROR" "$OUT/restore-$STAMP.log" || true; } \
  | { grep -vE 'schema "public" already exists|permission denied to change default privileges' || true; } | wc -l | tr -d ' ')
echo "    unexpected pg_restore errors: $ERRS (log: $OUT/restore-$STAMP.log)"
if [ "$ERRS" != "0" ]; then
  if grep -q "violates foreign key" "$OUT/restore-$STAMP.log"; then
    echo "    foreign-key errors: the source database holds orphan rows, which the DB test helpers can leave behind"
    echo "    (replica-mode purge). Run 'pnpm db:reset' and create data through the app, then repeat."
  fi
  echo "RESULT: restore reported unexpected errors"; psqlc -d postgres -c "drop database $SCRATCH" >/dev/null; exit 1
fi

FP_SQL=$(cat <<'SQL'
with t as (select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r'),
rows as (select relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', relname), false, true, '')))[1]::text n from t)
select 'tables=' || (select count(*) from t)
  || ' rls_on=' || (select count(*) from t where rls)
  || ' constraints=' || (select count(*) from pg_constraint k join pg_namespace n on n.oid=k.connamespace where n.nspname in ('public','app_private'))
  || ' functions=' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private'))
  || ' triggers=' || (select count(*) from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and not g.tgisinternal)
  || ' policies=' || (select count(*) from pg_policies where schemaname='public')
  || ' indexes=' || (select count(*) from pg_indexes where schemaname in ('public','app_private'))
  || ' fn_acl=' || (select md5(string_agg(p.proname || ':' || coalesce(p.proacl::text,''), ',' order by p.proname, p.oid::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private'))
  || ' rows=' || (select md5(string_agg(relname || ':' || n, ',' order by relname)) from rows)
SQL
)
echo "4/6 fingerprint (live)";    LIVE=$(psqlc -d postgres -c "$FP_SQL"); echo "    $LIVE"
echo "5/6 fingerprint (restored)"; REST=$(psqlc -d $SCRATCH -c "$FP_SQL"); echo "    $REST"
echo "6/6 cleanup"
psqlc -d postgres -c "drop database $SCRATCH" >/dev/null
docker exec "$C" rm -f /tmp/drill.dump
if [ "$LIVE" = "$REST" ]; then echo "RESULT: restored database matches the source (local rehearsal only)"; else echo "RESULT: MISMATCH"; exit 1; fi
