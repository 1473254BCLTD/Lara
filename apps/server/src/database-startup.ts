import { createDatabaseRuntime } from "@lara/database";
import type { DatabaseRuntime } from "@lara/database";

export async function initializeDatabase(
  env: Record<string, string | undefined>,
): Promise<DatabaseRuntime> {
  if (env.DATABASE_USER !== "lara_app") {
    throw new Error("Lara API requires DATABASE_USER=lara_app");
  }

  const runtime = createDatabaseRuntime(env);

  try {
    const result = await runtime.pool.query(
      "SELECT current_user AS role_name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );

    const role = result.rows[0];

    if (
      role?.role_name !== "lara_app" ||
      role.rolsuper !== false ||
      role.rolbypassrls !== false
    ) {
      throw new Error("Unexpected PostgreSQL runtime privileges");
    }

    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
