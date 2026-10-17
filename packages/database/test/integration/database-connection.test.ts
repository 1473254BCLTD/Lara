import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import type { DatabaseRuntime } from "../../src/lifecycle.js";

import {
  createVerifiedTestDatabaseRuntime,
} from "../support/test-database.js";

/**
 * Lara — PostgreSQL Integration Test Smoke Tests
 *
 * These tests verify that the integration testing
 * infrastructure uses the correct database and role.
 *
 * All database operations in this file are read-only.
 */
describe("PostgreSQL integration test connection", () => {
  let runtime: DatabaseRuntime | undefined;

  /**
   * Establish one verified database runtime
   * for all tests in this file.
   */
  beforeAll(async () => {
    runtime = await createVerifiedTestDatabaseRuntime();
  });

  /**
   * Always close the PostgreSQL connection pool
   * when testing finishes.
   */
  afterAll(async () => {
    await runtime?.close();
  });

  /**
   * Test 1:
   *
   * Verify actual PostgreSQL database identity.
   */
  it("connects to the isolated database as lara_app", async () => {
    if (!runtime) {
      throw new Error("Test database runtime unavailable.");
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
      database_role: "lara_app",
      session_role: "lara_app",
      database_marker: "lara:integration-test-only:v1",
    });
  });

  /**
   * Test 2:
   *
   * Verify that application table privileges
   * match Lara's initial security architecture.
   */
  it("enforces restricted application table privileges", async () => {
    if (!runtime) {
      throw new Error("Test database runtime unavailable.");
    }

    const result = await runtime.pool.query<{
      can_select_customers: boolean;
      can_select_memberships: boolean;
      can_select_tenants: boolean;
      can_select_users: boolean;
      can_select_customer_auth: boolean;
      can_insert_customers: boolean;
      can_update_customers: boolean;
      can_delete_customers: boolean;
      can_truncate_customers: boolean;
      can_insert_memberships: boolean;
      can_update_memberships: boolean;
      can_delete_memberships: boolean;
      can_truncate_memberships: boolean;
      can_write_tenants: boolean;
      can_write_users: boolean;
      can_write_customer_auth: boolean;
    }>(`
      SELECT
        has_table_privilege(
          current_user,
          'public.customers',
          'SELECT'
        ) AS can_select_customers,

        has_table_privilege(
          current_user,
          'public.tenant_memberships',
          'SELECT'
        ) AS can_select_memberships,

        has_table_privilege(
          current_user,
          'public.tenants',
          'SELECT'
        ) AS can_select_tenants,

        has_table_privilege(
          current_user,
          'public.users',
          'SELECT'
        ) AS can_select_users,

        has_table_privilege(
          current_user,
          'public.customer_auth_accounts',
          'SELECT'
        ) AS can_select_customer_auth,

        has_table_privilege(
          current_user,
          'public.customers',
          'INSERT'
        ) AS can_insert_customers,

        has_table_privilege(
          current_user,
          'public.customers',
          'UPDATE'
        ) AS can_update_customers,

        has_table_privilege(
          current_user,
          'public.customers',
          'DELETE'
        ) AS can_delete_customers,

        has_table_privilege(
          current_user,
          'public.customers',
          'TRUNCATE'
        ) AS can_truncate_customers,

        has_table_privilege(
          current_user,
          'public.tenant_memberships',
          'INSERT'
        ) AS can_insert_memberships,

        has_table_privilege(
          current_user,
          'public.tenant_memberships',
          'UPDATE'
        ) AS can_update_memberships,

        has_table_privilege(
          current_user,
          'public.tenant_memberships',
          'DELETE'
        ) AS can_delete_memberships,

        has_table_privilege(
          current_user,
          'public.tenant_memberships',
          'TRUNCATE'
        ) AS can_truncate_memberships,

        (
          has_table_privilege(
            current_user,
            'public.tenants',
            'INSERT'
          )
          OR has_table_privilege(
            current_user,
            'public.tenants',
            'UPDATE'
          )
          OR has_table_privilege(
            current_user,
            'public.tenants',
            'DELETE'
          )
          OR has_table_privilege(
            current_user,
            'public.tenants',
            'TRUNCATE'
          )
        ) AS can_write_tenants,

        (
          has_table_privilege(
            current_user,
            'public.users',
            'INSERT'
          )
          OR has_table_privilege(
            current_user,
            'public.users',
            'UPDATE'
          )
          OR has_table_privilege(
            current_user,
            'public.users',
            'DELETE'
          )
          OR has_table_privilege(
            current_user,
            'public.users',
            'TRUNCATE'
          )
        ) AS can_write_users,

        (
          has_table_privilege(
            current_user,
            'public.customer_auth_accounts',
            'INSERT'
          )
          OR has_table_privilege(
            current_user,
            'public.customer_auth_accounts',
            'UPDATE'
          )
          OR has_table_privilege(
            current_user,
            'public.customer_auth_accounts',
            'DELETE'
          )
          OR has_table_privilege(
            current_user,
            'public.customer_auth_accounts',
            'TRUNCATE'
          )
        ) AS can_write_customer_auth
    `);

    expect(result.rows).toHaveLength(1);

    expect(result.rows[0]).toEqual({
      can_select_customers: true,
      can_select_memberships: true,
      can_select_tenants: false,
      can_select_users: false,
      can_select_customer_auth: false,
      can_insert_customers: false,
      can_update_customers: false,
      can_delete_customers: false,
      can_truncate_customers: false,
      can_insert_memberships: false,
      can_update_memberships: false,
      can_delete_memberships: false,
      can_truncate_memberships: false,
      can_write_tenants: false,
      can_write_users: false,
      can_write_customer_auth: false,
    });
  });
});
