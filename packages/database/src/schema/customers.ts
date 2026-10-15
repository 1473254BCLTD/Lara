import { sql } from "drizzle-orm";

import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { tenants } from "./tenants.js";
import { customerAuthAccounts } from "./customer-auth-accounts.js";

/**
 * Tenant-specific customer profiles.
 *
 * Customer information belongs to an individual tenant.
 *
 * Authentication is handled through the separate,
 * global customer_auth_accounts table.
 *
 * Customers must never reference staff users.
 */
export const customers = pgTable(
  "customers",
  {
    /**
     * Unique customer profile identifier.
     */
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    /**
     * Tenant that owns this customer profile.
     */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
      }),

    /**
     * Optional global customer authentication account.
     *
     * NULL indicates the profile is not yet linked
     * to a verified customer login.
     */
    authAccountId: uuid("auth_account_id")
      .references(() => customerAuthAccounts.id, {
        onDelete: "set null",
      }),

    /**
     * Customer first name.
     */
    firstName: varchar("first_name", {
      length: 100,
    }).notNull(),

    /**
     * Customer last name.
     */
    lastName: varchar("last_name", {
      length: 100,
    }).notNull(),

    /**
     * Tenant-specific contact email.
     *
     * This is not used as proof of authentication.
     */
    email: varchar("email", {
      length: 254,
    }).notNull(),

    /**
     * Profile creation timestamp.
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
     * One linked profile per authentication account
     * within the same tenant.
     *
     * Multiple NULL authAccountId values are allowed.
     */
    uniqueIndex(
      "customers_tenant_auth_account_unique_idx",
    ).on(
      table.tenantId,
      table.authAccountId,
    ),

    /**
     * Optimize customer searches within a tenant.
     */
    index(
      "customers_tenant_email_idx",
    ).on(
      table.tenantId,
      table.email,
    ),

    /**
     * Optimize finding profiles associated
     * with a global authentication account.
     */
    index(
      "customers_auth_account_id_idx",
    ).on(table.authAccountId),

    /**
     * Reject empty first names.
     */
    check(
      "customers_first_name_not_blank",
      sql`length(btrim(${table.firstName})) > 0`,
    ),

    /**
     * Reject empty last names.
     */
    check(
      "customers_last_name_not_blank",
      sql`length(btrim(${table.lastName})) > 0`,
    ),

    /**
     * Reject empty email addresses.
     */
    check(
      "customers_email_not_blank",
      sql`length(btrim(${table.email})) > 0`,
    ),

    /**
     * Require normalized lowercase contact emails.
     */
    check(
      "customers_email_normalized",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
).enableRLS();

/**
 * Existing customer profile.
 */
export type Customer = typeof customers.$inferSelect;

/**
 * New customer profile.
 */
export type NewCustomer = typeof customers.$inferInsert;