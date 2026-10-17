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

describe("PostgreSQL security configuration", () => {
  let runtime: DatabaseRuntime | undefined;

  beforeAll(async () => {
    runtime = await createVerifiedTestDatabaseRuntime();
  });

  afterAll(async () => {
    await runtime?.close();
  });

  function getRuntime(): DatabaseRuntime {
    if (!runtime) {
      throw new Error("Test database runtime unavailable.");
    }

    return runtime;
  }

  /**
   * Test 1:
   *
   * Verify that RLS is enabled on both protected tables.
   *
   * The migration role owns these tables for controlled
   * fixture management. FORCE ROW LEVEL SECURITY remains
   * disabled so the owner can manage those fixtures.
   *
   * The application role is a separate, restricted role
   * and must not own these tables or bypass RLS.
   */
  it("preserves the expected RLS configuration", async () => {
    const result = await getRuntime().pool.query<{
      table_name: string;
      table_owner: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>(`
      SELECT
        c.relname AS table_name,
        owner.rolname AS table_owner,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced

      FROM pg_catalog.pg_class AS c

      JOIN pg_catalog.pg_namespace AS n
        ON n.oid = c.relnamespace

      JOIN pg_catalog.pg_roles AS owner
        ON owner.oid = c.relowner

      WHERE
        n.nspname = 'public'
        AND c.relname IN (
          'customers',
          'tenant_memberships'
        )
        AND c.relkind = 'r'

      ORDER BY c.relname
    `);

    expect(result.rows).toEqual([
      {
        table_name: "customers",
        table_owner: "lara_migrator",
        rls_enabled: true,
        rls_forced: false,
      },
      {
        table_name: "tenant_memberships",
        table_owner: "lara_migrator",
        rls_enabled: true,
        rls_forced: false,
      },
    ]);
  });

  /**
   * Test 2:
   *
   * Verify the complete policy configuration for the
   * two RLS-protected tables.
   *
   * Checking all policies is intentional: PostgreSQL's
   * permissive policies can combine with OR semantics.
   * An unexpected additional policy could broaden access.
   *
   * Existing behavioral tests verify the actual
   * authorization conditions.
   */
  it("preserves the expected RLS policies", async () => {
    const result = await getRuntime().pool.query<{
      table_name: string;
      policy_name: string;
      permissive: string;
      roles: string[];
      command: string;
      has_using_expression: boolean;
      has_check_expression: boolean;
    }>(`
      SELECT
        tablename AS table_name,
        policyname AS policy_name,
        permissive,
        roles::text[] AS roles,
        cmd AS command,
        qual IS NOT NULL AS has_using_expression,
        with_check IS NOT NULL AS has_check_expression

      FROM pg_catalog.pg_policies

      WHERE
        schemaname = 'public'
        AND tablename IN (
          'customers',
          'tenant_memberships'
        )

      ORDER BY tablename, policyname
    `);

    expect(result.rows).toEqual([
      {
        table_name: "customers",
        policy_name: "customers_customer_self_select",
        permissive: "PERMISSIVE",
        roles: ["lara_app"],
        command: "SELECT",
        has_using_expression: true,
        has_check_expression: false,
      },
      {
        table_name: "customers",
        policy_name: "customers_staff_select",
        permissive: "PERMISSIVE",
        roles: ["lara_app"],
        command: "SELECT",
        has_using_expression: true,
        has_check_expression: false,
      },
      {
        table_name: "tenant_memberships",
        policy_name: "tenant_memberships_staff_self_select",
        permissive: "PERMISSIVE",
        roles: ["lara_app"],
        command: "SELECT",
        has_using_expression: true,
        has_check_expression: false,
      },
    ]);
  });

  /**
   * Test 3:
   *
   * Verify that the application role cannot acquire
   * unnecessary database or schema privileges.
   */
  it("restricts application role and schema privileges", async () => {
    const result = await getRuntime().pool.query<{
      is_superuser: boolean;
      can_bypass_rls: boolean;
      can_create_database: boolean;
      can_create_role: boolean;
      can_replicate: boolean;
      is_migrator_member: boolean;
      can_use_public_schema: boolean;
      can_create_in_public_schema: boolean;
      can_create_in_database: boolean;
    }>(`
      SELECT
        r.rolsuper AS is_superuser,
        r.rolbypassrls AS can_bypass_rls,
        r.rolcreatedb AS can_create_database,
        r.rolcreaterole AS can_create_role,
        r.rolreplication AS can_replicate,

        pg_catalog.pg_has_role(
          current_user,
          'lara_migrator',
          'MEMBER'
        ) AS is_migrator_member,

        has_schema_privilege(
          current_user,
          'public',
          'USAGE'
        ) AS can_use_public_schema,

        has_schema_privilege(
          current_user,
          'public',
          'CREATE'
        ) AS can_create_in_public_schema,

        has_database_privilege(
          current_user,
          current_database(),
          'CREATE'
        ) AS can_create_in_database

      FROM pg_catalog.pg_roles AS r

      WHERE r.rolname = current_user
    `);

    expect(result.rows).toHaveLength(1);

    expect(result.rows[0]).toEqual({
      is_superuser: false,
      can_bypass_rls: false,
      can_create_database: false,
      can_create_role: false,
      can_replicate: false,
      is_migrator_member: false,
      can_use_public_schema: true,
      can_create_in_public_schema: false,
      can_create_in_database: false,
    });
  });

  /**
   * Test 4:
   *
   * Verify that both security functions remain
   * SECURITY DEFINER functions with a restricted
   * search_path.
   *
   * The application role must be able to execute them,
   * but PUBLIC must not receive EXECUTE permission.
   */
  it("preserves security function execution controls", async () => {
    const result = await getRuntime().pool.query<{
      function_name: string;
      security_definer: boolean;
      volatility: string;
      language: string;
      settings: string[] | null;
      app_can_execute: boolean;
      public_can_execute: boolean;
    }>(`
      SELECT
        p.proname AS function_name,
        p.prosecdef AS security_definer,
        p.provolatile AS volatility,
        l.lanname AS language,
        p.proconfig AS settings,

        has_function_privilege(
          'lara_app',
          p.oid,
          'EXECUTE'
        ) AS app_can_execute,

        EXISTS (
          SELECT 1

          FROM pg_catalog.aclexplode(
            COALESCE(
              p.proacl,
              pg_catalog.acldefault('f', p.proowner)
            )
          ) AS acl

          WHERE
            acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute

      FROM pg_catalog.pg_proc AS p

      JOIN pg_catalog.pg_namespace AS n
        ON n.oid = p.pronamespace

      JOIN pg_catalog.pg_language AS l
        ON l.oid = p.prolang

      WHERE
        n.nspname = 'public'
        AND p.proname IN (
          'lara_actor_is_active',
          'lara_tenant_is_active'
        )

      ORDER BY p.proname
    `);

    expect(result.rows).toEqual([
      {
        function_name: "lara_actor_is_active",
        security_definer: true,
        volatility: "s",
        language: "sql",
        settings: ["search_path=pg_catalog, pg_temp"],
        app_can_execute: true,
        public_can_execute: false,
      },
      {
        function_name: "lara_tenant_is_active",
        security_definer: true,
        volatility: "s",
        language: "sql",
        settings: ["search_path=pg_catalog, pg_temp"],
        app_can_execute: true,
        public_can_execute: false,
      },
    ]);
  });
});
