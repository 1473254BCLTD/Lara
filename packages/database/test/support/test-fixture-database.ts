import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { createDatabaseRuntime } from "../../src/lifecycle.js";

/**
 * Lara — PostgreSQL Integration Test Fixtures
 *
 * Provides a verified migration-role connection for
 * preparing and cleaning up integration test fixtures.
 *
 * IMPORTANT:
 * Never use this connection for RLS assertions.
 *
 * RLS assertions must execute through the restricted
 * lara_app connection in test-database.ts.
 */

const expectedConfig = {
  MIGRATION_DATABASE_HOST: "127.0.0.1",
  MIGRATION_DATABASE_PORT: "5433",
  MIGRATION_DATABASE_NAME: "lara_test",
  MIGRATION_DATABASE_USER: "lara_migrator",
} as const;

const expectedDatabaseMarker =
  "lara:integration-test-only:v1";

/**
 * Load the isolated test environment.
 *
 * Do not modify process.env.
 */
function loadTestEnvironment() {
  const file = new URL(
    "../../../../infra/.env.test",
    import.meta.url,
  );

  return parseEnv(readFileSync(file, "utf8"));
}

/**
 * Validate the fixture database destination before
 * establishing any PostgreSQL connection.
 */
function validateFixtureConfiguration(
  env: Record<string, string | undefined>,
): void {
  for (const [key, expected] of Object.entries(
    expectedConfig,
  )) {
    if (env[key] !== expected) {
      throw new Error(
        `Unsafe fixture database configuration: ${key}`,
      );
    }
  }

  if (
    !/^[a-f0-9]{64}$/.test(
      env.MIGRATION_DATABASE_PASSWORD ?? "",
    )
  ) {
    throw new Error(
      "Invalid fixture database password.",
    );
  }
}

/**
 * Create a verified fixture database runtime.
 *
 * Uses lara_migrator to prepare controlled test data.
 *
 * The caller must close the returned runtime.
 */
export async function createVerifiedFixtureDatabaseRuntime() {
  const env = loadTestEnvironment();

  // Validate before opening a connection.
  validateFixtureConfiguration(env);

  /**
   * Reuse Lara's existing database runtime.
   *
   * Map migration credentials to the environment
   * structure expected by createDatabaseRuntime().
   */
  const runtime = createDatabaseRuntime({
    DATABASE_HOST: env.MIGRATION_DATABASE_HOST,
    DATABASE_PORT: env.MIGRATION_DATABASE_PORT,
    DATABASE_NAME: env.MIGRATION_DATABASE_NAME,
    DATABASE_USER: env.MIGRATION_DATABASE_USER,
    DATABASE_PASSWORD: env.MIGRATION_DATABASE_PASSWORD,

    DATABASE_POOL_MAX: "1",
  });

  try {
    /**
     * Verify actual PostgreSQL identity, role
     * configuration, and fixture table privileges.
     */
    const result = await runtime.pool.query<{
      database_name: string;
      database_role: string;
      session_role: string;
      database_marker: string | null;
      is_superuser: boolean;
      can_bypass_rls: boolean;
      can_create_database: boolean;
      can_manage_fixture_tables: boolean;
    }>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_role,
        session_user AS session_role,

        shobj_description(
          d.oid,
          'pg_database'
        ) AS database_marker,

        r.rolsuper AS is_superuser,
        r.rolbypassrls AS can_bypass_rls,
        r.rolcreatedb AS can_create_database,

        (
          SELECT bool_and(
            has_table_privilege(
              current_user,
              format('public.%I', table_name),
              'SELECT'
            )
            AND
            has_table_privilege(
              current_user,
              format('public.%I', table_name),
              'INSERT'
            )
            AND
            has_table_privilege(
              current_user,
              format('public.%I', table_name),
              'UPDATE'
            )
            AND
            has_table_privilege(
              current_user,
              format('public.%I', table_name),
              'DELETE'
            )
          )

          FROM (
            VALUES
              ('tenants'),
              ('users'),
              ('tenant_memberships'),
              ('customer_auth_accounts'),
              ('customers')
          ) AS fixture_tables(table_name)
        ) AS can_manage_fixture_tables

      FROM pg_catalog.pg_database AS d

      JOIN pg_catalog.pg_roles AS r
        ON r.rolname = current_user

      WHERE d.datname = current_database()
    `);

    const identity = result.rows[0];

    if (
      result.rows.length !== 1 ||
      !identity ||
      identity.database_name !== "lara_test" ||
      identity.database_role !== "lara_migrator" ||
      identity.session_role !== "lara_migrator" ||
      identity.database_marker !== expectedDatabaseMarker ||
      identity.is_superuser !== false ||
      identity.can_bypass_rls !== false ||
      identity.can_create_database !== false ||
      identity.can_manage_fixture_tables !== true
    ) {
      throw new Error(
        "Fixture database identity or privilege verification failed.",
      );
    }

    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
