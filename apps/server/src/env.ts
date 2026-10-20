import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  SERVER_HOST: z
    .string()
    .trim()
    .min(1)
    .default("127.0.0.1"),

  SERVER_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3000),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  env: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(env);

  if (!result.success) {
    const invalidKeys = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join(".")),
      ),
    ];

    throw new Error(
      `Invalid server environment variables: ${invalidKeys.join(", ")}`,
    );
  }

  if (result.data.NODE_ENV === "production") {
    const required = ["SERVER_HOST", "SERVER_PORT"];

    const missing = required.filter(
      (key) => !env[key]?.trim(),
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing production server environment variables: ${missing.join(", ")}`,
      );
    }
  }

  return result.data;
}