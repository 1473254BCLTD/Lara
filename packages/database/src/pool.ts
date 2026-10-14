import pg from "pg";

import type { DatabaseEnv } from "./env.js";

const { Pool } = pg;

/**
 * Create a PostgreSQL connection pool.
 *
 * Each application process should create one pool
 * and reuse it throughout its lifetime.
 */
export function createDatabasePool(config: DatabaseEnv) {
  const pool = new Pool({
    host: config.DATABASE_HOST,
    port: config.DATABASE_PORT,
    database: config.DATABASE_NAME,
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,

    // Maximum simultaneous PostgreSQL connections.
    max: config.DATABASE_POOL_MAX,

    // Close connections after 30 seconds of inactivity.
    idleTimeoutMillis: 30_000,

    // Fail rather than wait indefinitely for a connection.
    connectionTimeoutMillis: 5_000,
  });

  // Handle unexpected errors on idle connections.
  pool.on("error", (error) => {
    console.error(
      "Unexpected PostgreSQL idle connection error:",
      error.message,
    );
  });

  return pool;
}