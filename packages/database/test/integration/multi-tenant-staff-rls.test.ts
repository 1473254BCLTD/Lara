import { and, eq } from "drizzle-orm";

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
 * Lara — Multi-Tenant Staff RLS Tests
 *
 * Fixture preparation and cleanup:
 *   lara_migrator
 *
 * Authorization assertions:
 *   lara_app
 *
 * Verify that:
 *   1. Staff can discover their active memberships
 *      across multiple tenants.
 *   2. Staff can access customer profiles in each
 *      tenant where they have an active membership.
 *   3. Disabling one membership revokes access only
 *      to that tenant, not to other authorized tenants.
 */
describe("Multi-tenant staff RLS", () => {
  it(
    "allows multiple tenant memberships and revokes only the disabled membership",
    async () => {
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
         */
        const applicationRuntime =
          await createVerifiedTestDatabaseRuntime();

        appRuntime = applicationRuntime;

        /**
         * Step 2:
         * Create two active tenants.
         */
        tenantFixtures =
          await createTenantFixtures(fixtureRuntime);

        /**
         * Step 3:
         * Create Staff A and Staff B.
         *
         * Staff A:
         *   Tenant A: owner
         *   Tenant B: admin
         *
         * Staff B:
         *   Tenant B: staff
         */
        staffFixtures =
          await createStaffMembershipFixtures(
            fixtureRuntime,
            tenantFixtures,
            {
              includeStaffAMembershipInTenantB: true,
            },
          );

        const membershipAInTenantB =
          staffFixtures.membershipAInTenantB;

        if (!membershipAInTenantB) {
          throw new Error(
            "Expected Staff A to have a Tenant B membership.",
          );
        }

        /**
         * Step 4:
         * Create one global customer authentication account
         * with separate profiles in both tenants.
         */
        customerFixtures =
          await createCustomerFixtures(
            fixtureRuntime,
            tenantFixtures,
          );

        /**
         * Step 5:
         * Define an unrestricted membership query.
         *
         * There is deliberately no WHERE clause.
         * PostgreSQL RLS must filter the visible rows.
         */
        const readMemberships = (
          tenantId: string,
          actorId: string,
        ) =>
          withTenantContext(
            applicationRuntime.db,
            {
              tenantId,
              actorType: "staff",
              actorId,
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
         * Step 6:
         * Define an unrestricted customer profile query.
         *
         * Again, there is no WHERE clause.
         * PostgreSQL RLS must enforce tenant authorization.
         */
        const readCustomerProfiles = (
          tenantId: string,
          actorId: string,
        ) =>
          withTenantContext(
            applicationRuntime.db,
            {
              tenantId,
              actorType: "staff",
              actorId,
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

        /**
         * Step 7:
         * Verify that Staff A can discover both active
         * memberships using the restricted application role.
         *
         * The context uses Tenant A, but membership
         * visibility must include Staff A's membership
         * in Tenant B as well.
         */
        const membershipsForStaffA =
          await readMemberships(
            tenantFixtures.tenantA.id,
            staffFixtures.staffA.id,
          );

        expect(membershipsForStaffA).toHaveLength(2);

        expect(membershipsForStaffA).toEqual(
          expect.arrayContaining([
            {
              id: staffFixtures.membershipA.id,
              tenantId: tenantFixtures.tenantA.id,
              userId: staffFixtures.staffA.id,
              role: "owner",
              status: "active",
            },
            {
              id: membershipAInTenantB.id,
              tenantId: tenantFixtures.tenantB.id,
              userId: staffFixtures.staffA.id,
              role: "admin",
              status: "active",
            },
          ]),
        );

        /**
         * Step 8:
         * Verify Staff B cannot discover Staff A's
         * additional membership in Tenant B.
         */
        const membershipsForStaffB =
          await readMemberships(
            tenantFixtures.tenantB.id,
            staffFixtures.staffB.id,
          );

        expect(membershipsForStaffB).toEqual([
          {
            id: staffFixtures.membershipB.id,
            tenantId: tenantFixtures.tenantB.id,
            userId: staffFixtures.staffB.id,
            role: "staff",
            status: "active",
          },
        ]);

        /**
         * Step 9:
         * Staff A can access the customer profile
         * belonging to Tenant A.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtures.tenantA.id,
            staffFixtures.staffA.id,
          ),
        ).toEqual([
          {
            id: customerFixtures.customerA.id,
            tenantId: tenantFixtures.tenantA.id,
          },
        ]);

        /**
         * Step 10:
         * Staff A can also access Tenant B because
         * Staff A has an active admin membership there.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtures.tenantB.id,
            staffFixtures.staffA.id,
          ),
        ).toEqual([
          {
            id: customerFixtures.customerB.id,
            tenantId: tenantFixtures.tenantB.id,
          },
        ]);

        /**
         * Step 11:
         * Staff B must not access Tenant A, where
         * Staff B has no active membership.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtures.tenantA.id,
            staffFixtures.staffB.id,
          ),
        ).toEqual([]);

        /**
         * Step 12:
         * Disable only Staff A's membership in Tenant B.
         *
         * This administrative fixture update uses
         * lara_migrator, never the application role.
         *
         * Match the membership UUID, tenant UUID,
         * and staff UUID to target exactly one row.
         */
        const disabledMembership =
          await fixtureRuntime.db
            .update(tenantMemberships)
            .set({
              status: "disabled",
            })
            .where(
              and(
                eq(
                  tenantMemberships.id,
                  membershipAInTenantB.id,
                ),
                eq(
                  tenantMemberships.tenantId,
                  tenantFixtures.tenantB.id,
                ),
                eq(
                  tenantMemberships.userId,
                  staffFixtures.staffA.id,
                ),
              ),
            )
            .returning({
              id: tenantMemberships.id,
              status: tenantMemberships.status,
            });

        expect(disabledMembership).toEqual([
          {
            id: membershipAInTenantB.id,
            status: "disabled",
          },
        ]);

        /**
         * Step 13:
         * Staff A must now see only the remaining
         * active membership in Tenant A.
         */
        const membershipsAfterRevocation =
          await readMemberships(
            tenantFixtures.tenantA.id,
            staffFixtures.staffA.id,
          );

        expect(membershipsAfterRevocation).toEqual([
          {
            id: staffFixtures.membershipA.id,
            tenantId: tenantFixtures.tenantA.id,
            userId: staffFixtures.staffA.id,
            role: "owner",
            status: "active",
          },
        ]);

        /**
         * Step 14:
         * Revoking Tenant B access must not affect
         * Staff A's access to Tenant A.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtures.tenantA.id,
            staffFixtures.staffA.id,
          ),
        ).toEqual([
          {
            id: customerFixtures.customerA.id,
            tenantId: tenantFixtures.tenantA.id,
          },
        ]);

        /**
         * Step 15:
         * Staff A must no longer access Tenant B.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtures.tenantB.id,
            staffFixtures.staffA.id,
          ),
        ).toEqual([]);

        /**
         * Step 16:
         * Disabling Staff A's membership must not
         * affect Staff B's access to Tenant B.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtures.tenantB.id,
            staffFixtures.staffB.id,
          ),
        ).toEqual([
          {
            id: customerFixtures.customerB.id,
            tenantId: tenantFixtures.tenantB.id,
          },
        ]);

      } finally {
        /**
         * Step 17:
         * Close the application connection before cleanup.
         */
        try {
          await appRuntime?.close();

        } finally {
          /**
           * Step 18:
           * Remove staff memberships and accounts.
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
             * Step 19:
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
               * Step 20:
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
                 * Step 21:
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
