import { z } from "zod";

/**
 * PostgreSQL application environment configuration.
 *
 * This schema validates configuration only.
 * It does not create database connections.
 */
const databaseEnvSchema = z.object({
  DATABASE_HOST: z.string().trim().min(1),

  DATABASE_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535),

  DATABASE_NAME: z.string().trim().min(1),

  DATABASE_USER: z.string().trim().min(1),

  DATABASE_PASSWORD: z.string().min(1),

  DATABASE_POOL_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5),
});

/**
 * TypeScript type inferred from the validated schema.
 */
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/**
 * Validate database environment variables.
 *
 * Returns validated configuration or throws an error.
 */
export function parseDatabaseEnv(
  env: Record<string, string | undefined>,
): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(env);

  if (!result.success) {
    const invalidKeys = [
      ...new Set(
        result.error.issues.map((issue) =>
          issue.path.join("."),
        ),
      ),
    ];

    throw new Error(
      `Invalid database environment variables: ${invalidKeys.join(", ")}`,
    );
  }

  return result.data;
}