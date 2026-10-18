#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"

if [ "$POSTGRES_DB" != "lara_test" ] || [ "$POSTGRES_USER" != "lara" ]; then
  echo "Refusing to mark an unexpected PostgreSQL database." >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "COMMENT ON DATABASE lara_test IS 'lara:integration-test-only:v1';"
