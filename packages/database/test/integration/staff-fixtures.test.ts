import { inArray } from "drizzle-orm";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  tenantMemberships,
  tenants,
  users,
} from "../../src/schema/index.js";

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
  createVerifiedFixtureDatabaseRuntime,
} from "../support/test-fixture-database.js";

/**
 * Lara — Staff Membership Fixture Lifecycle
 *
 * Verifies the creation and cleanup of:
 *
 * - Two active tenants.
 * - Two active global staff accounts.
 * - Two active tenant memberships.
 *
 * Database operations use the verified lara_migrator
 * fixture connection.
 *
 * This test does not evaluate RLS access.
 */
describe("PostgreSQL staff fixture lifecycle", () => {
  it("creates and cleans up staff and tenant memberships", async () => {
    const runtime =
      await createVerifiedFixtureDatabaseRuntime();

    let tenantFixtures: TenantFixtureSet | undefined;

    let staffFixtures:
      | StaffMembershipFixtureSet
      | undefined;

    try {
      /**
       * Step 1:
       * Create the two parent tenants.
       */
      tenantFixtures = await createTenantFixtures(runtime);

      /**
       * Step 2:
       * Create global staff accounts and memberships.
       *
       * Both accounts and both memberships are
       * created inside one PostgreSQL transaction.
       */
      staffFixtures = await createStaffMembershipFixtures(
        runtime,
        tenantFixtures,
      );

      /**
       * Step 3:
       * Verify the global staff accounts.
       */
      const staffRecords = await runtime.db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
        })
        .from(users)
        .where(
          inArray(users.id, [
            staffFixtures.staffA.id,
            staffFixtures.staffB.id,
          ]),
        );

      expect(staffRecords).toHaveLength(2);

      expect(staffRecords).toEqual(
        expect.arrayContaining([
          {
            id: staffFixtures.staffA.id,
            email: staffFixtures.staffA.email,
            status: "active",
          },
          {
            id: staffFixtures.staffB.id,
            email: staffFixtures.staffB.email,
            status: "active",
          },
        ]),
      );

      /**
       * Step 4:
       * Verify tenant memberships and relationships.
       */
      const membershipRecords = await runtime.db
        .select({
          id: tenantMemberships.id,
          tenantId: tenantMemberships.tenantId,
          userId: tenantMemberships.userId,
          role: tenantMemberships.role,
          status: tenantMemberships.status,
        })
        .from(tenantMemberships)
        .where(
          inArray(tenantMemberships.id, [
            staffFixtures.membershipA.id,
            staffFixtures.membershipB.id,
          ]),
        );

      expect(membershipRecords).toHaveLength(2);

      expect(membershipRecords).toEqual(
        expect.arrayContaining([
          {
            id: staffFixtures.membershipA.id,
            tenantId: tenantFixtures.tenantA.id,
            userId: staffFixtures.staffA.id,
            role: "owner",
            status: "active",
          },
          {
            id: staffFixtures.membershipB.id,
            tenantId: tenantFixtures.tenantB.id,
            userId: staffFixtures.staffB.id,
            role: "staff",
            status: "active",
          },
        ]),
      );

    } finally {
      /**
       * Step 5:
       * Remove memberships and staff accounts.
       *
       * This cleanup runs even if an assertion fails.
       */
      try {
        if (tenantFixtures && staffFixtures) {
          await cleanupStaffMembershipFixtures(
            runtime,
            tenantFixtures,
            staffFixtures,
          );

          /**
           * Verify that the staff records were removed.
           */
          const remainingStaff = await runtime.db
            .select({
              id: users.id,
            })
            .from(users)
            .where(
              inArray(users.id, [
                staffFixtures.staffA.id,
                staffFixtures.staffB.id,
              ]),
            );

          expect(remainingStaff).toHaveLength(0);

          /**
           * Verify that memberships were removed.
           */
          const remainingMemberships = await runtime.db
            .select({
              id: tenantMemberships.id,
            })
            .from(tenantMemberships)
            .where(
              inArray(tenantMemberships.id, [
                staffFixtures.membershipA.id,
                staffFixtures.membershipB.id,
              ]),
            );

          expect(remainingMemberships).toHaveLength(0);
        }

      } finally {
        /**
         * Step 6:
         * Remove parent tenants after staff cleanup.
         */
        try {
          if (tenantFixtures) {
            await cleanupTenantFixtures(
              runtime,
              tenantFixtures,
            );

            const remainingTenants = await runtime.db
              .select({
                id: tenants.id,
              })
              .from(tenants)
              .where(
                inArray(tenants.id, [
                  tenantFixtures.tenantA.id,
                  tenantFixtures.tenantB.id,
                ]),
              );

            expect(remainingTenants).toHaveLength(0);
          }

        } finally {
          /**
           * Step 7:
           * Always close the database connection.
           */
          await runtime.close();
        }
      }
    }
  });
});
