import { sql } from "drizzle-orm";

import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * Connects global staff accounts to tenants.
 *
 * A user may belong to multiple tenants.
 * Each membership has its own role and status.
 */
export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    /**
     * Unique membership identifier.
     */
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    /**
     * Organization this membership belongs to.
     */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
      }),

    /**
     * Global staff account.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
      }),

    /**
     * Role within this tenant.
     *
     * This does not grant platform-level permissions.
     */
    role: text("role", {
      enum: [
        "owner",
        "admin",
        "staff",
      ],
    })
      .notNull(),

    /**
     * Tenant-specific membership status.
     */
    status: text("status", {
      enum: [
        "invited",
        "active",
        "disabled",
      ],
    })
      .default("invited")
      .notNull(),

    /**
     * Membership creation timestamp.
     */
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),

    /**
     * Last modification timestamp.
     */
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },

  (table) => [
    /**
     * Prevent duplicate memberships.
     *
     * One user can have only one membership
     * record per tenant.
     */
    uniqueIndex(
      "tenant_memberships_tenant_user_unique_idx",
    ).on(
      table.tenantId,
      table.userId,
    ),

    /**
     * Optimize finding all tenants
     * associated with a user.
     */
    index(
      "tenant_memberships_user_id_idx",
    ).on(table.userId),

    /**
     * Enforce valid tenant roles.
     */
    check(
      "tenant_memberships_role_check",
      sql`${table.role} IN (
        'owner',
        'admin',
        'staff'
      )`,
    ),

    /**
     * Enforce valid membership statuses.
     */
    check(
      "tenant_memberships_status_check",
      sql`${table.status} IN (
        'invited',
        'active',
        'disabled'
      )`,
    ),
  ],
);

/**
 * Existing membership.
 */
export type TenantMembership =
  typeof tenantMemberships.$inferSelect;

/**
 * New membership.
 */
export type NewTenantMembership =
  typeof tenantMemberships.$inferInsert;