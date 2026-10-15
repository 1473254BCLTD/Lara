import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./db.js";

/**
 * Defines the authenticated actor accessing tenant data.
 *
 * Staff and customers use separate authentication systems.
 */
const tenantSecurityContextSchema = z.discriminatedUnion(
  "actorType",
  [
    z.object({
      tenantId: z.uuid(),
      actorType: z.literal("staff"),
      actorId: z.uuid(),
    }),

    z.object({
      tenantId: z.uuid(),
      actorType: z.literal("customer"),
      actorId: z.uuid(),
    }),
  ],
);

/**
 * Validated structure of a tenant security context.
 *
 * Note: Schema validation does not establish authorization.
 */
export type TenantSecurityContext = z.infer<
  typeof tenantSecurityContextSchema
>;

/**
 * Infer the transaction type from our existing
 * Drizzle database instance.
 */
export type TenantTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * Execute database operations within a transaction
 * containing tenant and actor context.
 *
 * IMPORTANT:
 * The caller must authorize the actor and tenant
 * before invoking this function.
 *
 * This function does not perform authorization itself.
 */
export async function withTenantContext<TResult>(
  db: Database,
  context: TenantSecurityContext,
  callback: (tx: TenantTransaction) => Promise<TResult>,
): Promise<TResult> {
  // Validate the shape and UUIDs before starting a transaction.
  const validatedContext =
    tenantSecurityContextSchema.parse(context);

  return db.transaction(async (tx) => {
    /**
     * Establish PostgreSQL transaction-local context.
     *
     * The final argument, true, ensures these settings
     * are scoped to the current transaction.
     */
    await tx.execute(sql`
      SELECT
        set_config(
          'app.tenant_id',
          ${validatedContext.tenantId},
          true
        ),
        set_config(
          'app.actor_type',
          ${validatedContext.actorType},
          true
        ),
        set_config(
          'app.actor_id',
          ${validatedContext.actorId},
          true
        )
    `);

    /**
     * Execute the caller's database operations
     * using the same transaction.
     *
     * Drizzle handles commit and rollback.
     */
    return callback(tx);
  });
}