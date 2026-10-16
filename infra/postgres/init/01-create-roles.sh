#!/bin/sh

set -eu

# ============================================================
# Lara — PostgreSQL Role Provisioning
# ============================================================
#
# Executed by the official PostgreSQL Docker image
# when initializing a fresh database cluster.
#
# This script:
#
# 1. Creates the application database role.
# 2. Creates the migration database role.
# 3. Assigns the required database privileges.
# 4. Restricts application schema creation.
#
# Application tables are created separately by Drizzle.
#
# ============================================================

# Verify that required environment variables exist.
# The :? syntax also rejects empty values.

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${MIGRATION_DATABASE_PASSWORD:?MIGRATION_DATABASE_PASSWORD is required}"

echo "Initializing Lara PostgreSQL roles..."

# Connect using the PostgreSQL initialization administrator.
#
# -X prevents loading psql startup configuration.
# ON_ERROR_STOP makes provisioning fail on SQL errors.
# pager=off keeps output in the container logs.
#
# The quoted heredoc prevents shell expansion of SQL.
#
# Passwords are read from environment variables inside psql,
# avoiding password arguments in the process command line.

psql \
  -X \
  -v ON_ERROR_STOP=1 \
  -P pager=off \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'

-- ============================================================
-- 1. Read credentials securely from environment variables.
-- ============================================================

\getenv app_password DATABASE_PASSWORD
\getenv migrator_password MIGRATION_DATABASE_PASSWORD
\getenv database_name POSTGRES_DB

BEGIN;

-- ============================================================
-- 2. Create restricted application role.
-- ============================================================

CREATE ROLE lara_app
WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD :'app_password';

-- ============================================================
-- 3. Create dedicated migration role.
-- ============================================================

CREATE ROLE lara_migrator
WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD :'migrator_password';

-- ============================================================
-- 4. Restrict database creation privileges.
-- ============================================================

REVOKE CREATE
ON DATABASE :"database_name"
FROM PUBLIC;

-- ============================================================
-- 5. Grant database access.
-- ============================================================

GRANT CONNECT
ON DATABASE :"database_name"
TO lara_app, lara_migrator;

-- ============================================================
-- 6. Allow migration infrastructure creation.
-- ============================================================
--
-- Drizzle's PostgreSQL migrator executes:
--
-- CREATE SCHEMA IF NOT EXISTS public;
--
-- PostgreSQL requires database-level CREATE permission
-- for this statement.
--
-- Only lara_migrator receives this privilege.

GRANT CREATE
ON DATABASE :"database_name"
TO lara_migrator;

-- ============================================================
-- 7. Secure the public schema.
-- ============================================================

REVOKE CREATE
ON SCHEMA public
FROM PUBLIC;

REVOKE ALL PRIVILEGES
ON SCHEMA public
FROM lara_app;

-- ============================================================
-- 8. Allow application schema usage.
-- ============================================================
--
-- lara_app can resolve objects in public.
-- Table permissions are granted separately by migrations.

GRANT USAGE
ON SCHEMA public
TO lara_app;

-- ============================================================
-- 9. Allow migration schema modifications.
-- ============================================================

GRANT USAGE, CREATE
ON SCHEMA public
TO lara_migrator;

COMMIT;

SQL

echo "Lara PostgreSQL role provisioning completed."
