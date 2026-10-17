import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  DatabaseRuntime,
} from "../../src/lifecycle.js";

import {
  customers,
  tenantMemberships,
} from "../../src/schema/index.js";

import {
  withTenantContext,
} from "../../src/tenant-context.js";

import {
  cleanupCustomerFixtures,
  cleanupStaffMembershipFixtures,
  cleanupTenantFixtures,
  createCustomerFixtures,
  createStaffMembershipFixtures,
  createTenantFixtures,
} from "../support/fixtures.js";

import type {
  CustomerFixtureSet,
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
 * Lara — Disabled Staff Membership RLS Tests
 *
 * Fixture preparation and cleanup:
 *   lara_migrator
 *
 * RLS assertions:
 *   lara_app
 *
 * A disabled tenant membership must prevent staff
 * from accessing that tenant's data, even when
 * the global staff account remains active.
 *
 * Another active staff member must retain access
 * to their own tenant.
 */
describe("Disabled staff membership RLS", () => {
  it(
    "blocks staff with a disabled membership while preserving access for active staff",
    async () => {
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

      let customerFixtures:
        | CustomerFixtureSet
        | undefined;

      try {
        /**
         * Step 1:
         * Establish the restricted application connection.
         *
         * All authorization assertions must execute
         * through lara_app, never lara_migrator.
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
         * Create two active global staff accounts.
         *
         * Staff A's membership is disabled.
         * Staff B's membership remains active.
         *
         * Staff A's global account stays active so
         * this test isolates membership authorization.
         */
        staffFixtures =
          await createStaffMembershipFixtures(
            fixtureRuntime,
            tenantFixtures,
            {
              staffAMembershipStatus: "disabled",
            },
          );

        /**
         * Step 4:
         * Create one shared customer authentication
         * account and its two tenant-specific profiles.
         */
        customerFixtures =
          await createCustomerFixtures(
            fixtureRuntime,
            tenantFixtures,
          );

        /**
         * Step 5:
         * Query memberships using Staff A's context.
         *
         * The query intentionally has no WHERE clause.
         * PostgreSQL RLS must hide the disabled membership.
         */
        const membershipsForStaffA =
          await withTenantContext(
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
                  status: tenantMemberships.status,
                })
                .from(tenantMemberships);
            },
          );

        expect(membershipsForStaffA).toEqual([]);

        /**
         * Step 6:
         * Attempt to read customer profiles using
         * Staff A's context.
         *
         * The disabled membership must prevent access
         * even though the staff account is active.
         */
        const customersForStaffA =
          await withTenantContext(
            appRuntime.db,
            {
              tenantId: tenantFixtures.tenantA.id,
              actorType: "staff",
              actorId: staffFixtures.staffA.id,
            },
            async (tx) => {
              return tx
                .select({
                  id: customers.id,
                  tenantId: customers.tenantId,
                })
                .from(customers);
            },
          );

        expect(customersForStaffA).toEqual([]);

        /**
         * Step 7:
         * Verify Staff B can still read their own
         * active tenant membership.
         */
        const membershipsForStaffB =
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
                  status: tenantMemberships.status,
                })
                .from(tenantMemberships);
            },
          );

        expect(membershipsForStaffB).toEqual([
          {
            id: staffFixtures.membershipB.id,
            tenantId: tenantFixtures.tenantB.id,
            userId: staffFixtures.staffB.id,
            status: "active",
          },
        ]);

        /**
         * Step 8:
         * Verify Staff B can still read customer
         * profiles belonging to their own tenant.
         */
        const customersForStaffB =
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
                  id: customers.id,
                  tenantId: customers.tenantId,
                })
                .from(customers);
            },
          );

        expect(customersForStaffB).toEqual([
          {
            id: customerFixtures.customerB.id,
            tenantId: tenantFixtures.tenantB.id,
          },
        ]);

      } finally {
        /**
         * Step 9:
         * Close the application connection before
         * removing any fixture records.
         */
        try {
          await appRuntime?.close();

        } finally {
          /**
           * Step 10:
           * Remove staff memberships and staff accounts.
           */
          try {
            if (tenantFixtures && staffFixtures) {
              await cleanupStaffMembershipFixtures(
                fixtureRuntime,
                tenantFixtures,
                staffFixtures,
              );
            }

          } finally {
            /**
             * Step 11:
             * Remove customer profiles and their
             * shared global authentication account.
             */
            try {
              if (tenantFixtures && customerFixtures) {
                await cleanupCustomerFixtures(
                  fixtureRuntime,
                  tenantFixtures,
                  customerFixtures,
                );
              }

            } finally {
              /**
               * Step 12:
               * Remove the parent tenants.
               */
              try {
                if (tenantFixtures) {
                  await cleanupTenantFixtures(
                    fixtureRuntime,
                    tenantFixtures,
                  );
                }

              } finally {
                /**
                 * Step 13:
                 * Always close the fixture connection.
                 */
                await fixtureRuntime.close();
              }
            }
          }
        }
      }
    },
  );
});
