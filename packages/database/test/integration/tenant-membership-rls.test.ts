import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  DatabaseRuntime,
} from "../../src/lifecycle.js";

import {
  tenantMemberships,
} from "../../src/schema/index.js";

import {
  withTenantContext,
} from "../../src/tenant-context.js";

import {
  cleanupStaffMembershipFixtures,
  cleanupTenantFixtures,
  createStaffMembershipFixtures,
  createTenantFixtures,
} from "../support/fixtures.js";

import type {
  StaffMembershipFixtureSet,
  TenantFixtureSet,
} from "../support/fixtures.js";

import {
  createVerifiedTestDatabaseRuntime,
} from "../support/test-database.js";

import {
  createVerifiedFixtureDatabaseRuntime,
} from "../support/test-fixture-database.js";

/**
 * Lara — Staff Membership Row-Level Security Tests
 *
 * Fixture preparation:
 *   lara_migrator
 *
 * RLS assertions:
 *   lara_app
 *
 * Never execute RLS assertions using the
 * fixture database connection.
 */
describe("Tenant membership RLS", () => {
  /**
   * Verify that an active staff member can
   * read their own active tenant membership.
   *
   * Another staff member's membership must
   * remain invisible.
   */
  it("allows each staff member to read only their own membership", async () => {
    /**
     * Establish the verified fixture connection.
     */
    const fixtureRuntime =
      await createVerifiedFixtureDatabaseRuntime();

    let appRuntime: DatabaseRuntime | undefined;

    let tenantFixtures: TenantFixtureSet | undefined;

    let staffFixtures:
      | StaffMembershipFixtureSet
      | undefined;

    try {
      /**
       * Step 1:
       * Establish the restricted application connection.
       *
       * This verifies that the PostgreSQL role is
       * lara_app and cannot bypass RLS.
       */
      appRuntime =
        await createVerifiedTestDatabaseRuntime();

      /**
       * Step 2:
       * Create two active tenant fixtures.
       */
      tenantFixtures =
        await createTenantFixtures(fixtureRuntime);

      /**
       * Step 3:
       * Create Staff A and Staff B with their
       * respective active memberships.
       */
      staffFixtures =
        await createStaffMembershipFixtures(
          fixtureRuntime,
          tenantFixtures,
        );

      /**
       * Step 4:
       * Execute the membership query as Staff A.
       *
       * IMPORTANT:
       * This query uses appRuntime.db, NOT
       * fixtureRuntime.db.
       *
       * The context helper establishes PostgreSQL
       * transaction-local tenant and actor settings.
       */
      const visibleMemberships = await withTenantContext(
        appRuntime.db,
        {
          tenantId: tenantFixtures.tenantA.id,
          actorType: "staff",
          actorId: staffFixtures.staffA.id,
        },
        async (tx) => {
          return tx
            .select({
              id: tenantMemberships.id,
              tenantId: tenantMemberships.tenantId,
              userId: tenantMemberships.userId,
              role: tenantMemberships.role,
              status: tenantMemberships.status,
            })
            .from(tenantMemberships);
        },
      );

      /**
       * Step 5:
       * Staff A must see exactly one membership.
       *
       * The query intentionally has no WHERE clause.
       *
       * PostgreSQL RLS must filter out
       * Membership B automatically.
       */
      expect(visibleMemberships).toEqual([
        {
          id: staffFixtures.membershipA.id,
          tenantId: tenantFixtures.tenantA.id,
          userId: staffFixtures.staffA.id,
          role: "owner",
          status: "active",
        },
      ]);

      /**
       * Step 6:
       * Execute the same unrestricted membership
       * query using Staff B's security context.
       *
       * Staff B belongs to Tenant B with the
       * staff role.
       */
      const visibleMembershipsForStaffB =
        await withTenantContext(
          appRuntime.db,
          {
            tenantId: tenantFixtures.tenantB.id,
            actorType: "staff",
            actorId: staffFixtures.staffB.id,
          },
          async (tx) => {
            return tx
              .select({
                id: tenantMemberships.id,
                tenantId: tenantMemberships.tenantId,
                userId: tenantMemberships.userId,
                role: tenantMemberships.role,
                status: tenantMemberships.status,
              })
              .from(tenantMemberships);
          },
        );

      /**
       * Step 7:
       * Staff B must see exactly Membership B.
       *
       * PostgreSQL RLS must hide Membership A,
       * even though the SELECT has no WHERE clause.
       */
      expect(visibleMembershipsForStaffB).toEqual([
        {
          id: staffFixtures.membershipB.id,
          tenantId: tenantFixtures.tenantB.id,
          userId: staffFixtures.staffB.id,
          role: "staff",
          status: "active",
        },
      ]);

      /**
       * Step 8:
       * Query memberships without establishing
       * an authenticated actor context.
       *
       * This query executes directly through the
       * restricted lara_app database runtime.
       *
       * It intentionally has no WHERE clause.
       */
      const membershipsWithoutContext =
        await appRuntime.db
          .select({
            id: tenantMemberships.id,
          })
          .from(tenantMemberships);

      /**
       * Step 9:
       * PostgreSQL RLS must deny visibility
       * when no valid staff actor is present.
       *
       * The fixture memberships still exist,
       * so an empty result demonstrates that
       * RLS is filtering the records.
       */
      expect(membershipsWithoutContext).toEqual([]);

    } finally {
      /**
       * Cleanup runs even when an assertion fails.
       *
       * Close the application connection before
       * removing the fixture records.
       */
      try {
        await appRuntime?.close();

      } finally {
        try {
          /**
           * Remove memberships and global staff.
           */
          if (tenantFixtures && staffFixtures) {
            await cleanupStaffMembershipFixtures(
              fixtureRuntime,
              tenantFixtures,
              staffFixtures,
            );
          }

        } finally {
          try {
            /**
             * Remove the parent tenants.
             */
            if (tenantFixtures) {
              await cleanupTenantFixtures(
                fixtureRuntime,
                tenantFixtures,
              );
            }

          } finally {
            /**
             * Always close the fixture connection.
             */
            await fixtureRuntime.close();
          }
        }
      }
    }
  });
});
