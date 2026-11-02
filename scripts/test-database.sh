#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_container="cookbook-pages-db-$$"
cleanup() { docker rm -f "$test_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$test_container" --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
for attempt in {1..40}; do
  if docker exec "$test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < tests/database-bootstrap.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261101000000_households.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 -q < tests/database.sql
echo 'Database checks passed: tenant isolation, write denial, email confirmation, owner-only invitations, matching email, expiry and single use.'
