# Lara — Testing Strategy

## Purpose and Scope

This document describes Lara's testing strategy, tools, commands, database test infrastructure, security coverage, and known gaps.

It is the authoritative reference for how developers run and maintain automated tests.

Architectural boundaries and design decisions are documented in [architecture.md](./architecture.md). Detailed PostgreSQL configuration, migrations, database roles, and Row-Level Security implementation are documented in [database.md](./database.md).

## 1. Testing Principles

Lara follows these principles:

- Test important behavior rather than implementation details alone.
- Use real PostgreSQL integration tests when verifying database permissions, transactions, and Row-Level Security.
- Test both authorized access and denied access.
- Run database security tests using restricted roles rather than administrative connections.
- Keep integration-test infrastructure separate from development and production databases.
- Make fixtures isolated, safe to create, and safe to clean up.
- Fail closed when database identity or required security configuration does not match expectations.
- Run TypeScript validation alongside automated tests.
- Expand coverage as new applications, APIs, background jobs, and domain capabilities are implemented.

A passing test suite provides evidence about the scenarios covered. It does not prove that every possible security vulnerability or failure mode has been eliminated.

## 2. Current Test Layers

### PostgreSQL integration tests

The implemented automated suite lives in `packages/database/test/integration/`.

These tests execute against a real PostgreSQL instance. They are not substitutes for unit tests, API tests, frontend tests, or end-to-end tests.

The suite currently verifies database connectivity, restricted privileges, fixture safety, tenant isolation, staff membership authorization, customer profile isolation, tenant lifecycle restrictions, and security configuration.

### Express API unit tests

The Express API unit test suite is implemented in `apps/server/test/unit/`.

The suite currently contains eight test files with 31 passing tests:

- `env.test.ts`: 9 tests.
- `env-security.test.ts`: 4 tests.
- `lifecycle.test.ts`: 4 tests.
- `lifecycle-state.test.ts`: 2 tests.
- `lifecycle-failures.test.ts`: 4 tests.
- `lifecycle-http.test.ts`: 1 test.
- `shutdown-deadline.test.ts`: 3 tests.
- `http-errors.test.ts`: 4 tests.

Coverage includes HTTP configuration validation, environment-security checks, lifecycle coordination, startup and cleanup failures, HTTP connection shutdown, and shutdown deadline behavior.

These tests use isolated dependencies, local HTTP servers where appropriate, and fake timers. They do not require a PostgreSQL test database.

Chapter 22 adds HTTP tests for structured 404 responses, synchronous and asynchronous 500 errors, sensitive-error masking, and delegation after response headers have been sent. On October 21, 2026, all 31 Express tests passed locally across eight files. Workspace build, workspace TypeScript checks, and Express test TypeScript checks also passed. Chapter 22 CI verification remains pending.

The compiled API has undergone separate manual process-level verification for restricted PostgreSQL startup, HTTP responses, graceful termination, and startup failures. The compiled shutdown-deadline helper was separately verified in an isolated child process that exited with code 1 when its deadline expired.

These tests establish the API infrastructure foundation. They do not establish business-route authentication, authorization, or tenant isolation coverage.

### Other test layers

Business API integration tests, frontend component tests, background-worker tests, and end-to-end tests remain future work.

Additional unit tests will be introduced as application services and business features are implemented.

Each additional test layer should have a clear purpose and appropriate isolation strategy.

## 3. Testing Tools and Configuration

### Vitest

The database package uses Vitest.

Configuration: `packages/database/vitest.config.ts`

Current settings:

- Environment: Node.js.
- Included files: `test/integration/**/*.test.ts`.
- File parallelism: disabled.
- Maximum concurrent tests: one.
- Watch mode: disabled.

Database test files execute sequentially to avoid simultaneous modification of shared PostgreSQL fixtures.

### TypeScript test configuration

Configuration: `packages/database/tsconfig.test.json`

The configuration includes database source files, integration tests, and the Vitest configuration. It enables type checking without emitting compiled files.

### Express API testing configuration

The Express API uses a separate Vitest configuration at `apps/server/vitest.config.ts`.

- Environment: Node.js.
- Included files: `test/unit/**/*.test.ts`.
- Watch mode: disabled.
- PostgreSQL and Redis are not required.

The Express test TypeScript configuration is `apps/server/tsconfig.test.json`. It includes application source files, unit tests, and the Vitest configuration without emitting compiled files.

The production TypeScript configuration and test TypeScript configuration serve different purposes. Both must be checked to verify application code and tests.

### Package scripts

The root `package.json` exposes these commands:

| Command | Purpose |
|---|---|
| `pnpm test` | Run workspace test tasks through Turborepo |
| `pnpm test:integration` | Run the database integration suite |
| `pnpm --filter @lara/server test` | Run Express API unit tests without PostgreSQL |
| `pnpm --filter @lara/server check-types:test` | Type-check Express source, unit tests, and Vitest configuration |
| `pnpm --filter @lara/database test` | Run the database package test suite directly |
| `pnpm --filter @lara/database exec tsc --project tsconfig.test.json --noEmit --pretty false` | Type-check the database source and integration tests |

The dedicated integration command is the preferred entry point for running the current PostgreSQL suite.

## 4. Isolated PostgreSQL Test Infrastructure

### Infrastructure files

The test environment is defined by:

- `infra/compose.test.yaml`
- `infra/.env.test`

The Compose configuration runs PostgreSQL 18 independently of the development database.

### Database identity

The verified integration-test environment uses:

| Setting | Expected value |
|---|---|
| Host | `127.0.0.1` |
| Host port | `5433` |
| Database | `lara_test` |
| Application role | `lara_app` |
| Fixture and migration role | `lara_migrator` |
| Database identity marker | `lara:integration-test-only:v1` |

The database identity marker helps distinguish the integration-test database from other databases.

The test helpers verify connection identity and expected role privileges before performing their work.

### Application connection

RLS assertions use `lara_app`, the restricted application role.

This ensures that security tests evaluate the permissions available to the application rather than relying on administrative privileges.

### Fixture connection

The fixture helper uses `lara_migrator` for controlled creation and cleanup of test records.

The fixture connection validates its expected role and restrictions. It must not be a superuser or have permission to bypass RLS.

Fixture operations use transactions and validate ownership information before removing records.

### Migration safeguards

The migration runner includes integration-test safeguards. It verifies the expected test environment and database identity before applying migrations.

Unexpected host, port, database, or user configuration must cause the operation to be rejected.

Do not weaken these safeguards merely to make a failing command succeed. Investigate the configuration mismatch first.

## 5. Running the Integration Suite

Run commands from the monorepo root.

### Step 1: Start the isolated test database

```bash
docker compose \
  --env-file infra/.env.test \
  -f infra/compose.test.yaml \
  up -d
```

This starts the dedicated PostgreSQL test service without starting or modifying the development infrastructure.

### Step 2: Check service status

```bash
docker compose \
  --env-file infra/.env.test \
  -f infra/compose.test.yaml \
  ps
```

Confirm that the test PostgreSQL service is healthy before proceeding.

If necessary, inspect its logs:

```bash
docker compose \
  --env-file infra/.env.test \
  -f infra/compose.test.yaml \
  logs --tail=100 postgres
```

### Step 3: Verify database preparation

Before running the suite, ensure that `lara_test` has been provisioned, marked as an integration-test database, and migrated using the repository's migration workflow with the required safeguards.

Consult [database.md](./database.md) for database migration and role-management procedures.

Do not substitute `lara_dev` or a production database.

### Step 4: Run all database integration tests

```bash
pnpm test:integration
```

This invokes the database package test script through the root integration-test command.

### Step 5: Type-check the tests

```bash
pnpm --filter @lara/database exec \
  tsc \
  --project tsconfig.test.json \
  --noEmit \
  --pretty false
```

A successful command produces no TypeScript diagnostics.

### Step 6: Stop the test infrastructure

```bash
docker compose \
  --env-file infra/.env.test \
  -f infra/compose.test.yaml \
  down
```

This stops and removes the Compose containers while retaining the named test database volume.

To deliberately remove the isolated test database volume as well:

```bash
docker compose \
  --env-file infra/.env.test \
  -f infra/compose.test.yaml \
  down -v
```

**Warning:** The second command deletes the test database volume and its contents. Use it only when an intentional test-database reset is required.

## 6. Current Integration Test Coverage

The verified baseline for this milestone is 13 test files and 19 passing tests.

The current test inventory is:

| Test file | Coverage |
|---|---|
| `database-connection.test.ts` | Application connection identity and restricted table privileges |
| `fixture-database-connection.test.ts` | Fixture connection identity and role restrictions |
| `fixtures.test.ts` | General fixture lifecycle |
| `staff-fixtures.test.ts` | Staff account and membership fixture lifecycle |
| `tenant-membership-rls.test.ts` | Visibility of a staff member's own active membership |
| `staff-disabled-account-rls.test.ts` | Access restrictions for disabled staff accounts |
| `staff-disabled-membership-rls.test.ts` | Access restrictions for disabled memberships |
| `multi-tenant-staff-rls.test.ts` | Multiple tenant memberships and independent membership status |
| `customer-rls.test.ts` | Tenant-specific customer profiles and disabled customer authentication accounts |
| `cross-tenant-authorization.test.ts` | Authorized staff access and reciprocal cross-tenant access denial |
| `tenant-status-rls.test.ts` | Staff membership access during tenant suspension and reactivation |
| `tenant-status-customer-rls.test.ts` | Customer profile access during tenant suspension |
| `security-configuration.test.ts` | RLS configuration, policies, privileges, and security helper functions |

The test count is a snapshot of the verified baseline, not a permanent expected count. Update it whenever tests are added, removed, or reorganized.

## 7. Security and Isolation Requirements

### Never use a development or production database

Integration tests must run only against the isolated test database.

The expected database name, host, port, role, and identity marker are safeguards against accidental use of another database.

### Test using the correct privileges

Security assertions should use the restricted application role.

Fixture preparation and cleanup should use the designated fixture connection and its verified permissions.

Do not use an administrative connection for application authorization assertions because its additional privileges could conceal security defects.

### Verify both access and denial

Security tests should verify that:

- Authorized actors can access permitted records.
- Actors cannot access another tenant without an appropriate membership.
- Disabled accounts and memberships cannot retain unauthorized access.
- Tenant lifecycle changes affect access as intended.
- Customer profiles remain isolated even when authentication accounts are shared.
- Application roles cannot perform unauthorized database operations.
- Security helper functions retain their intended execution permissions.

### Keep fixture cleanup narrow

Fixture cleanup must validate record ownership and delete only the records created for the relevant test.

Avoid broad cleanup operations that could remove unrelated records.

If cleanup fails, investigate the remaining fixtures rather than deleting records indiscriminately.

### Preserve fail-closed behavior

If a connection guard, privilege assertion, or security test fails, stop and investigate.

Do not bypass database identity checks, grant additional application privileges, or disable RLS merely to get a passing test result.

## 8. GitHub Actions CI

### Configuration

Lara uses GitHub Actions for continuous integration.

Workflow: `.github/workflows/ci.yml`

The workflow runs on pushes to `main` and `develop`, and on pull requests targeting either branch.

Node.js follows `.nvmrc`. pnpm uses the repository configuration and installs dependencies with frozen-lockfile enforcement.

### Execution sequence

1. Check out the repository.
2. Configure Node.js and pnpm.
3. Verify toolchain versions.
4. Build participating workspaces.
5. Run workspace TypeScript checks.
6. Type-check PostgreSQL integration tests.
7. Type-check Express API unit tests.
8. Run Express API unit tests.
9. Generate temporary PostgreSQL credentials.
10. Start the existing Docker Compose test infrastructure.
11. Wait for PostgreSQL readiness.
12. Execute protected Drizzle migrations.
13. Run PostgreSQL integration tests.
14. Clean up disposable CI infrastructure.

### Shared PostgreSQL provisioning

Local integration tests and CI reuse `infra/compose.test.yaml`.

Shared PostgreSQL role initialization:

`infra/postgres/init/01-create-roles.sh`

Test-specific database identity initialization:

`infra/test/postgres/init/02-mark-test-database.sh`

Fresh test database clusters automatically receive the identity marker:

`lara:integration-test-only:v1`

The migration runner and integration-test helpers independently verify database identity and restricted role privileges.

The migration runner requires the `--integration-test` argument.

### Credentials and security

Each CI run generates independent, cryptographically secure database passwords.

Credentials are stored temporarily in the Git-ignored `infra/.env.test` file.

CI never requires development or production database credentials.

RLS assertions execute as `lara_app`. Test fixtures use `lara_migrator`.

Database authorization and security safeguards must never be weakened to accommodate CI.

### Cleanup

The CI workflow uses `if: always()` to attempt cleanup even when earlier steps fail.

CI cleanup removes disposable PostgreSQL containers, networks, and volumes.

Local integration testing must preserve its existing database volume during routine operations.

### Verification — October 18, 2026

The following checks passed locally:

- GitHub Actions static validation using actionlint.
- Frozen-lockfile dependency installation.
- Workspace build: 2 successful tasks.
- Workspace TypeScript validation: 2 successful tasks.
- Integration-test TypeScript validation.
- Fresh PostgreSQL initialization.
- Database marker and restricted role verification.
- Protected Drizzle migrations.
- Integration tests: 13 files and 19 passing tests.
- Disposable verification infrastructure cleanup.

GitHub Actions CI passed on `develop` on October 18, 2026.

GitHub Actions run: https://github.com/1473254BCLTD/Lara/actions/runs/39127408832

The remote Vitest report confirms 13 passing test files and 19 passing tests, with zero failures.

The GitHub Actions run was reported successful, with all workflow steps green. Remote CI verification is complete for this milestone.

### Chapter 21 verification — October 20, 2026

The Express API foundation passed local verification:

- Seven unit test files and 27 passing tests.
- Production and test-specific TypeScript checks.
- Production TypeScript build.
- Compiled API startup, HTTP response, and graceful shutdown checks against the development database using restricted application credentials.
- Isolated forced-termination verification for the compiled shutdown-deadline helper.
- Local execution of the two new GitHub Actions commands.

The CI workflow now checks Express test TypeScript and runs API unit tests before provisioning PostgreSQL.

GitHub Actions CI completed successfully on `develop` on October 20, 2026, for commit `b9b586b`.

Verified remote results:

- Express API unit tests: 7 files and 27 passing tests.
- PostgreSQL integration tests: 13 files and 19 passing tests.
- Combined automated tests: 20 files and 46 passing tests.
- GitHub Actions `checks` job: successful.

GitHub Actions run: https://github.com/1473254BCLTD/Lara/actions/runs/39424108705

The October 18, 2026 CI verification above remains the historical record for the earlier database milestone.

### Current limitations

Only workspaces defining the corresponding build, type-check, or test scripts participate in those checks.

Current automated integration coverage focuses on PostgreSQL security and tenant isolation. Express infrastructure unit tests are implemented separately.

Business API integration tests, frontend component tests, background-worker tests, and end-to-end tests remain future work.

## 9. Current Gaps and Future Coverage

The current suite focuses on the database security foundation. It does not establish complete application-level coverage.

Future work includes:

- Unit tests for shared utilities and application logic.
- Express API tests for authentication, authorization, validation, and error handling.
- Customer authentication and staff authentication workflow tests.
- Frontend tests for administrative and customer-facing applications.
- Background-worker tests for email and webhook processing.
- Booking, pass, and payment integration tests.
- End-to-end tests for important customer and staff workflows.
- Expand CI coverage as additional application tests are implemented.
- Additional database tests as new tenant-owned tables, permissions, and RLS policies are introduced.

Prioritize tests according to security impact, business risk, and the capabilities being implemented.

## 10. Maintaining the Testing Documentation

Update this document whenever a milestone changes the testing tools, configuration, infrastructure, commands, coverage, or safety requirements.

At each milestone:

1. Run the relevant test suites.
2. Record the actual verification results.
3. Update the test inventory and coverage description where necessary.
4. Document important gaps and limitations.
5. Verify the documented commands against the current package scripts.
6. Ensure database testing safeguards remain explicit.

Architecture changes should also be reflected in [architecture.md](./architecture.md). Detailed database security and migration procedures remain in [database.md](./database.md).

All Lara documentation belongs under the repository-root `docs` directory.

Suggest a separate documentation file when a new testing topic becomes sufficiently complex that it no longer fits cleanly in this document.