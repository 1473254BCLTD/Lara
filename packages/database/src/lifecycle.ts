import { createDatabase } from "./db.js";
import { parseDatabaseEnv } from "./env.js";
import { createDatabasePool } from "./pool.js";

/**
 * Creates a process-scoped database runtime.
 *
 * Each application process should create one runtime
 * and reuse it throughout its lifetime.
 */
export function createDatabaseRuntime(
  env: Record<string, string | undefined>,
) {
  // Validate environment configuration.
  const config = parseDatabaseEnv(env);

  // Create the PostgreSQL connection pool.
  const pool = createDatabasePool(config);

  // Attach Drizzle to the existing pool.
  const db = createDatabase(pool);

  // Store the shutdown promise to prevent duplicate shutdowns.
  let shutdownPromise: Promise<void> | undefined;

  return {
    db,
    pool,

    /**
     * Close the database pool.
     *
     * Repeated calls return the same promise.
     */
    close(): Promise<void> {
      shutdownPromise ??= pool.end();

      return shutdownPromise;
    },
  };
}

export type DatabaseRuntime =
  ReturnType<typeof createDatabaseRuntime>;