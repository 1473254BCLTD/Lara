import { defineConfig } from "drizzle-kit";
import { z } from "zod";

/**
 * Validate PostgreSQL migration credentials.
 *
 * These credentials belong exclusively to Drizzle Kit.
 * They must never be used by the Express API or worker.
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

/**
 * Detect whether migration credentials were provided.
 *
 * Generating migrations does not require credentials.
 * Applying migrations does.
 */
const migrationEnvKeys = [
  "MIGRATION_DATABASE_HOST",
  "MIGRATION_DATABASE_PORT",
  "MIGRATION_DATABASE_NAME",
  "MIGRATION_DATABASE_USER",
  "MIGRATION_DATABASE_PASSWORD",
];

const hasMigrationEnv = migrationEnvKeys.some(
  (key) => process.env[key] !== undefined,
);

const migrationEnv = hasMigrationEnv
  ? migrationEnvSchema.parse(process.env)
  : undefined;

/**
 * Drizzle Kit configuration.
 */
export default defineConfig({
  dialect: "postgresql",

  schema: "./src/schema/index.ts",

  out: "./drizzle",

  migrations: {
    schema: "public",
    table: "__drizzle_migrations",
  },

  ...(migrationEnv
    ? {
        dbCredentials: {
          host: migrationEnv.MIGRATION_DATABASE_HOST,
          port: migrationEnv.MIGRATION_DATABASE_PORT,
          database: migrationEnv.MIGRATION_DATABASE_NAME,
          user: migrationEnv.MIGRATION_DATABASE_USER,
          password: migrationEnv.MIGRATION_DATABASE_PASSWORD,
        },
      }
    : {}),
});