import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { createDatabaseRuntime } from "../../src/lifecycle.js";

/**
 * Lara — PostgreSQL Integration Test Database
 *
 * Provides a verified connection to the isolated
 * PostgreSQL test database using the restricted
 * lara_app role.
 */

const expectedConfig = {
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "5433",
  DATABASE_NAME: "lara_test",
  DATABASE_USER: "lara_app",
} as const;

const expectedDatabaseMarker =
  "lara:integration-test-only:v1";

/**
 * Load test credentials independently of process.env.
 *
 * The path is resolved relative to this file.
 */
function loadTestEnvironment() {
  const file = new URL(
    "../../../../infra/.env.test",
    import.meta.url,
  );

  return parseEnv(readFileSync(file, "utf8"));
}

/**
 * Validate the database destination before connecting.
 */
function validateTestConfiguration(
  env: Record<string, string | undefined>,
): void {
  for (const [key, expected] of Object.entries(
    expectedConfig,
  )) {
    if (env[key] !== expected) {
      throw new Error(
        `Unsafe test database configuration: ${key}`,
      );
    }
  }

  if (!/^[a-f0-9]{64}$/.test(env.DATABASE_PASSWORD ?? "")) {
    throw new Error(
      "Invalid integration test database password.",
    );
  }
}

/**
 * Create a verified, restricted database runtime.
 *
 * The caller is responsible for closing the returned
 * runtime using runtime.close().
 */
export async function createVerifiedTestDatabaseRuntime() {
  const env = loadTestEnvironment();

  validateTestConfiguration(env);

  const runtime = createDatabaseRuntime(env);

  try {
    const result = await runtime.pool.query<{
      database_name: string;
      database_role: string;
      session_role: string;
      database_marker: string | null;
      is_superuser: boolean;
      can_bypass_rls: boolean;
      is_migrator_member: boolean;
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

        pg_has_role(
          current_user,
          'lara_migrator',
          'MEMBER'
        ) AS is_migrator_member

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
      identity.database_role !== "lara_app" ||
      identity.session_role !== "lara_app" ||
      identity.database_marker !== expectedDatabaseMarker ||
      identity.is_superuser !== false ||
      identity.can_bypass_rls !== false ||
      identity.is_migrator_member !== false
    ) {
      throw new Error(
        "Integration test database identity verification failed.",
      );
    }

    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
