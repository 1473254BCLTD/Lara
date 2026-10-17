import { eq } from "drizzle-orm";

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
  users,
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
 * Lara — Disabled Staff Account RLS Tests
 *
 * Fixture preparation and cleanup:
 *   lara_migrator
 *
 * RLS assertions:
 *   lara_app
 *
 * These tests verify that global staff account status
 * takes precedence over an otherwise active membership.
 */
describe("Disabled staff account RLS", () => {
  it(
    "blocks disabled staff while allowing active staff in their own tenant",
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
         *
         * This runtime is used exclusively for RLS assertions.
         */
        appRuntime =
          await createVerifiedTestDatabaseRuntime();

        /**
         * Step 2:
         * Create two active tenants.
         */
        tenantFixtures =
          await createTenantFixtures(fixtureRuntime);

        /**
         * Step 3:
         * Create two staff accounts and their memberships.
         *
         * Staff A is globally disabled.
         * Staff B remains globally active.
         *
         * Both tenant memberships remain active.
         */
        staffFixtures =
          await createStaffMembershipFixtures(
            fixtureRuntime,
            tenantFixtures,
            {
              staffAStatus: "disabled",
            },
          );

        /**
         * Step 4:
         * Create one global customer authentication account
         * and a separate customer profile in each tenant.
         */
        customerFixtures =
          await createCustomerFixtures(
            fixtureRuntime,
            tenantFixtures,
          );

        /**
         * Step 5:
         * Verify that Staff A is disabled but still has
         * an active membership.
         *
         * This confirms the test is exercising global
         * account authorization, not membership status.
         */
        const staffAAccounts = await fixtureRuntime.db
          .select({
            id: users.id,
            status: users.status,
          })
          .from(users)
          .where(
            eq(users.id, staffFixtures.staffA.id),
          );

        expect(staffAAccounts).toEqual([
          {
            id: staffFixtures.staffA.id,
            status: "disabled",
          },
        ]);

        const staffAMemberships = await fixtureRuntime.db
          .select({
            id: tenantMemberships.id,
            tenantId: tenantMemberships.tenantId,
            userId: tenantMemberships.userId,
            status: tenantMemberships.status,
          })
          .from(tenantMemberships)
          .where(
            eq(
              tenantMemberships.id,
              staffFixtures.membershipA.id,
            ),
          );

        expect(staffAMemberships).toEqual([
          {
            id: staffFixtures.membershipA.id,
            tenantId: tenantFixtures.tenantA.id,
            userId: staffFixtures.staffA.id,
            status: "active",
          },
        ]);

        /**
         * Step 6:
         * Attempt to read customer profiles as Staff A.
         *
         * The query deliberately has no WHERE clause.
         * PostgreSQL RLS must prevent access because the
         * global staff account is disabled.
         */
        const disabledStaffCustomers =
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

        expect(disabledStaffCustomers).toEqual([]);

        /**
         * Step 7:
         * Verify that Staff B can still read customer
         * profiles in Tenant B.
         *
         * This guards against an implementation that
         * blocks staff access indiscriminately.
         */
        const activeStaffCustomers =
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

        expect(activeStaffCustomers).toEqual([
          {
            id: customerFixtures.customerB.id,
            tenantId: tenantFixtures.tenantB.id,
          },
        ]);

      } finally {
        /**
         * Cleanup must run even when an assertion fails.
         *
         * Close the application pool first, then remove
         * dependent records before their parent tenants.
         */
        try {
          await appRuntime?.close();

        } finally {
          try {
            if (tenantFixtures && staffFixtures) {
              await cleanupStaffMembershipFixtures(
                fixtureRuntime,
                tenantFixtures,
                staffFixtures,
              );
            }

          } finally {
            try {
              if (tenantFixtures && customerFixtures) {
                await cleanupCustomerFixtures(
                  fixtureRuntime,
                  tenantFixtures,
                  customerFixtures,
                );
              }

            } finally {
              try {
                if (tenantFixtures) {
                  await cleanupTenantFixtures(
                    fixtureRuntime,
                    tenantFixtures,
                  );
                }

              } finally {
                await fixtureRuntime.close();
              }
            }
          }
        }
      }
    },
  );
});
