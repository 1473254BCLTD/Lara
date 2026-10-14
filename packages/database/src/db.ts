import { drizzle } from "drizzle-orm/node-postgres";

import type { Pool } from "pg";

/**
 * Create a Drizzle ORM instance using an existing
 * PostgreSQL connection pool.
 *
 * This function does not create another pool.
 * The caller retains responsibility for closing it.
 */
export function createDatabase(pool: Pool) {
  return drizzle({ client: pool });
}

/**
 * Shared TypeScript type for our Drizzle database instance.
 */
export type Database = ReturnType<typeof createDatabase>;