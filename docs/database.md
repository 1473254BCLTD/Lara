# Lara — Database Architecture and Operations

## Overview

Lara uses PostgreSQL 18 with Drizzle ORM.

The database supports a multi-tenant SaaS architecture with
separate staff identities, customer authentication accounts,
and tenant-scoped customer profiles.

PostgreSQL Row-Level Security (RLS) provides an additional
isolation layer for tenant-owned data.

## 1. Development Infrastructure

Local development uses Docker Compose for:

- PostgreSQL 18
- Redis 8

Application processes run natively using Node.js.

Docker Compose configuration:

`infra/compose.dev.yaml`

### Start development infrastructure

From the monorepo root:

```bash
docker compose \
  --env-file infra/.env \
  -f infra/compose.dev.yaml \
  up -d
```

### Check container health

```bash
docker compose \
  --env-file infra/.env \
  -f infra/compose.dev.yaml \
  ps
```

PostgreSQL and Redis ports are bound to localhost.

Their data is persisted using Docker named volumes.

Do not delete database volumes during routine development.

## 2. PostgreSQL Roles

Lara separates database administration, schema migrations,
and normal application access.

### lara

The PostgreSQL administrative role used for local
infrastructure initialization and administration.

This role must never be used by application processes.

### lara_migrator

The dedicated migration role.

Responsibilities include:

- Creating application tables
- Creating indexes and constraints
- Creating PostgreSQL security functions
- Managing RLS policies
- Managing application table privileges

The role has CREATE permission on the development database
and the public schema.

Database-level CREATE is required because Drizzle's
PostgreSQL migrator initializes its migration schema using
CREATE SCHEMA IF NOT EXISTS.

This role must not be used by the API server or worker.

### lara_app

The restricted runtime application role.

Restrictions:

- Not a superuser
- Cannot create databases
- Cannot create schemas
- Cannot create tables
- Cannot bypass RLS
- Cannot assume the migration role

Application table privileges are explicitly granted
through migrations.

## 3. Database Provisioning

Fresh development databases automatically initialize
the required PostgreSQL roles.

Provisioning script:

`infra/postgres/init/01-create-roles.sh`

The script executes through PostgreSQL's official
Docker initialization mechanism.

Initialization scripts run only when the PostgreSQL
database cluster is first created.

They do not automatically execute again when an
existing container is restarted or recreated.

Existing databases require a separate administrative
procedure when provisioning changes are necessary.

Do not delete an existing PostgreSQL volume to force
initialization scripts to run.

Production database provisioning must be handled
separately using appropriate administrative credentials
and secret management.

### Provisioning verification

The initialization script has been tested against an
isolated PostgreSQL 18 container.

Verified properties:

- Both restricted roles are created
- Both roles can authenticate
- Migration role has the required CREATE privileges
- Application role cannot create database objects
- Application role cannot assume the migration role
- Neither restricted role has elevated PostgreSQL privileges

The disposable test container was removed afterward.

### Test-only database initialization

Local integration tests and GitHub Actions share the same
PostgreSQL test provisioning infrastructure.

The test environment is defined by:

`infra/compose.test.yaml`

PostgreSQL initialization is separated by responsibility:

- `infra/postgres/init/01-create-roles.sh` provisions the
  shared PostgreSQL roles and privileges.
- `infra/test/postgres/init/02-mark-test-database.sh`
  initializes the test-only database identity marker.

The second script is mounted only by the test Compose
configuration. It verifies that the database is `lara_test`
and the PostgreSQL administrator is `lara` before executing.

The identity marker is:

`lara:integration-test-only:v1`

PostgreSQL executes these scripts in filename order when
initializing a fresh database cluster.

Existing PostgreSQL volumes are not reinitialized when
containers restart. Do not delete existing database volumes
to force initialization.

The protected migration runner independently verifies
the test database identity, migration role, host, port,
and explicit `--integration-test` argument.

Local testing and GitHub Actions must use the same
provisioning scripts and protected migration runner.

The initialization process was verified against a fresh,
disposable PostgreSQL 18 instance on October 18, 2026.
Both scripts executed successfully, the database marker
was verified, and the restricted role privileges matched
the expected security configuration.

The disposable verification environment was removed
without affecting the existing development or test databases.

Detailed integration-test procedures and CI configuration
are documented in [testing.md](./testing.md).

## 4. Environment Configuration

Local development application and infrastructure environment:

`infra/.env`

Migration environment:

`infra/.env.migration`

Version-controlled examples:

- `infra/.env.example`
- `infra/.env.migration.example`

Actual environment files contain sensitive credentials
and must never be committed to Git.

The application uses DATABASE_* credentials.

Migration commands use MIGRATION_DATABASE_* credentials.

Migration authentication requires the PostgreSQL role
lara_migrator.

The Express API and background worker must use lara_app.

### Application runtime configuration

The Express API is implemented as a native Node.js process. It initializes its own database runtime through `@lara/database`, verifies that PostgreSQL connections use the restricted `lara_app` role without superuser or RLS bypass privileges, and closes PostgreSQL resources during graceful shutdown after closing its HTTP listener.

The background worker is an established architectural decision but is not yet implemented. It will run as an independent native Node.js process, initialize its own `@lara/database` runtime using `lara_app`, and manage its own database connections and shutdown. The API and worker must not share application bootstraps or process lifecycles.

Application processes must not execute database migrations during startup. Migrations remain separate operations using `lara_migrator`.

Local development uses environment configuration associated with `infra/`. The existing `infra/.env` contains infrastructure credentials as well as application database settings. API and worker processes should receive only the credentials necessary for their responsibilities.

The application must never connect using the PostgreSQL administrative role `lara` or the migration role `lara_migrator`.

In production, PostgreSQL runs as a native host-installed service. The API and worker receive configuration through protected process environments outside the repository. Application code must not depend on local `infra/` file paths.

The same `DATABASE_*` variable names and database validation are used across development and production. The configuration source changes, not the database connection architecture.

The isolated `infra/.env.test` configuration is reserved for integration testing and must never be used for normal development or production database connections.

## 5. Database Schema

Schema definitions are located in:

`packages/database/src/schema/`

The initial database contains five tables.

### tenants

Global tenant identity and lifecycle information.

Tenant statuses include:

- pending
- active
- suspended
- archived

### users

Global staff and platform administrator identities.

Staff accounts are separate from customer accounts.

Staff statuses include:

- invited
- active
- disabled

### tenant_memberships

Connects staff users to tenants.

Staff users may belong to multiple tenants.

Each membership has an independent role and status.

### customer_auth_accounts

Global customer authentication identities.

One authentication account may be associated with
customer profiles belonging to multiple tenants.

Customer authentication remains separate from staff
authentication.

### customers

Tenant-specific customer profiles.

Each profile belongs to exactly one tenant.

A profile may reference a global customer authentication
account.

Customer records never reference the staff users table.

## 6. Database Migrations

Drizzle Kit generates migrations.

Drizzle ORM's programmatic migrator applies them.

Migration files:

`packages/database/drizzle/`

Migration runner:

`packages/database/scripts/migrate.mjs`

Migration history:

`public.__drizzle_migrations`

### Generate a migration

From the monorepo root:

```bash
pnpm --filter @lara/database db:generate --name=change_name
```

Review the generated SQL before applying it.

### Validate migration consistency

```bash
pnpm --filter @lara/database db:check
```

### Apply pending migrations

```bash
pnpm --filter @lara/database db:migrate
```

The migration runner:

- Uses dedicated migration credentials
- Verifies the connected PostgreSQL role
- Executes pending migrations
- Reports database errors
- Closes database connections

Migrations must be executed explicitly.

They must not run automatically when the API server
or background worker starts.

### Migration rules

1. Never modify an already-applied migration.
2. Create a new migration for subsequent schema changes.
3. Review generated SQL before applying migrations.
4. Use custom SQL when required for PostgreSQL-specific features.
5. Keep security functions, grants, and RLS policies version-controlled.
6. Only one deployment process should apply migrations at a time.
7. Test migrations against an isolated database before production deployment.

## 7. Row-Level Security

RLS is enabled on:

- customers
- tenant_memberships

Current policies:

- customers_customer_self_select
- customers_staff_select
- tenant_memberships_staff_self_select

Normal tenant access requires an active actor and
an active tenant.

Staff access additionally depends on tenant membership.

Customer self-access is restricted to the authenticated
customer's linked profile in the selected tenant.

Currently, the policies permit SELECT operations only.

Authenticated write operations will require additional
authorization policies and database privileges.

## 8. Security Helper Functions

### lara_actor_is_active()

Checks whether the current staff or customer
authentication account is active.

### lara_tenant_is_active(uuid)

Checks whether a specified tenant exists and is active.

Both functions use SECURITY DEFINER.

Function ownership and execution privileges must remain
restricted.

The application role may execute these functions but
does not receive unrestricted access to global
authentication tables.

## 9. Tenant Transaction Context

Tenant context is implemented in:

`packages/database/src/tenant-context.ts`

The application establishes:

- app.tenant_id
- app.actor_type
- app.actor_id

These settings are transaction-local.

Database operations must execute within the same
transaction that establishes their security context.

Transaction-local settings help prevent context leaking
between requests through pooled connections.

### Important security considerations

PostgreSQL custom settings do not authenticate users.

The application must derive actor identity and tenant
authorization from trusted server-side authentication state.

Zod validation alone does not establish authorization.

RLS is defense in depth, not a replacement for
application authentication and authorization.

## 10. Security Verification

The initial migration was tested using PostgreSQL
transactions and the restricted application role.

Verified scenarios included:

- Missing authentication context
- Authorized staff access
- Unauthorized cross-tenant staff access
- Customer profile isolation
- Disabled staff accounts
- Invited staff accounts
- Disabled memberships
- Suspended tenants
- Pending tenants
- Archived tenants
- Disabled customer accounts
- Missing customer identities
- Denied customer write privileges

The initial manual security tests passed.

### Automated integration tests

The PostgreSQL integration suite uses Vitest against the isolated `lara_test` database.

Run the complete suite from the monorepo root:

```bash
pnpm test:integration
```

Run the database workspace suite directly:

```bash
pnpm --filter @lara/database test
```

Type-check the integration tests:

```bash
pnpm --filter @lara/database exec tsc --project tsconfig.test.json --noEmit --pretty false
```

The test infrastructure is defined in `infra/compose.test.yaml` and `infra/.env.test`. RLS assertions use the restricted `lara_app` role, while `lara_migrator` prepares and cleans up test fixtures.

Automated coverage includes:

- Tenant membership isolation and missing authentication context.
- Disabled staff accounts and disabled memberships.
- Customer profile isolation and disabled customer authentication accounts.
- Cross-tenant access denial and multiple tenant memberships.
- Suspended-tenant access restrictions for staff and customers.
- Database privileges, RLS policies, security helper functions, and fixture safeguards.

Run integration tests only against the isolated test database. Never run them against `lara_dev` or a production database.

## 11. Future Work

The database foundation is established, but additional
implementation is required for:

- Staff authentication
- Customer authentication
- Account and session management
- Tenant authorization middleware
- Customer creation and modification policies
- Administrative database operations
- Production provisioning and deployment procedures
- Database backup and recovery procedures

Database security must be reevaluated when new
tenant-owned tables or authorization workflows
are introduced.
