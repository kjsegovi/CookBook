#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_container="cookbook-pages-db-$$"
cleanup() { docker rm -f "$test_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$test_container" --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
for attempt in {1..240}; do
  if docker exec "$test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < tests/database-bootstrap.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261101000000_households.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < tests/database.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < tests/shared-migration-seed.sql
# Verify an ambiguous migration fails atomically before choosing an existing cookbook.
migration_log=$(mktemp)
if docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < supabase/migrations/20261103000000_shared_cookbook.sql > "$migration_log" 2>&1; then
  cat "$migration_log"
  rm -f "$migration_log"
  echo 'Expected migration to refuse two populated cookbooks.' >&2
  exit 1
fi
if ! rg -q 'Multiple populated cookbooks exist' "$migration_log"; then cat "$migration_log"; rm -f "$migration_log"; exit 1; fi
rm -f "$migration_log"
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin if to_regclass('public.cookbook_meta') is not null then raise exception 'Failed migration was not atomic.'; end if; end $$;
update public.households set state = jsonb_set(state,'{recipes}','[]') where name = 'Other kitchen';
SQL
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < supabase/migrations/20261103000000_shared_cookbook.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < tests/shared-database.sql
node tests/shared-concurrency.mjs "$test_container"
docker exec "$test_container" createdb -U postgres cookbook_fresh
docker exec -i "$test_container" psql -U postgres -d cookbook_fresh -v ON_ERROR_STOP=1 -q < <(sed '/^create role /d' tests/database-bootstrap.sql)
docker exec -i "$test_container" psql -U postgres -d cookbook_fresh -v ON_ERROR_STOP=1 --single-transaction -q < supabase/migrations/20261101000000_households.sql
docker exec -i "$test_container" psql -U postgres -d cookbook_fresh -v ON_ERROR_STOP=1 --single-transaction -q < supabase/migrations/20261103000000_shared_cookbook.sql
docker exec -i "$test_container" psql -U postgres -d cookbook_fresh -v ON_ERROR_STOP=1 -q < tests/fresh-database.sql
echo 'Database checks passed: archive preservation, universal confirmed-login access, anonymous/write denial, atomic record updates, duplicate retries, conflict checks, and unchanged-record preservation.'
