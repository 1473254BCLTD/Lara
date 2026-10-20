import type { Server } from "node:http";
import type { DatabaseRuntime } from "@lara/database";
import { once } from "node:events";

type ClosableDatabase = Pick<DatabaseRuntime, "close">;

/**
 * Close HTTP connections before releasing PostgreSQL.
 * Attempt database cleanup even if HTTP cleanup fails.
 */
export async function closeResources(
  httpServer: Server | undefined,
  database: ClosableDatabase | undefined,
): Promise<void> {
  const failures: unknown[] = [];

  if (httpServer?.listening) {
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (error) {
      failures.push(error);
    }
  }

  try {
    await database?.close();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Failed to release Lara API resources",
    );
  }
}

type ManagedDatabase = {
  close(): Promise<void>;
};

type HttpApplication = {
  listen(port: number, host: string): Server;
};

type HttpConfiguration = {
  host: string;
  port: number;
};

/**
 * Coordinate API startup and shutdown independently
 * of operating-system signals and process exit handling.
 */
export function createApiLifecycle<
  TDatabase extends ManagedDatabase,
>(
  config: HttpConfiguration,
  dependencies: {
    initializeDatabase(): Promise<TDatabase>;
    createApp(database: TDatabase): HttpApplication;
    onHttpError?: (error: Error) => void;
  },
) {
  let database: TDatabase | undefined;
  let httpServer: Server | undefined;

  let stopping = false;

  let startupPromise:
    | Promise<Server | undefined>
    | undefined;

  let shutdownPromise: Promise<void> | undefined;

  function start(): Promise<Server | undefined> {
    // Shutdown is terminal for this lifecycle instance.
    if (stopping) {
      return Promise.reject(
        new Error("Cannot start a stopping API lifecycle"),
      );
    }

    // Repeated startup calls share the same operation.
    if (startupPromise) {
      return startupPromise;
    }


    startupPromise = (async () => {
      database = await dependencies.initializeDatabase();

      if (stopping) return undefined;

      const app = dependencies.createApp(database);

      if (stopping) return undefined;

      httpServer = app.listen(config.port, config.host);

      if (dependencies.onHttpError) {
        const onHttpError = dependencies.onHttpError;

        let hasStartedListening = false;

        httpServer.once("listening", () => {
          hasStartedListening = true;
        });

        httpServer.on("error", (error: Error) => {
          if (hasStartedListening) {
            onHttpError(error);
          }
        });
      }

      // Initial startup failures must still reject start().
      await once(httpServer, "listening");

      return stopping ? undefined : httpServer;
    })();

    return startupPromise;
  }

  function stop(): Promise<void> {
    // All callers share the same shutdown operation.
    if (shutdownPromise) {
      return shutdownPromise;
    }

    stopping = true;

    shutdownPromise = (async () => {
      // Allow any ongoing initialization to settle.
      try {
        await startupPromise;
      } catch {
        // Startup errors remain the caller's responsibility.
        // Resource cleanup must still execute.
      }

      await closeResources(httpServer, database);
    })();

    return shutdownPromise;
  }

  return {
    start,
    stop,
  };
}
