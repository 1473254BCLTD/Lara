import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { z } from "zod";

/**
 * Validate dedicated PostgreSQL migration credentials.
 *
 * Runtime application credentials must never be used
 * to execute database migrations.
 */
const migrationEnvSchema = z.object({
  MIGRATION_DATABASE_HOST: z.string().trim().min(1),

  MIGRATION_DATABASE_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535),

  MIGRATION_DATABASE_NAME: z.string().trim().min(1),

  MIGRATION_DATABASE_USER: z.literal("lara_migrator"),

  MIGRATION_DATABASE_PASSWORD: z.string().min(1),
});

const result = migrationEnvSchema.safeParse(process.env);

if (!result.success) {
  const invalidKeys = [
    ...new Set(
      result.error.issues.map((issue) =>
        issue.path.join("."),
      ),
    ),
  ];

  throw new Error(
    `Invalid migration configuration: ${invalidKeys.join(", ")}`,
  );
}

const config = result.data;


/**
 * Enable additional safeguards for integration test migrations.
 *
 * Normal development and production migrations retain
 * their existing behavior.
 */
const isIntegrationTestMigration =
  process.argv.length === 3 &&
  process.argv[2] === "--integration-test";

// Reject unsupported command-line arguments.
if (
  process.argv.length > 2 &&
  !isIntegrationTestMigration
) {
  throw new Error(
    "Unsupported migration command-line arguments.",
  );
}

// The dedicated test database must never be migrated
// without explicitly selecting integration-test mode.
if (
  config.MIGRATION_DATABASE_NAME === "lara_test" &&
  !isIntegrationTestMigration
) {
  throw new Error(
    "Test database migrations require --integration-test.",
  );
}

// Validate the configured integration test destination
// before opening any PostgreSQL connections.
if (isIntegrationTestMigration) {
  if (
    config.MIGRATION_DATABASE_HOST !== "127.0.0.1" ||
    config.MIGRATION_DATABASE_PORT !== 5433 ||
    config.MIGRATION_DATABASE_NAME !== "lara_test"
  ) {
    throw new Error(
      "Integration test migrations require " +
      "lara_test on 127.0.0.1:5433.",
    );
  }
}

/**
 * Locate migrations relative to this script.
 *
 * This avoids depending on the terminal's
 * current working directory.
 */
const migrationsFolder = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

/**
 * Create a dedicated migration connection pool.
 *
 * A single connection is sufficient because
 * migrations are executed sequentially.
 */
const pool = new pg.Pool({
  host: config.MIGRATION_DATABASE_HOST,
  port: config.MIGRATION_DATABASE_PORT,
  database: config.MIGRATION_DATABASE_NAME,
  user: config.MIGRATION_DATABASE_USER,
  password: config.MIGRATION_DATABASE_PASSWORD,

  max: 1,
  connectionTimeoutMillis: 5_000,
});

/**
 * Execute pending migrations.
 */
async function runMigrations() {
  try {
    /**
     * Verify the actual database connection.
     *
     * This prevents accidentally executing migrations
     * with an unexpected database role.
     */
    const connection = await pool.query(`
      SELECT
        current_database() AS database_name,
        current_user AS database_role
    `);

    const { database_name, database_role } =
      connection.rows[0];

    if (
      database_name !== config.MIGRATION_DATABASE_NAME ||
      database_role !== "lara_migrator"
    ) {
      throw new Error(
        "Unexpected migration database or role.",
      );
    }


    /**
     * Verify the identity of the isolated test database.
     *
     * PostgreSQL database comments are stored in
     * pg_catalog.pg_database metadata.
     *
     * Only the expected test database is permitted.
     */
    if (isIntegrationTestMigration) {
      const identity = await pool.query(`
        SELECT
          shobj_description(
            oid,
            'pg_database'
          ) AS database_marker
        FROM pg_catalog.pg_database
        WHERE datname = current_database()
      `);

      const marker = identity.rows[0]?.database_marker;

      if (
        identity.rows.length !== 1 ||
        marker !== "lara:integration-test-only:v1"
      ) {
        throw new Error(
          "Integration test database identity verification failed.",
        );
      }

      console.log(
        "Integration test database identity verified.",
      );
    }

    console.log(
      `Connected to ${database_name} as ${database_role}`,
    );

    /**
     * Create a Drizzle instance using our migration pool.
     */
    const db = drizzle({
      client: pool,
    });

    console.log("Checking for pending migrations...");

    /**
     * Apply migrations using the existing migration
     * directory and history table.
     */
    await migrate(db, {
      migrationsFolder,
      migrationsSchema: "public",
      migrationsTable: "__drizzle_migrations",
    });

    console.log(
      "Database migrations completed successfully.",
    );
  } finally {
    /**
     * Always close PostgreSQL connections.
     *
     * This runs whether migrations succeed or fail.
     */
    await pool.end();
  }
}

/**
 * Display useful errors and return a nonzero exit code.
 *
 * Include nested causes when available.
 */
runMigrations().catch((error) => {
  console.error("\nDatabase migration failed.");

  let currentError = error;

  while (currentError) {
    console.error("Message:", currentError.message);

    if (currentError.code) {
      console.error("PostgreSQL code:", currentError.code);
    }

    if (currentError.detail) {
      console.error("Detail:", currentError.detail);
    }

    if (currentError.hint) {
      console.error("Hint:", currentError.hint);
    }

    currentError = currentError.cause;
  }

  process.exitCode = 1;
});