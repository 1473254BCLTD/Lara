import { count, inArray } from "drizzle-orm";

import {
  describe,
  expect,
  it,
} from "vitest";

import { tenants } from "../../src/schema/index.js";

import {
  cleanupTenantFixtures,
  createTenantFixtures,
} from "../support/fixtures.js";

import type {
  TenantFixtureSet,
} from "../support/fixtures.js";

import {
  createVerifiedFixtureDatabaseRuntime,
} from "../support/test-fixture-database.js";

/**
 * Lara — PostgreSQL Fixture Lifecycle Tests
 *
 * Verify that integration test fixtures can be
 * created, inspected, and removed safely.
 *
 * These operations must execute exclusively
 * against the isolated lara_test database.
 */
describe("PostgreSQL tenant fixture lifecycle", () => {
  it("creates and cleans up isolated tenant fixtures", async () => {
    /**
     * Establish a verified migration-role connection.
     *
     * The helper checks the actual PostgreSQL
     * database identity before returning.
     */
    const runtime =
      await createVerifiedFixtureDatabaseRuntime();

    let fixtures: TenantFixtureSet | undefined;

    let baselineCount: number | undefined;

    try {
      /**
       * Step 1:
       * Record the existing number of tenants.
       */
      const before = await runtime.db
        .select({
          total: count(),
        })
        .from(tenants);

      baselineCount = before[0]?.total;

      if (typeof baselineCount !== "number") {
        throw new Error(
          "Unable to establish tenant count baseline.",
        );
      }

      /**
       * Step 2:
       * Create two active tenant fixtures.
       *
       * The helper validates database identity
       * inside the insertion transaction.
       */
      fixtures = await createTenantFixtures(runtime);

      /**
       * Step 3:
       * Query only the records created by this test.
       */
      const created = await runtime.db
        .select({
          id: tenants.id,
          name: tenants.name,
          status: tenants.status,
        })
        .from(tenants)
        .where(
          inArray(tenants.id, [
            fixtures.tenantA.id,
            fixtures.tenantB.id,
          ]),
        );

      /**
       * Step 4:
       * Verify both records exist.
       */
      expect(created).toHaveLength(2);

      expect(created).toEqual(
        expect.arrayContaining([
          {
            id: fixtures.tenantA.id,
            name: fixtures.tenantA.name,
            status: "active",
          },
          {
            id: fixtures.tenantB.id,
            name: fixtures.tenantB.name,
            status: "active",
          },
        ]),
      );

      /**
       * Step 5:
       * Verify exactly two tenants were added.
       */
      const during = await runtime.db
        .select({
          total: count(),
        })
        .from(tenants);

      expect(during[0]?.total).toBe(
        baselineCount + 2,
      );

    } finally {
      /**
       * Cleanup executes even when an assertion fails.
       */
      try {
        if (fixtures) {
          /**
           * Step 6:
           * Delete only this test run's tenants.
           *
           * Cleanup is transactional and validates
           * database identity before deletion.
           */
          await cleanupTenantFixtures(
            runtime,
            fixtures,
          );

          /**
           * Step 7:
           * Independently verify the fixture
           * records no longer exist.
           */
          const remaining = await runtime.db
            .select({
              id: tenants.id,
            })
            .from(tenants)
            .where(
              inArray(tenants.id, [
                fixtures.tenantA.id,
                fixtures.tenantB.id,
              ]),
            );

          expect(remaining).toHaveLength(0);

          /**
           * Step 8:
           * Confirm the original tenant count
           * has been restored.
           */
          const after = await runtime.db
            .select({
              total: count(),
            })
            .from(tenants);

          expect(after[0]?.total).toBe(
            baselineCount,
          );
        }
      } finally {
        /**
         * Step 9:
         * Always close the PostgreSQL pool,
         * even if fixture cleanup fails.
         */
        await runtime.close();
      }
    }
  });
});
