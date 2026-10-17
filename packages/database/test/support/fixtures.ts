import { randomUUID } from "node:crypto";

import { and, eq, or, sql } from "drizzle-orm";

import type { DatabaseRuntime } from "../../src/lifecycle.js";

import {
  customerAuthAccounts,
  customers,
  tenantMemberships,
  tenants,
  users,
} from "../../src/schema/index.js";

/**
 * Lara — PostgreSQL Integration Test Fixtures
 *
 * All fixture operations must use a verified
 * lara_migrator database runtime.
 *
 * Never use fixture connections for RLS assertions.
 */

/**
 * An individual test tenant.
 */
export type TenantFixture = {
  id: string;
  name: string;
};

/**
 * Tenant fixtures belonging to one test run.
 */
export type TenantFixtureSet = {
  runId: string;

  tenantA: TenantFixture;
  tenantB: TenantFixture;
};


/**
 * A global staff account created for integration testing.
 *
 * Staff accounts belong to the global users table,
 * not to an individual tenant.
 */
export type StaffFixture = {
  id: string;
  email: string;
};

/**
 * A staff membership associated with a tenant.
 *
 * Memberships establish tenant-specific authorization.
 */
export type StaffMembershipFixture = {
  id: string;
  tenantId: string;
  userId: string;
};

/**
 * Staff accounts and memberships belonging
 * to one integration test run.
 *
 * Staff A belongs to Tenant A.
 * Staff B belongs to Tenant B.
 *
 * Both staff accounts and memberships are active by default.
 * Tests may create Staff A as disabled to verify account-level
 * authorization independently of membership status.
 */
export type StaffMembershipFixtureSet = {
  runId: string;

  staffA: StaffFixture;
  staffB: StaffFixture;

  membershipA: StaffMembershipFixture;
  membershipB: StaffMembershipFixture;

  /**
   * Optional additional membership for Staff A in Tenant B.
   * Used by multi-tenant authorization integration tests.
   */
  membershipAInTenantB?: StaffMembershipFixture;
};

/**
 * A global customer authentication account created
 * for PostgreSQL integration testing.
 *
 * The account represents one customer login identity
 * that may be linked to profiles in multiple tenants.
 */
export type CustomerAuthAccountFixture = {
  id: string;
  email: string;
};

/**
 * A customer profile belonging to one tenant.
 *
 * Customer profiles are tenant-specific even when
 * they share the same global authentication account.
 */
export type CustomerProfileFixture = {
  id: string;
  tenantId: string;
  authAccountId: string;
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * Customer fixtures belonging to one integration run.
 *
 * Both profiles share one global authentication account.
 * Each profile belongs to a different tenant.
 */
export type CustomerFixtureSet = {
  runId: string;

  authAccount: CustomerAuthAccountFixture;

  customerA: CustomerProfileFixture;
  customerB: CustomerProfileFixture;
};

/**
 * Infer the Drizzle transaction type.
 */
type FixtureTransaction = Parameters<
  Parameters<DatabaseRuntime["db"]["transaction"]>[0]
>[0];

/**
 * Verify the actual PostgreSQL identity before
 * executing fixture modifications.
 *
 * This verification runs inside the same transaction
 * used for fixture creation or cleanup.
 */
async function assertFixtureTransaction(
  tx: FixtureTransaction,
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT
      current_database() AS database_name,
      current_user AS database_role,
      session_user AS session_role,

      shobj_description(
        d.oid,
        'pg_database'
      ) AS database_marker

    FROM pg_catalog.pg_database AS d
    WHERE d.datname = current_database()
  `);

  const identity = result.rows[0];

  if (
    result.rows.length !== 1 ||
    !identity ||
    identity.database_name !== "lara_test" ||
    identity.database_role !== "lara_migrator" ||
    identity.session_role !== "lara_migrator" ||
    identity.database_marker !==
      "lara:integration-test-only:v1"
  ) {
    throw new Error(
      "Unsafe fixture transaction: " +
      "PostgreSQL test database identity verification failed.",
    );
  }
}

/**
 * Create two active tenants for integration testing.
 *
 * Both inserts occur inside one transaction.
 *
 * If either insert fails, PostgreSQL rolls back
 * the complete transaction.
 */
export async function createTenantFixtures(
  runtime: DatabaseRuntime,
): Promise<TenantFixtureSet> {
  const runId = randomUUID();

  const fixtures: TenantFixtureSet = {
    runId,

    tenantA: {
      id: randomUUID(),
      name: `Lara RLS Test ${runId} Tenant A`,
    },

    tenantB: {
      id: randomUUID(),
      name: `Lara RLS Test ${runId} Tenant B`,
    },
  };

  await runtime.db.transaction(async (tx) => {
    await assertFixtureTransaction(tx);

    const inserted = await tx
      .insert(tenants)
      .values([
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
      ])
      .returning({
        id: tenants.id,
      });

    if (
      inserted.length !== 2 ||
      !inserted.some(
        (row) => row.id === fixtures.tenantA.id,
      ) ||
      !inserted.some(
        (row) => row.id === fixtures.tenantB.id,
      )
    ) {
      throw new Error(
        "Failed to create the complete tenant fixture set.",
      );
    }
  });

  return fixtures;
}

/**
 * Remove the tenants created by a specific test run.
 *
 * Cleanup targets both UUID and fixture name.
 *
 * No TRUNCATE or unrestricted DELETE operations
 * are permitted.
 *
 * This initial cleanup helper supports tenant-only
 * fixtures. Related records will require deletion
 * before their parent tenants.
 */
export async function cleanupTenantFixtures(
  runtime: DatabaseRuntime,
  fixtures: TenantFixtureSet,
): Promise<void> {
  /**
   * Verify the fixture names before deletion.
   *
   * This prevents accidentally treating unrelated
   * tenant records as test fixtures.
   */
  if (
    fixtures.tenantA.name !==
      `Lara RLS Test ${fixtures.runId} Tenant A` ||
    fixtures.tenantB.name !==
      `Lara RLS Test ${fixtures.runId} Tenant B`
  ) {
    throw new Error(
      "Invalid tenant fixture ownership information.",
    );
  }

  await runtime.db.transaction(async (tx) => {
    await assertFixtureTransaction(tx);

    const deleted = await tx
      .delete(tenants)
      .where(
        or(
          and(
            eq(tenants.id, fixtures.tenantA.id),
            eq(tenants.name, fixtures.tenantA.name),
          ),
          and(
            eq(tenants.id, fixtures.tenantB.id),
            eq(tenants.name, fixtures.tenantB.name),
          ),
        ),
      )
      .returning({
        id: tenants.id,
      });

    const deletedIds = new Set(
      deleted.map((row) => row.id),
    );

    if (
      deleted.length !== 2 ||
      !deletedIds.has(fixtures.tenantA.id) ||
      !deletedIds.has(fixtures.tenantB.id)
    ) {
      throw new Error(
        "Tenant fixture cleanup was incomplete.",
      );
    }
  });
}


/**
 * Create active staff accounts and tenant memberships.
 *
 * Staff A belongs to Tenant A as owner.
 * Staff B belongs to Tenant B as staff.
 *
 * All four records are inserted in one transaction.
 *
 * The supplied tenants must be existing Lara test
 * fixtures belonging to the same test run.
 */
export async function createStaffMembershipFixtures(
  runtime: DatabaseRuntime,
  tenantFixtures: TenantFixtureSet,
  options: {
    staffAStatus?: "active" | "disabled";
    staffAMembershipStatus?: "active" | "disabled";
    includeStaffAMembershipInTenantB?: boolean;
  } = {},
): Promise<StaffMembershipFixtureSet> {
  const { runId, tenantA, tenantB } = tenantFixtures;

  /**
   * Validate the expected fixture ownership information
   * before opening a transaction.
   */
  if (
    tenantA.name !== "Lara RLS Test " + runId + " Tenant A" ||
    tenantB.name !== "Lara RLS Test " + runId + " Tenant B" ||
    tenantA.id === tenantB.id
  ) {
    throw new Error(
      "Invalid parent tenant fixture information.",
    );
  }

  /**
   * Generate globally unique staff accounts.
   *
   * Emails use the reserved .invalid domain and
   * cannot conflict with real customer email addresses.
   */
  const fixtures: StaffMembershipFixtureSet = {
    runId,

    staffA: {
      id: randomUUID(),
      email: "lara-rls-" + runId + "-staff-a@example.invalid",
    },

    staffB: {
      id: randomUUID(),
      email: "lara-rls-" + runId + "-staff-b@example.invalid",
    },

    membershipA: {
      id: randomUUID(),
      tenantId: tenantA.id,
      userId: "",
    },

    membershipB: {
      id: randomUUID(),
      tenantId: tenantB.id,
      userId: "",
    },

    ...(options.includeStaffAMembershipInTenantB
      ? {
          membershipAInTenantB: {
            id: randomUUID(),
            tenantId: tenantB.id,
            userId: "",
          },
        }
      : {}),
  };

  fixtures.membershipA.userId = fixtures.staffA.id;
  fixtures.membershipB.userId = fixtures.staffB.id;

  if (fixtures.membershipAInTenantB) {
    fixtures.membershipAInTenantB.userId =
      fixtures.staffA.id;
  }

  await runtime.db.transaction(async (tx) => {
    /**
     * Step 1:
     * Verify the actual test database identity.
     *
     * This executes on the same PostgreSQL connection
     * that will perform the inserts.
     */
    await assertFixtureTransaction(tx);

    /**
     * Step 2:
     * Verify both parent tenants exist and are active.
     */
    const parentTenants = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        status: tenants.status,
      })
      .from(tenants)
      .where(
        or(
          eq(tenants.id, tenantA.id),
          eq(tenants.id, tenantB.id),
        ),
      );

    if (
      parentTenants.length !== 2 ||
      !parentTenants.some(
        (row) =>
          row.id === tenantA.id &&
          row.name === tenantA.name &&
          row.status === "active",
      ) ||
      !parentTenants.some(
        (row) =>
          row.id === tenantB.id &&
          row.name === tenantB.name &&
          row.status === "active",
      )
    ) {
      throw new Error(
        "Parent tenant fixtures are missing or invalid.",
      );
    }

    /**
     * Step 3:
     * Create the global staff accounts.
     *
     * Password hashes are intentionally NULL.
     * These accounts are database authorization
     * fixtures, not interactive login accounts.
     */
    const insertedUsers = await tx
      .insert(users)
      .values([
        {
          id: fixtures.staffA.id,
          email: fixtures.staffA.email,
          firstName: "Fixture",
          lastName: "Staff A",
          passwordHash: null,
          status: options.staffAStatus ?? "active",
        },
        {
          id: fixtures.staffB.id,
          email: fixtures.staffB.email,
          firstName: "Fixture",
          lastName: "Staff B",
          passwordHash: null,
          status: "active",
        },
      ])
      .returning({
        id: users.id,
      });

    const insertedUserIds = new Set(
      insertedUsers.map((row) => row.id),
    );

    if (
      insertedUsers.length !== 2 ||
      !insertedUserIds.has(fixtures.staffA.id) ||
      !insertedUserIds.has(fixtures.staffB.id)
    ) {
      throw new Error(
        "Failed to create the complete staff fixture set.",
      );
    }

    /**
     * Step 4:
     * Create the tenant memberships.
     */
    const insertedMemberships = await tx
      .insert(tenantMemberships)
      .values([
        {
          id: fixtures.membershipA.id,
          tenantId: fixtures.membershipA.tenantId,
          userId: fixtures.membershipA.userId,
          role: "owner",
          status: options.staffAMembershipStatus ?? "active",
        },
        {
          id: fixtures.membershipB.id,
          tenantId: fixtures.membershipB.tenantId,
          userId: fixtures.membershipB.userId,
          role: "staff",
          status: "active",
        },
      ])
      .returning({
        id: tenantMemberships.id,
      });

    const insertedMembershipIds = new Set(
      insertedMemberships.map((row) => row.id),
    );

    if (
      insertedMemberships.length !== 2 ||
      !insertedMembershipIds.has(fixtures.membershipA.id) ||
      !insertedMembershipIds.has(fixtures.membershipB.id)
    ) {
      throw new Error(
        "Failed to create the complete membership fixture set.",
      );
    }

    /**
     * Step 5:
     * Optionally give Staff A an additional membership
     * in Tenant B with the admin role.
     */
    if (fixtures.membershipAInTenantB) {
      const insertedAdditionalMembership = await tx
        .insert(tenantMemberships)
        .values({
          id: fixtures.membershipAInTenantB.id,
          tenantId: fixtures.membershipAInTenantB.tenantId,
          userId: fixtures.membershipAInTenantB.userId,
          role: "admin",
          status: "active",
        })
        .returning({
          id: tenantMemberships.id,
        });

      if (
        insertedAdditionalMembership.length !== 1 ||
        insertedAdditionalMembership[0]?.id !==
          fixtures.membershipAInTenantB.id
      ) {
        throw new Error(
          "Failed to create Staff A's additional tenant membership.",
        );
      }
    }
  });

  return fixtures;
}

/**
 * Remove staff accounts and memberships belonging
 * to a specific integration test run.
 *
 * The parent tenant fixtures are preserved.
 *
 * Cleanup order:
 * 1. Delete tenant memberships.
 * 2. Delete global staff accounts.
 *
 * All deletions execute in one verified transaction.
 */
export async function cleanupStaffMembershipFixtures(
  runtime: DatabaseRuntime,
  tenantFixtures: TenantFixtureSet,
  staffFixtures: StaffMembershipFixtureSet,
): Promise<void> {
  const {
    runId,
    staffA,
    staffB,
    membershipA,
    membershipB,
    membershipAInTenantB,
  } = staffFixtures;

  /**
   * Verify that both fixture sets belong
   * to the same integration test run.
   */
  if (
    runId !== tenantFixtures.runId ||
    tenantFixtures.tenantA.name !==
      `Lara RLS Test ${runId} Tenant A` ||
    tenantFixtures.tenantB.name !==
      `Lara RLS Test ${runId} Tenant B`
  ) {
    throw new Error(
      "Staff and tenant fixtures belong to different test runs.",
    );
  }

  /**
   * Verify the expected staff identities.
   *
   * These addresses were generated exclusively
   * for the current fixture run.
   */
  if (
    staffA.email !==
      `lara-rls-${runId}-staff-a@example.invalid` ||
    staffB.email !==
      `lara-rls-${runId}-staff-b@example.invalid` ||
    staffA.id === staffB.id
  ) {
    throw new Error(
      "Invalid staff fixture ownership information.",
    );
  }

  /**
   * Verify membership relationships.
   *
   * Each membership must reference its expected
   * staff account and parent tenant.
   */
  if (
    tenantFixtures.tenantA.id === tenantFixtures.tenantB.id ||
    membershipA.id === membershipB.id ||
    membershipA.tenantId !== tenantFixtures.tenantA.id ||
    membershipB.tenantId !== tenantFixtures.tenantB.id ||
    membershipA.userId !== staffA.id ||
    membershipB.userId !== staffB.id ||
    (membershipAInTenantB !== undefined &&
      (
        membershipAInTenantB.id === membershipA.id ||
        membershipAInTenantB.id === membershipB.id ||
        membershipAInTenantB.tenantId !== tenantFixtures.tenantB.id ||
        membershipAInTenantB.userId !== staffA.id
      ))
  ) {
    throw new Error(
      "Invalid staff membership fixture relationships.",
    );
  }

  /**
   * Execute cleanup in one PostgreSQL transaction.
   *
   * If any verification or deletion fails,
   * PostgreSQL rolls back the entire operation.
   */
  await runtime.db.transaction(async (tx) => {
    /**
     * Step 1:
     * Verify the actual PostgreSQL database identity.
     *
     * This check executes on the same connection
     * that will perform the deletions.
     */
    await assertFixtureTransaction(tx);

    /**
     * Step 2:
     * Delete only the two expected memberships.
     *
     * Match membership ID, tenant ID, and user ID.
     */
    const membershipDeleteConditions = [
      and(
        eq(tenantMemberships.id, membershipA.id),
        eq(tenantMemberships.tenantId, membershipA.tenantId),
        eq(tenantMemberships.userId, membershipA.userId),
      ),
      and(
        eq(tenantMemberships.id, membershipB.id),
        eq(tenantMemberships.tenantId, membershipB.tenantId),
        eq(tenantMemberships.userId, membershipB.userId),
      ),
    ];

    if (membershipAInTenantB) {
      membershipDeleteConditions.push(
        and(
          eq(
            tenantMemberships.id,
            membershipAInTenantB.id,
          ),
          eq(
            tenantMemberships.tenantId,
            membershipAInTenantB.tenantId,
          ),
          eq(
            tenantMemberships.userId,
            membershipAInTenantB.userId,
          ),
        ),
      );
    }

    const deletedMemberships = await tx
      .delete(tenantMemberships)
      .where(or(...membershipDeleteConditions))
      .returning({
        id: tenantMemberships.id,
      });

    const deletedMembershipIds = new Set(
      deletedMemberships.map((row) => row.id),
    );

    const expectedMembershipIds = [
      membershipA.id,
      membershipB.id,
      ...(membershipAInTenantB
        ? [membershipAInTenantB.id]
        : []),
    ];

    if (
      deletedMemberships.length !== expectedMembershipIds.length ||
      expectedMembershipIds.some(
        (id) => !deletedMembershipIds.has(id),
      )
    ) {
      throw new Error(
        "Staff membership fixture cleanup was incomplete.",
      );
    }

    /**
     * Step 3:
     * Delete only the expected global staff accounts.
     *
     * Match both UUID and unique fixture email.
     */
    const deletedUsers = await tx
      .delete(users)
      .where(
        or(
          and(
            eq(users.id, staffA.id),
            eq(users.email, staffA.email),
          ),
          and(
            eq(users.id, staffB.id),
            eq(users.email, staffB.email),
          ),
        ),
      )
      .returning({
        id: users.id,
      });

    const deletedUserIds = new Set(
      deletedUsers.map((row) => row.id),
    );

    if (
      deletedUsers.length !== 2 ||
      !deletedUserIds.has(staffA.id) ||
      !deletedUserIds.has(staffB.id)
    ) {
      throw new Error(
        "Staff account fixture cleanup was incomplete.",
      );
    }
  });
}

/**
 * Create one global customer authentication account
 * and two tenant-specific customer profiles.
 *
 * Both profiles share one global authentication account.
 * All records are created in one verified transaction.
 */
export async function createCustomerFixtures(
  runtime: DatabaseRuntime,
  tenantFixtures: TenantFixtureSet,
): Promise<CustomerFixtureSet> {
  const { runId, tenantA, tenantB } = tenantFixtures;

  if (
    tenantA.name !== `Lara RLS Test ${runId} Tenant A` ||
    tenantB.name !== `Lara RLS Test ${runId} Tenant B` ||
    tenantA.id === tenantB.id
  ) {
    throw new Error(
      "Invalid parent tenant fixture information.",
    );
  }

  const email =
    `lara-rls-${runId}-customer@example.invalid`;

  const fixtures: CustomerFixtureSet = {
    runId,

    authAccount: {
      id: randomUUID(),
      email,
    },

    customerA: {
      id: randomUUID(),
      tenantId: tenantA.id,
      authAccountId: "",
      email,
      firstName: "Fixture",
      lastName: "Customer A",
    },

    customerB: {
      id: randomUUID(),
      tenantId: tenantB.id,
      authAccountId: "",
      email,
      firstName: "Fixture",
      lastName: "Customer B",
    },
  };

  fixtures.customerA.authAccountId =
    fixtures.authAccount.id;

  fixtures.customerB.authAccountId =
    fixtures.authAccount.id;

  await runtime.db.transaction(async (tx) => {
    await assertFixtureTransaction(tx);

    // Verify that both parent tenants exist and are active.
    const parentTenants = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        status: tenants.status,
      })
      .from(tenants)
      .where(
        or(
          eq(tenants.id, tenantA.id),
          eq(tenants.id, tenantB.id),
        ),
      );

    if (
      parentTenants.length !== 2 ||
      !parentTenants.some(
        (row) =>
          row.id === tenantA.id &&
          row.name === tenantA.name &&
          row.status === "active",
      ) ||
      !parentTenants.some(
        (row) =>
          row.id === tenantB.id &&
          row.name === tenantB.name &&
          row.status === "active",
      )
    ) {
      throw new Error(
        "Parent tenant fixtures are missing or invalid.",
      );
    }

    // This placeholder is not a usable password hash.
    // These fixtures test database authorization, not login.
    const insertedAccounts = await tx
      .insert(customerAuthAccounts)
      .values({
        id: fixtures.authAccount.id,
        email: fixtures.authAccount.email,
        passwordHash:
          `integration-test-only-not-a-real-hash-${runId}`,
        status: "active",
        isTemporaryPassword: false,
        temporaryPasswordExpiresAt: null,
      })
      .returning({
        id: customerAuthAccounts.id,
      });

    if (
      insertedAccounts.length !== 1 ||
      insertedAccounts[0]?.id !== fixtures.authAccount.id
    ) {
      throw new Error(
        "Failed to create the customer authentication fixture.",
      );
    }

    // Create one tenant-specific profile in each tenant.
    const insertedProfiles = await tx
      .insert(customers)
      .values([
        {
          id: fixtures.customerA.id,
          tenantId: fixtures.customerA.tenantId,
          authAccountId: fixtures.customerA.authAccountId,
          email: fixtures.customerA.email,
          firstName: fixtures.customerA.firstName,
          lastName: fixtures.customerA.lastName,
        },
        {
          id: fixtures.customerB.id,
          tenantId: fixtures.customerB.tenantId,
          authAccountId: fixtures.customerB.authAccountId,
          email: fixtures.customerB.email,
          firstName: fixtures.customerB.firstName,
          lastName: fixtures.customerB.lastName,
        },
      ])
      .returning({
        id: customers.id,
        tenantId: customers.tenantId,
      });

    const insertedProfileIds = new Set(
      insertedProfiles.map(
        (row) => `${row.id}:${row.tenantId}`,
      ),
    );

    if (
      insertedProfiles.length !== 2 ||
      !insertedProfileIds.has(
        `${fixtures.customerA.id}:${tenantA.id}`,
      ) ||
      !insertedProfileIds.has(
        `${fixtures.customerB.id}:${tenantB.id}`,
      )
    ) {
      throw new Error(
        "Failed to create the complete customer fixture set.",
      );
    }
  });

  return fixtures;
}

/**
 * Remove the two tenant-specific customer profiles
 * and their shared global authentication account.
 *
 * Every deletion occurs in one verified transaction.
 */
export async function cleanupCustomerFixtures(
  runtime: DatabaseRuntime,
  tenantFixtures: TenantFixtureSet,
  customerFixtures: CustomerFixtureSet,
): Promise<void> {
  const {
    runId,
    authAccount,
    customerA,
    customerB,
  } = customerFixtures;

  const expectedEmail =
    `lara-rls-${runId}-customer@example.invalid`;

  // Verify ownership and relationships before deletion.
  if (
    runId !== tenantFixtures.runId ||
    tenantFixtures.tenantA.name !==
      `Lara RLS Test ${runId} Tenant A` ||
    tenantFixtures.tenantB.name !==
      `Lara RLS Test ${runId} Tenant B` ||
    authAccount.email !== expectedEmail ||
    customerA.id === customerB.id ||
    customerA.tenantId !== tenantFixtures.tenantA.id ||
    customerB.tenantId !== tenantFixtures.tenantB.id ||
    customerA.authAccountId !== authAccount.id ||
    customerB.authAccountId !== authAccount.id ||
    customerA.email !== expectedEmail ||
    customerB.email !== expectedEmail ||
    customerA.firstName !== "Fixture" ||
    customerA.lastName !== "Customer A" ||
    customerB.firstName !== "Fixture" ||
    customerB.lastName !== "Customer B"
  ) {
    throw new Error(
      "Invalid customer fixture ownership information.",
    );
  }

  await runtime.db.transaction(async (tx) => {
    await assertFixtureTransaction(tx);

    // Delete only the two expected tenant profiles.
    const deletedProfiles = await tx
      .delete(customers)
      .where(
        or(
          and(
            eq(customers.id, customerA.id),
            eq(customers.tenantId, customerA.tenantId),
            eq(customers.authAccountId, customerA.authAccountId),
            eq(customers.email, customerA.email),
            eq(customers.firstName, customerA.firstName),
            eq(customers.lastName, customerA.lastName),
          ),
          and(
            eq(customers.id, customerB.id),
            eq(customers.tenantId, customerB.tenantId),
            eq(customers.authAccountId, customerB.authAccountId),
            eq(customers.email, customerB.email),
            eq(customers.firstName, customerB.firstName),
            eq(customers.lastName, customerB.lastName),
          ),
        ),
      )
      .returning({
        id: customers.id,
      });

    const deletedProfileIds = new Set(
      deletedProfiles.map((row) => row.id),
    );

    if (
      deletedProfiles.length !== 2 ||
      !deletedProfileIds.has(customerA.id) ||
      !deletedProfileIds.has(customerB.id)
    ) {
      throw new Error(
        "Customer profile fixture cleanup was incomplete.",
      );
    }

    // Refuse to delete the shared account if any
    // unexpected customer profiles still reference it.
    const remainingProfiles = await tx
      .select({
        id: customers.id,
      })
      .from(customers)
      .where(
        eq(customers.authAccountId, authAccount.id),
      );

    if (remainingProfiles.length !== 0) {
      throw new Error(
        "Unexpected customer profiles still reference the fixture account.",
      );
    }

    // Delete the global account after its profiles.
    const deletedAccounts = await tx
      .delete(customerAuthAccounts)
      .where(
        and(
          eq(customerAuthAccounts.id, authAccount.id),
          eq(customerAuthAccounts.email, authAccount.email),
        ),
      )
      .returning({
        id: customerAuthAccounts.id,
      });

    if (
      deletedAccounts.length !== 1 ||
      deletedAccounts[0]?.id !== authAccount.id
    ) {
      throw new Error(
        "Customer authentication fixture cleanup was incomplete.",
      );
    }
  });
}
