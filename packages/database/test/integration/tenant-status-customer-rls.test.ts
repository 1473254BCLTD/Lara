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
  tenants,
} from "../../src/schema/index.js";

import {
  withTenantContext,
} from "../../src/tenant-context.js";

import {
  cleanupCustomerFixtures,
  cleanupTenantFixtures,
  createCustomerFixtures,
  createTenantFixtures,
} from "../support/fixtures.js";

import type {
  CustomerFixtureSet,
  TenantFixtureSet,
} from "../support/fixtures.js";

import {
  createVerifiedTestDatabaseRuntime,
} from "../support/test-database.js";

import {
  createVerifiedFixtureDatabaseRuntime,
} from "../support/test-fixture-database.js";

/**
 * Lara — Customer Tenant Lifecycle RLS Tests
 *
 * Fixture preparation and tenant status changes:
 *   lara_migrator
 *
 * Authorization assertions:
 *   lara_app
 *
 * Verify that suspending one tenant prevents access
 * to its customer profiles without affecting the
 * same customer's profile in another active tenant.
 */
describe("Customer tenant lifecycle RLS", () => {
  it(
    "blocks access to a suspended tenant's customer profile without affecting another active tenant",
    async () => {
      const fixtureRuntime =
        await createVerifiedFixtureDatabaseRuntime();

      let appRuntime: DatabaseRuntime | undefined;

      let tenantFixtures: TenantFixtureSet | undefined;

      let customerFixtures: CustomerFixtureSet | undefined;

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
         * Create one global customer authentication account
         * and two tenant-specific customer profiles.
         *
         * Both profiles share the same global account.
         */
        const customerFixtureSet =
          await createCustomerFixtures(
            fixtureRuntime,
            tenantFixtureSet,
          );

        customerFixtures = customerFixtureSet;

        /**
         * Step 4:
         * Define a query that reads customer profiles
         * using the customer's authenticated context.
         *
         * There is deliberately no WHERE clause.
         * PostgreSQL RLS must enforce tenant isolation.
         */
        const readCustomerProfiles = (
          tenantId: string,
        ) =>
          withTenantContext(
            applicationRuntime.db,
            {
              tenantId,
              actorType: "customer",
              actorId: customerFixtureSet.authAccount.id,
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
         * Step 5:
         * Verify that the customer can access the
         * appropriate profile in both active tenants.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantA.id,
          ),
        ).toEqual([
          {
            id: customerFixtureSet.customerA.id,
            tenantId: tenantFixtureSet.tenantA.id,
            authAccountId:
              customerFixtureSet.authAccount.id,
          },
        ]);

        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantB.id,
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
         * Step 6:
         * Suspend Tenant A using the fixture connection.
         *
         * lara_app cannot update the global tenants table.
         */
        const suspended = await fixtureRuntime.db
          .update(tenants)
          .set({
            status: "suspended",
          })
          .where(
            eq(
              tenants.id,
              tenantFixtureSet.tenantA.id,
            ),
          )
          .returning({
            id: tenants.id,
          });

        expect(suspended).toEqual([
          {
            id: tenantFixtureSet.tenantA.id,
          },
        ]);

        /**
         * Step 7:
         * Verify that the customer can no longer
         * read their profile in suspended Tenant A.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantA.id,
          ),
        ).toEqual([]);

        /**
         * Step 8:
         * Verify that the same global customer account
         * can still read its profile in active Tenant B.
         *
         * Suspending Tenant A must not globally disable
         * the customer's authentication account.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantB.id,
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
         * Step 9:
         * Reactivate Tenant A.
         */
        const reactivated = await fixtureRuntime.db
          .update(tenants)
          .set({
            status: "active",
          })
          .where(
            eq(
              tenants.id,
              tenantFixtureSet.tenantA.id,
            ),
          )
          .returning({
            id: tenants.id,
          });

        expect(reactivated).toEqual([
          {
            id: tenantFixtureSet.tenantA.id,
          },
        ]);

        /**
         * Step 10:
         * Verify that access to the Tenant A profile
         * is restored.
         */
        expect(
          await readCustomerProfiles(
            tenantFixtureSet.tenantA.id,
          ),
        ).toEqual([
          {
            id: customerFixtureSet.customerA.id,
            tenantId: tenantFixtureSet.tenantA.id,
            authAccountId:
              customerFixtureSet.authAccount.id,
          },
        ]);
      } finally {
        /**
         * Step 11:
         * Close the application connection before cleanup.
         */
        try {
          await appRuntime?.close();
        } finally {
          /**
           * Step 12:
           * Remove customer profiles and their
           * shared authentication account.
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
             * Step 13:
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
               * Step 14:
               * Always close the fixture connection.
               */
              await fixtureRuntime.close();
            }
          }
        }
      }
    },
  );
});
