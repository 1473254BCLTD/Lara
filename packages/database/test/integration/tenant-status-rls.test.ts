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
  tenantMemberships,
  tenants,
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
 * Lara — Tenant Lifecycle Row-Level Security Tests
 *
 * Fixture preparation and tenant status changes:
 *   lara_migrator
 *
 * Authorization assertions:
 *   lara_app
 *
 * These tests verify that suspended tenants cannot
 * be accessed through the existing RLS policies.
 */
describe("Tenant lifecycle RLS", () => {
  it(
    "blocks staff membership access while the tenant is suspended and restores it after reactivation",
    async () => {
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
         */
        const applicationRuntime =
          await createVerifiedTestDatabaseRuntime();

        appRuntime = applicationRuntime;

        /**
         * Step 2:
         * Create two active tenants and their staff fixtures.
         */
        const tenantFixtureSet =
          await createTenantFixtures(fixtureRuntime);

        tenantFixtures = tenantFixtureSet;

        const staffFixtureSet =
          await createStaffMembershipFixtures(
            fixtureRuntime,
            tenantFixtureSet,
          );

        staffFixtures = staffFixtureSet;

        /**
         * Step 3:
         * Define a membership query using Staff A's
         * authenticated context.
         *
         * There is deliberately no WHERE clause.
         * PostgreSQL RLS must determine visibility.
         */
        const readMemberships = () =>
          withTenantContext(
            applicationRuntime.db,
            {
              tenantId: tenantFixtureSet.tenantA.id,
              actorType: "staff",
              actorId: staffFixtureSet.staffA.id,
            },
            async (tx) => {
              return tx
                .select({
                  id: tenantMemberships.id,
                })
                .from(tenantMemberships);
            },
          );

        /**
         * Step 4:
         * Confirm access while the tenant is active.
         */
        expect(await readMemberships()).toEqual([
          {
            id: staffFixtureSet.membershipA.id,
          },
        ]);

        /**
         * Step 5:
         * Suspend Tenant A.
         *
         * This administrative fixture modification
         * uses lara_migrator, never lara_app.
         */
        await fixtureRuntime.db
          .update(tenants)
          .set({
            status: "suspended",
          })
          .where(
            eq(
              tenants.id,
              tenantFixtureSet.tenantA.id,
            ),
          );

        /**
         * Step 6:
         * Confirm RLS hides the membership.
         *
         * Staff A remains active and the security
         * context is still valid. Tenant status is
         * the condition that now prevents visibility.
         */
        expect(await readMemberships()).toEqual([]);

        /**
         * Step 7:
         * Reactivate Tenant A.
         */
        await fixtureRuntime.db
          .update(tenants)
          .set({
            status: "active",
          })
          .where(
            eq(
              tenants.id,
              tenantFixtureSet.tenantA.id,
            ),
          );

        /**
         * Step 8:
         * Confirm access is restored.
         */
        expect(await readMemberships()).toEqual([
          {
            id: staffFixtureSet.membershipA.id,
          },
        ]);
      } finally {
        /**
         * Step 9:
         * Close the application connection before cleanup.
         */
        try {
          await appRuntime?.close();
        } finally {
          /**
           * Step 10:
           * Remove staff memberships and accounts first.
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
               * Step 12:
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
