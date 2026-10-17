import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import type { DatabaseRuntime } from "../../src/lifecycle.js";

import {
  createVerifiedFixtureDatabaseRuntime,
} from "../support/test-fixture-database.js";

/**
 * Lara — PostgreSQL Fixture Connection Tests
 *
 * Verify that fixture preparation uses the isolated
 * test database and the dedicated migration role.
 *
 * All operations in this file are read-only.
 */
describe("PostgreSQL fixture database connection", () => {
  let runtime: DatabaseRuntime | undefined;

  /**
   * Establish a verified fixture connection.
   */
  beforeAll(async () => {
    runtime = await createVerifiedFixtureDatabaseRuntime();
  });

  /**
   * Close the connection pool after testing.
   */
  afterAll(async () => {
    await runtime?.close();
  });

  /**
   * Test 1:
   *
   * Verify the actual database identity and role.
   */
  it("connects to lara_test as lara_migrator", async () => {
    if (!runtime) {
      throw new Error("Fixture database runtime unavailable.");
    }

    const result = await runtime.pool.query<{
      database_name: string;
      database_role: string;
      session_role: string;
      database_marker: string | null;
    }>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_role,
        session_user AS session_role,

        shobj_description(
          d.oid,
          'pg_database'
        ) AS database_marker

      FROM pg_catalog.pg_database AS d
      WHERE d.datname = current_database()
    `);

    expect(result.rows).toHaveLength(1);

    expect(result.rows[0]).toEqual({
      database_name: "lara_test",
      database_role: "lara_migrator",
      session_role: "lara_migrator",
      database_marker: "lara:integration-test-only:v1",
    });
  });

  /**
   * Test 2:
   *
   * Verify that the migration role can manage fixtures
   * without possessing unnecessary global privileges.
   */
  it("has fixture privileges without superuser access", async () => {
    if (!runtime) {
      throw new Error("Fixture database runtime unavailable.");
    }

    const result = await runtime.pool.query<{
      is_superuser: boolean;
      can_bypass_rls: boolean;
      can_create_database: boolean;
      can_insert_customers: boolean;
      can_delete_customers: boolean;
      owned_rls_tables: number;
    }>(`
      SELECT
        r.rolsuper AS is_superuser,
        r.rolbypassrls AS can_bypass_rls,
        r.rolcreatedb AS can_create_database,

        has_table_privilege(
          current_user,
          'public.customers',
          'INSERT'
        ) AS can_insert_customers,

        has_table_privilege(
          current_user,
          'public.customers',
          'DELETE'
        ) AS can_delete_customers,

        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_class AS c
          JOIN pg_catalog.pg_namespace AS n
            ON n.oid = c.relnamespace
          WHERE
            n.nspname = 'public'
            AND c.relname IN (
              'customers',
              'tenant_memberships'
            )
            AND c.relkind = 'r'
            AND c.relowner = r.oid
        ) AS owned_rls_tables

      FROM pg_catalog.pg_roles AS r
      WHERE r.rolname = current_user
    `);

    expect(result.rows).toHaveLength(1);

    expect(result.rows[0]).toEqual({
      is_superuser: false,
      can_bypass_rls: false,
      can_create_database: false,
      can_insert_customers: true,
      can_delete_customers: true,
      owned_rls_tables: 2,
    });
  });
});
