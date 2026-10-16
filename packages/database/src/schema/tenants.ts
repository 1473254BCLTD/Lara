import { sql } from "drizzle-orm";

import {
  check,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Organizations registered with Lara.
 *
 * This table stores tenant identity and lifecycle information.
 * Tenant-specific configuration belongs in related tables.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    name: varchar("name", { length: 160 })
      .notNull(),

    status: text("status", {
      enum: [
        "pending",
        "active",
        "suspended",
        "archived",
      ],
    })
      .default("pending")
      .notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .$onUpdateFn(() => sql`now()`)
      .notNull(),
  },

  (table) => [
    check(
      "tenants_name_not_blank",
      sql`length(btrim(${table.name})) > 0`,
    ),

    check(
      "tenants_status_check",
      sql`${table.status} IN (
        'pending',
        'active',
        'suspended',
        'archived'
      )`,
    ),
  ],
);

export type Tenant = typeof tenants.$inferSelect;

export type NewTenant = typeof tenants.$inferInsert;