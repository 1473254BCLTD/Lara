# Lara — Architecture

## Purpose and Scope

This document describes the architecture of Lara, the responsibilities of its applications and shared packages, the boundaries between system components, and the reasoning behind significant design decisions.

It is the central architectural reference for the project. It should describe the implementation accurately and distinguish established decisions from planned capabilities.

Detailed database implementation, PostgreSQL permissions, migrations, and operational procedures are documented in [database.md](./database.md).

Testing strategy, test commands, coverage, and testing safety requirements are documented in [testing.md](./testing.md).

## 1. Project Overview

Lara is a multi-tenant SaaS platform built as a TypeScript monorepo.

The platform provides tenant administration, customer booking and pass interfaces, customer self-check-in, and a super-administrator interface.

The architecture separates customer identities from staff identities, centralizes API access, shares common TypeScript contracts and utilities, and uses PostgreSQL Row-Level Security as an additional tenant-isolation boundary.

The project prioritizes maintainability, security, explicit authorization, and incremental development.

## 2. Technology Stack

| Area | Technology | Responsibility |
|---|---|---|
| Language | TypeScript | Shared application and server language |
| Package management | pnpm Workspaces | Dependency management and workspace linking |
| Build orchestration | Turborepo | Coordinating builds, tests, linting, and type checks |
| API | Express.js | Central HTTP API |
| Frontend | React and Vite | Customer and administrative interfaces |
| Validation | Zod | Runtime validation and shared contracts |
| Server state | TanStack Query | Frontend server-state management |
| Database | PostgreSQL 18 | Persistent relational data and tenant isolation |
| ORM | Drizzle ORM | Typed database queries and schema definitions |
| Migrations | Drizzle Kit | Generating and checking database migrations |
| Background jobs | Redis-backed queue | Asynchronous work, including emails and webhooks |
| Testing | Vitest | Automated testing, including PostgreSQL integration tests |
| Runtime | Node.js | Native execution of server-side application processes |

Application processes run natively under Node.js. Docker Compose provides local PostgreSQL and Redis infrastructure rather than containerizing the application processes.

## 3. Monorepo Structure

### Applications

| Application | Responsibility |
|---|---|
| apps/server | Central Express.js API |
| Background worker (planned; workspace pending) | Separate native Node.js process for asynchronous jobs |
| apps/admin | Tenant administration dashboard |
| apps/booking-widget | Customer booking interface |
| apps/pass-widget | Customer pass interface |
| apps/self-checkin | Customer self-check-in application |
| apps/console | Super-administrator interface |
| apps/embed | Compiled JavaScript for embedding and launching customer widgets on external websites |

### Shared packages

| Package | Responsibility |
|---|---|
| packages/api-client | Shared API client |
| packages/contracts | Shared Zod validation schemas and API contracts |
| packages/database | Database connections, Drizzle integration, schema, migrations, and tenant security context |
| packages/eslint-config | Shared linting configuration |
| packages/typescript-config | Shared TypeScript configurations |
| packages/ui | Reusable user-interface components |
| packages/utils | Shared utility functions |

The root package manages workspace-wide commands. Turborepo coordinates tasks across packages and applications.

Applications should reuse shared packages instead of independently redefining common contracts, database access conventions, or configuration.

### Shared package boundaries

- `@lara/contracts` defines reusable Zod schemas and types for API requests, responses, and appropriate cross-process messages. Validation does not establish authentication or authorization.
- `@lara/database` owns PostgreSQL configuration validation, connection management, Drizzle integration, schema definitions, migrations, and transaction-local security context.
- `@lara/api-client` provides reusable typed HTTP communication with the Express API, using shared contracts where appropriate.
- `@lara/utils` contains general-purpose utilities that do not require privileged application infrastructure.

Frontend applications communicate with PostgreSQL through the Express API. They must not access the database directly or depend on backend database runtime utilities.

The Express API and background worker are designed as independent Node.js processes. As each component is implemented, it must reuse shared infrastructure packages, initialize its own process-scoped database runtime, and manage its own startup and shutdown.

The API and worker must use the restricted `lara_app` PostgreSQL role. Background processing must preserve applicable authorization and tenant-isolation requirements.

Server-specific runtime configuration belongs to the Express application. Worker-specific runtime configuration belongs to the worker application. Shared infrastructure validation belongs to the package responsible for that infrastructure. Runtime secrets and process environment configuration do not belong in `@lara/contracts`.

## 4. Runtime and Component Boundaries

### Backend module organization

Backend applications follow feature-based organization with separation of concerns. Business domains such as customers, bookings, passes, and authentication contain their relevant layers.

- Routes define HTTP endpoints and attach middleware to controllers.
- Controllers handle HTTP requests and responses while delegating business operations to services.
- Services implement business workflows, application authorization, and transaction coordination.
- Repositories encapsulate persistence operations using Drizzle and `@lara/database`. Tenant-scoped queries must use the appropriately authorized transaction context.
- Shared API middleware handles cross-cutting HTTP responsibilities such as authentication, validation, and error handling.
- Background workers use job handlers or processors rather than Express controllers. Job payloads do not independently establish authorization.
- General utilities remain separate from business-specific responsibilities.

Services must establish trusted actor and tenant authorization before invoking tenant-scoped database operations. Controllers and repositories must not bypass these checks.

The API and worker may share contracts and infrastructure packages but must not import each others application bootstrap. Extract reusable business logic into an appropriate shared package only when a demonstrated need exists.

Introduce layers only when their responsibilities justify them. Prefer repository terminology for database persistence and storage terminology for file or object storage.

### API server

The Express 5 API is the central backend boundary for application requests.

The implemented foundation resides in `apps/server/src/`:

- `app.ts` creates Express, disables `X-Powered-By`, and registers shared HTTP middleware.
- `middleware/http-errors.ts` handles unmatched routes and unexpected HTTP errors.
- `env.ts` validates HTTP runtime configuration with Zod.
- `database-startup.ts` initializes `@lara/database` using the restricted `lara_app` role, verifies the actual PostgreSQL role is not a superuser and cannot bypass RLS, and closes resources on initialization failure.
- `lifecycle.ts` coordinates database initialization, HTTP startup, and resource cleanup. Graceful shutdown closes HTTP connections before PostgreSQL resources.
- `shutdown-deadline.ts` manages shutdown deadline timing.
- `server.ts` owns operating-system signals, logging, exit status, and the 10-second shutdown deadline.

HTTP listening begins only after successful database initialization. API startup never executes database migrations. Each API process owns its database runtime and HTTP listener.

Business routes, authentication, application authorization middleware, and tenant workflows are not yet implemented. Future endpoints must validate input, authenticate actors, enforce server-side authorization, and use authorized transaction-local tenant context.

HTTP errors follow the shared `@lara/contracts` response structure: `{ error: { code, message } }`. Unmatched routes return HTTP 404 (`NOT_FOUND`), while unexpected errors return HTTP 500 (`INTERNAL_ERROR`) without exposing internal exception details.

Feature routes must precede the not-found handler, and centralized error handling must be registered last. Errors occurring after response headers are sent are delegated to Express. Unexpected errors are currently logged server-side; structured logging and sensitive-data redaction remain future work.

Request-validation middleware, expected client-error mapping, authentication, and tenant authorization are not yet implemented.

The frontend, Zod validation, and PostgreSQL RLS do not independently establish application authorization.

### Frontend applications

The React applications provide distinct interfaces for tenant staff, customers, and platform administrators.

Customer booking and pass workflows use tenant-branded interfaces. Staff administration uses staff identities and tenant memberships.

Shared contracts and UI components should be reused where appropriate without collapsing the separate responsibilities of customer-facing and administrative applications.

### Background worker

The target architecture uses a separate Node.js background worker for asynchronous tasks, including emails and webhooks.

Redis is the chosen job queue backend for development and production. CI will add Redis services when queue or worker tests require them. The current verified CI database integration environment provisions PostgreSQL only.

As of October 18, 2026, the dedicated worker workspace has not been created. The worker is an established architectural component, not a completed implementation.

The worker remains a separate process from the Express API so background processing does not need to execute inside API request handling.

### Infrastructure

PostgreSQL stores persistent application data. Redis supports background jobs.

Development infrastructure is defined through Docker Compose. CI should provide the infrastructure required by its tests. Production application processes run natively under Node.js.

## 5. Multi-Tenant Data Architecture

Lara uses a shared PostgreSQL database with tenant ownership represented explicitly on tenant-scoped records.

The application enforces authorization, and PostgreSQL RLS provides an additional enforcement layer.

### Tenant records

The tenants table contains core tenant identity and lifecycle information.

The core table deliberately does not contain a slug. Tenant-specific configuration belongs in related tables rather than expanding the core tenant record unnecessarily.

Tenant lifecycle states include pending, active, suspended, and archived.

Normal tenant operations must respect tenant lifecycle status.

### Staff identities

The users table represents global staff identities.

The tenant_memberships table connects staff identities to individual tenants and records their tenant-specific roles and membership status.

A staff member may belong to multiple tenants. The application must authorize the selected tenant rather than assuming that authentication alone grants access to every tenant.

Staff identities and customer identities are separate.

### Customer identities

Customer authentication uses the global customer_auth_accounts table.

Tenant-specific customer information belongs in the customers table. Each customer profile is associated with a tenant and may link to a global customer authentication account.

This model permits one customer login to be associated with separate customer profiles in multiple tenants.

A customer profile must not become a staff user. Sharing an email address does not make the two identity types interchangeable.

Customer names and other tenant-specific profile information remain on the tenant-scoped customer record.

### Future domain data

Bookings, passes, tenant payment profiles, and additional domain tables will extend this foundation.

New tenant-owned tables must define their ownership, authorization rules, database privileges, and RLS policies before being used by application workflows.

## 6. Security Architecture

### Defense in depth

Authorization must be enforced by trusted server-side application logic and supported by PostgreSQL permissions and RLS.

Client-supplied tenant identifiers are not proof of authorization.

Zod validation verifies data structure and constraints; it does not establish that an actor is authorized to access a tenant.

### Database roles

The database uses distinct roles for administration, migrations, and application runtime:

- lara: database administration and ownership.
- lara_migrator: controlled schema migration operations.
- lara_app: restricted application runtime access.

The application role must not receive unrestricted access to global identity tables or schema-management privileges.

See [database.md](./database.md) for the detailed permission model and verification procedures.

### Transaction-local security context

Tenant-scoped operations establish transaction-local PostgreSQL settings for:

- app.tenant_id
- app.actor_type
- app.actor_id

Database operations that depend on this context must execute in the same transaction.

This prevents tenant context from being intentionally carried between unrelated operations through a pooled connection.

The context must be derived from trusted server-side authentication and authorization state.

### Row-Level Security

RLS policies restrict visibility according to the current actor, tenant, account status, membership status, and tenant lifecycle status where applicable.

Security helper functions use restricted execution permissions and a controlled search path.

RLS is an additional protection layer, not a substitute for authentication or application authorization.

### Super-administrator access

The platform console requires a controlled way to access tenant administration.

Any implementation of tenant assumption or impersonation must define explicit authorization, tenant-context handling, and appropriate auditing before the capability is considered production-ready.

## 7. Tenant Payments

Each tenant will have its own payment integration configuration.

The intended options are Stripe Connect or a tenant-owned Stripe account using a bring-your-own-key model.

Payment credentials must remain server-side and must never be exposed to customer-facing applications.

Lara should not store raw payment-card details.

Tenant payment configuration belongs in a dedicated integration or settings table rather than the core tenants table.

## 8. Deployment and Infrastructure Decisions

The established deployment approach is:

- Run the Express API as a native Node.js process.
- Run the background worker as a separate native Node.js process.
- Use PostgreSQL for persistent data.
- Use Redis for background job processing.
- Use Docker Compose for PostgreSQL and Redis in local development and for isolated test infrastructure in CI.
- In production, run PostgreSQL 18 and Redis 8 as native host-installed services, without Docker.
- Provide API and worker production configuration through protected process environments outside the repository. Local infra environment files are not production configuration.
- Provision isolated CI test services using the existing Compose-based test configuration.
- Keep application deployment independent of Docker containers.

The isolated PostgreSQL integration-test environment must remain separate from the development database and production databases.

### Shared integration-test infrastructure

Local PostgreSQL integration tests and GitHub Actions reuse
the same Docker Compose test configuration:

`infra/compose.test.yaml`

Shared database role provisioning remains under `infra/postgres/`.

Test-specific database initialization belongs under `infra/test/`.

Both environments use the same protected migration runner,
database identity checks, restricted PostgreSQL roles,
and automated integration-test suite.

CI creates disposable PostgreSQL infrastructure with
temporary credentials. Development and production database
resources must never be shared with integration tests.

The GitHub Actions workflow is defined in:

`.github/workflows/ci.yml`

The workflow has passed local configuration validation,
workspace checks, protected migrations, and integration tests.

GitHub Actions CI successfully executed on a GitHub-hosted
runner on October 18, 2026, using the `develop` branch.

The verified integration-test results were 13 passing
test files and 19 passing tests.

GitHub Actions run:
https://github.com/1473254BCLTD/Lara/actions/runs/39127408832

The shared PostgreSQL integration-test infrastructure
is now operational in both local development and CI.

Detailed testing procedures and CI verification are documented
in [testing.md](./testing.md).

Database provisioning and security safeguards are documented
in [database.md](./database.md).



## 9. Current Implementation and Planned Work

The current database foundation includes:

- Core tenant records.
- Global staff identities and tenant memberships.
- Global customer authentication accounts.
- Tenant-scoped customer profiles.
- Database roles and restricted application privileges.
- Transaction-local tenant security context.
- RLS policies and security helper functions.
- Automated PostgreSQL integration tests.

The Express API foundation is implemented and locally verified. It includes validated runtime configuration, restricted PostgreSQL initialization, lifecycle coordination, graceful shutdown, and bounded shutdown timing.

The API has 27 passing automated unit tests across seven files. Production and test TypeScript checks and the production build have passed locally. GitHub Actions includes API unit tests and test-specific TypeScript validation. The updated workflow passed on `develop` on October 20, 2026, for commit `b9b586b`, with 27 Express unit tests and 19 PostgreSQL integration tests passing. See [testing.md](./testing.md) for the verified CI run.

The broader product still requires implementation of additional capabilities, including staff and customer authentication workflows, bookings, passes, administrative APIs, payment integrations, and background job processing.

A planned capability must not be described as implemented until its implementation has been verified.

## 10. Architecture Decision Principles

Significant architectural decisions should document:

1. The problem being addressed.
2. The chosen approach.
3. The reason for choosing it.
4. Important alternatives and trade-offs.
5. Security, performance, and maintenance implications.
6. Whether the decision is established or still planned.

Avoid unnecessary dependencies, duplicate abstractions, and architectural changes that do not solve a demonstrated problem.

## 11. Documentation Maintenance

Review this document whenever a milestone changes the system architecture, component boundaries, security model, technology stack, deployment approach, or a significant design decision.

Keep detailed operational instructions in the appropriate focused document and link to them rather than duplicating them.

All project documentation belongs under the repository-root docs directory.

When a topic no longer fits cleanly within the existing documentation, propose a dedicated document and explain its intended scope.

At each milestone, review the relevant documentation before declaring the work complete.
