import { sql } from "drizzle-orm";

import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Global customer authentication accounts.
 *
 * These accounts are separate from staff users.
 *
 * A single authentication account may be associated
 * with customer profiles belonging to multiple tenants.
 *
 * Customer names and business information are stored
 * in the tenant-scoped customers table.
 */
export const customerAuthAccounts = pgTable(
  "customer_auth_accounts",
  {
    /**
     * Global customer authentication identifier.
     */
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    /**
     * Globally unique login email.
     *
     * Emails must be normalized before insertion.
     */
    email: varchar("email", {
      length: 254,
    }).notNull(),

    /**
     * Secure password hash.
     *
     * Never store plaintext passwords.
     */
    passwordHash: text("password_hash")
      .notNull(),

    /**
     * Global authentication account status.
     *
     * Customer registration does not require
     * email activation.
     */
    status: text("status", {
      enum: [
        "active",
        "disabled",
      ],
    })
      .default("active")
      .notNull(),

    /**
     * Identifies a temporary password generated
     * for a staff-created customer account.
     */
    isTemporaryPassword: boolean(
      "is_temporary_password",
    )
      .default(false)
      .notNull(),

    /**
     * Expiration timestamp for temporary passwords.
     *
     * NULL for permanent passwords.
     */
    temporaryPasswordExpiresAt: timestamp(
      "temporary_password_expires_at",
      {
        withTimezone: true,
        mode: "date",
      },
    ),

    /**
     * Account creation timestamp.
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
     * One global customer login per email.
     */
    uniqueIndex(
      "customer_auth_accounts_email_unique_idx",
    ).on(table.email),

    /**
     * Reject blank email addresses.
     */
    check(
      "customer_auth_accounts_email_not_blank",
      sql`length(btrim(${table.email})) > 0`,
    ),

    /**
     * Require normalized lowercase emails.
     */
    check(
      "customer_auth_accounts_email_normalized",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),

    /**
     * Reject empty password hashes.
     */
    check(
      "customer_auth_accounts_password_not_blank",
      sql`length(btrim(${table.passwordHash})) > 0`,
    ),

    /**
     * Enforce allowed authentication statuses.
     */
    check(
      "customer_auth_accounts_status_check",
      sql`${table.status} IN (
        'active',
        'disabled'
      )`,
    ),

    /**
     * Temporary passwords must have an expiration.
     * Permanent passwords must not.
     */
    check(
      "customer_auth_accounts_temporary_password_check",
      sql`${table.isTemporaryPassword} =
          (${table.temporaryPasswordExpiresAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Existing customer authentication account.
 */
export type CustomerAuthAccount =
  typeof customerAuthAccounts.$inferSelect;

/**
 * New customer authentication account.
 */
export type NewCustomerAuthAccount =
  typeof customerAuthAccounts.$inferInsert;