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
 * Lara — Cross-Tenant Authorization Tests
 *
 * Fixture preparation and cleanup:
 *   lara_migrator
 *
 * Authorization assertions:
 *   lara_app
 *
 * Verify that staff can read customer profiles
 * in their own tenant but cannot read profiles
 * belonging to another tenant.
 */
describe("Cross-tenant customer authorization", () => {
  it(
    "allows staff to read customer profiles only in their authorized tenant",
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
        const tenantFixtureSet =
          await createTenantFixtures(fixtureRuntime);

        tenantFixtures = tenantFixtureSet;

        /**
         * Step 3:
         * Create separate staff accounts and memberships.
         *
         * Staff A belongs to Tenant A.
         * Staff B belongs to Tenant B.
         */
        const staffFixtureSet =
          await createStaffMembershipFixtures(
            fixtureRuntime,
            tenantFixtureSet,
          );

        staffFixtures = staffFixtureSet;

        /**
         * Step 4:
         * Create a shared global customer account
         * with a separate profile in each tenant.
         */
        const customerFixtureSet =
          await createCustomerFixtures(
            fixtureRuntime,
            tenantFixtureSet,
          );

        customerFixtures = customerFixtureSet;

        /**
         * Step 5:
         * Define an unrestricted customer query.
         *
         * There is deliberately no WHERE clause.
         * PostgreSQL RLS must enforce authorization.
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
                  authAccountId: customers.authAccountId,
                })
                .from(customers);
            },
          );

        /**
         * Step 6:
         * Staff A must see the customer profile
         * belonging to Tenant A.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantA.id,
            staffFixtureSet.staffA.id,
          ),
        ).toEqual([
          {
            id: customerFixtureSet.customerA.id,
            tenantId: tenantFixtureSet.tenantA.id,
            authAccountId:
              customerFixtureSet.authAccount.id,
          },
        ]);

        /**
         * Step 7:
         * Staff B must see the customer profile
         * belonging to Tenant B.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantB.id,
            staffFixtureSet.staffB.id,
          ),
        ).toEqual([
          {
            id: customerFixtureSet.customerB.id,
            tenantId: tenantFixtureSet.tenantB.id,
            authAccountId:
              customerFixtureSet.authAccount.id,
          },
        ]);

        /**
         * Step 8:
         * Attempt cross-tenant access.
         *
         * Staff A supplies Tenant B's ID as the
         * context while retaining Staff A's identity.
         *
         * The application must not be able to read
         * Tenant B's customer profiles because
         * Staff A has no active membership there.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantB.id,
            staffFixtureSet.staffA.id,
          ),
        ).toEqual([]);


        /**
         * Step 9:
         * Attempt the reverse cross-tenant access.
         *
         * Staff B supplies Tenant A's ID while
         * retaining Staff B's identity.
         *
         * PostgreSQL RLS must hide Tenant A's
         * customer profiles from Staff B.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantA.id,
            staffFixtureSet.staffB.id,
          ),
        ).toEqual([]);

      } finally {
        /**
         * Step 9:
         * Close the application connection first.
         */
        try {
          await appRuntime?.close();
        } finally {
          /**
           * Step 10:
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
