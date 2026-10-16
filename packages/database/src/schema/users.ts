import { sql } from "drizzle-orm";

import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Global staff and platform administrator accounts.
 *
 * Users are not directly associated with tenants.
 * Tenant access is managed through tenant_memberships.
 *
 * Customer authentication is handled separately.
 */
export const users = pgTable(
  "users",
  {
    /**
     * Global staff identifier.
     */
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    /**
     * Globally unique staff login email.
     *
     * Stored in normalized lowercase format.
     */
    email: varchar("email", { length: 254 })
      .notNull(),

    /**
     * Staff member's first name.
     */
    firstName: varchar("first_name", {
      length: 100,
    }),

    /**
     * Staff member's last name.
     */
    lastName: varchar("last_name", {
      length: 100,
    }),

    /**
     * Password hash.
     *
     * Nullable to support accounts that have not
     * completed password setup.
     *
     * Never store plaintext passwords.
     */
    passwordHash: text("password_hash"),

    /**
     * Global account lifecycle.
     *
     * Tenant-specific access is managed separately.
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
      .$onUpdateFn(() => sql`now()`)
      .notNull(),
  },

  (table) => [
    /**
     * A staff email can belong to only one
     * global staff account.
     */
    uniqueIndex("users_email_unique_idx")
      .on(table.email),

    /**
     * Reject empty email addresses.
     */
    check(
      "users_email_not_blank",
      sql`length(btrim(${table.email})) > 0`,
    ),

    /**
     * Require normalized lowercase emails.
     */
    check(
      "users_email_normalized",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),

    /**
     * Prevent invalid global account statuses.
     */
    check(
      "users_status_check",
      sql`${table.status} IN (
        'invited',
        'active',
        'disabled'
      )`,
    ),

    check(
      "users_first_name_not_blank",
      sql`${table.firstName} IS NULL OR length(btrim(${table.firstName})) > 0`,
    ),

    check(
      "users_last_name_not_blank",
      sql`${table.lastName} IS NULL OR length(btrim(${table.lastName})) > 0`,
    ),    
  ],
);

/**
 * Existing staff account.
 */
export type User = typeof users.$inferSelect;

/**
 * New staff account.
 */
export type NewUser = typeof users.$inferInsert;