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
  customerAuthAccounts,
  customers,
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
 * Lara — Customer Row-Level Security Tests
 *
 * Fixture preparation and cleanup:
 *   lara_migrator
 *
 * RLS assertions:
 *   lara_app
 *
 * The same global customer authentication account
 * is linked to separate profiles in Tenant A and B.
 *
 * These tests verify that PostgreSQL RLS restricts
 * profile visibility to the selected tenant.
 */
describe("Customer RLS", () => {
  it("restricts a shared customer account to its profile in the selected tenant", async () => {
    /**
     * Establish the verified fixture connection.
     *
     * This connection is used exclusively for
     * preparing and cleaning up test data.
     */
    const fixtureRuntime =
      await createVerifiedFixtureDatabaseRuntime();

    let appRuntime: DatabaseRuntime | undefined;

    let tenantFixtures: TenantFixtureSet | undefined;

    let customerFixtures: CustomerFixtureSet | undefined;

    try {
      /**
       * Step 1:
       * Establish the restricted application connection.
       *
       * All RLS assertions must use lara_app.
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
       * Create one global customer authentication account
       * with one profile in each tenant.
       */
      customerFixtures =
        await createCustomerFixtures(
          fixtureRuntime,
          tenantFixtures,
        );

      /**
       * Step 4:
       * Read customer profiles in Tenant A.
       *
       * There is intentionally no WHERE clause.
       *
       * PostgreSQL RLS must restrict the result.
       */
      const visibleInTenantA =
        await withTenantContext(
          appRuntime.db,
          {
            tenantId: tenantFixtures.tenantA.id,
            actorType: "customer",
            actorId: customerFixtures.authAccount.id,
          },
          async (tx) => {
            return tx
              .select({
                id: customers.id,
                tenantId: customers.tenantId,
                authAccountId: customers.authAccountId,
                email: customers.email,
                firstName: customers.firstName,
                lastName: customers.lastName,
              })
              .from(customers);
          },
        );

      /**
       * Step 5:
       * The customer must see exactly their
       * Tenant A profile.
       *
       * The Tenant B profile must remain invisible.
       */
      expect(visibleInTenantA).toEqual([
        customerFixtures.customerA,
      ]);

      /**
       * Step 6:
       * Read customer profiles in Tenant B.
       *
       * The global authentication account stays
       * the same, but the tenant context changes.
       */
      const visibleInTenantB =
        await withTenantContext(
          appRuntime.db,
          {
            tenantId: tenantFixtures.tenantB.id,
            actorType: "customer",
            actorId: customerFixtures.authAccount.id,
          },
          async (tx) => {
            return tx
              .select({
                id: customers.id,
                tenantId: customers.tenantId,
                authAccountId: customers.authAccountId,
                email: customers.email,
                firstName: customers.firstName,
                lastName: customers.lastName,
              })
              .from(customers);
          },
        );

      /**
       * Step 7:
       * The customer must see exactly their
       * Tenant B profile.
       *
       * The Tenant A profile must remain invisible.
       */
      expect(visibleInTenantB).toEqual([
        customerFixtures.customerB,
      ]);

      /**
       * Step 8:
       * Query customer profiles without establishing
       * any authenticated actor context.
       *
       * This query also has no WHERE clause.
       */
      const visibleWithoutContext =
        await appRuntime.db
          .select({
            id: customers.id,
          })
          .from(customers);

      /**
       * Step 9:
       * Without a valid customer context,
       * PostgreSQL RLS must hide all profiles.
       */
      expect(visibleWithoutContext).toEqual([]);

    } finally {
      /**
       * Step 10:
       * Close the application connection before
       * removing the fixtures.
       */
      try {
        await appRuntime?.close();

      } finally {
        /**
         * Step 11:
         * Remove customer profiles and their shared
         * authentication account.
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
  });

  it(
    "denies customer profile access when the global authentication account is disabled",
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
        appRuntime =
          await createVerifiedTestDatabaseRuntime();

        /**
         * Step 2:
         * Create the two active tenants.
         */
        tenantFixtures =
          await createTenantFixtures(fixtureRuntime);

        /**
         * Step 3:
         * Create one global customer authentication
         * account and its two tenant-specific profiles.
         */
        customerFixtures =
          await createCustomerFixtures(
            fixtureRuntime,
            tenantFixtures,
          );

        /**
         * Step 4:
         * Disable the global authentication account.
         *
         * This administrative fixture operation uses
         * lara_migrator, never the RLS assertion connection.
         */
        const disabledAccounts = await fixtureRuntime.db
          .update(customerAuthAccounts)
          .set({
            status: "disabled",
          })
          .where(
            eq(
              customerAuthAccounts.id,
              customerFixtures.authAccount.id,
            ),
          )
          .returning({
            id: customerAuthAccounts.id,
            status: customerAuthAccounts.status,
          });

        expect(disabledAccounts).toEqual([
          {
            id: customerFixtures.authAccount.id,
            status: "disabled",
          },
        ]);

        /**
         * Step 5:
         * Query Tenant A using the disabled customer's
         * otherwise-valid security context.
         *
         * There is intentionally no WHERE clause.
         */
        const visibleInTenantA =
          await withTenantContext(
            appRuntime.db,
            {
              tenantId: tenantFixtures.tenantA.id,
              actorType: "customer",
              actorId: customerFixtures.authAccount.id,
            },
            async (tx) => {
              return tx
                .select({
                  id: customers.id,
                })
                .from(customers);
            },
          );

        expect(visibleInTenantA).toEqual([]);

        /**
         * Step 6:
         * Repeat the same authorization assertion
         * in Tenant B.
         */
        const visibleInTenantB =
          await withTenantContext(
            appRuntime.db,
            {
              tenantId: tenantFixtures.tenantB.id,
              actorType: "customer",
              actorId: customerFixtures.authAccount.id,
            },
            async (tx) => {
              return tx
                .select({
                  id: customers.id,
                })
                .from(customers);
            },
          );

        expect(visibleInTenantB).toEqual([]);

      } finally {
        /**
         * Step 7:
         * Close the application connection before cleanup.
         */
        try {
          await appRuntime?.close();

        } finally {
          /**
           * Step 8:
           * Remove customer profiles and the global account.
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
             * Step 9:
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
               * Step 10:
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
