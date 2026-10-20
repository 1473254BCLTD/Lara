import { createApp } from "./app.js";
import { initializeDatabase } from "./database-startup.js";
import { parseServerEnv } from "./env.js";
import { createApiLifecycle } from "./lifecycle.js";
import { runWithShutdownDeadline } from "./shutdown-deadline.js";

// Validate HTTP configuration before starting resources.
const config = parseServerEnv(process.env);

const lifecycle = createApiLifecycle(
  {
    host: config.SERVER_HOST,
    port: config.SERVER_PORT,
  },
  {
    initializeDatabase: () => initializeDatabase(process.env),

    createApp: () => createApp(),

    onHttpError: (error) => {
      console.error("HTTP server error:", error);
      void shutdown("HTTP server error", 1);
    },
  },
);

let shutdownPromise: Promise<void> | undefined;

/**
 * Coordinate process shutdown.
 *
 * The lifecycle owns resource cleanup.
 * This entry point owns signals, logging, and exit status.
 */
function shutdown(
  reason: string,
  exitCode = 0,
): Promise<void> {
  // Preserve a failure status even if shutdown already started.
  if (exitCode !== 0) {
    process.exitCode = 1;
  }

  // Repeated requests share the same shutdown operation.
  if (shutdownPromise) {
    return shutdownPromise;
  }

  console.info(`Lara API shutting down: ${reason}`);

  // Bound startup completion and resource cleanup.
  shutdownPromise = runWithShutdownDeadline(
    () => lifecycle.stop(),
    10_000,
    () => {
      console.error("Lara API shutdown timed out");
      process.exit(1);
    },
  ).catch((error: unknown) => {
    console.error(
      "Failed to release Lara API resources:",
      error,
    );

    process.exitCode = 1;
  });

  return shutdownPromise;

}

// Register signals before beginning asynchronous startup.
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

/**
 * Start the API only after its dependencies are initialized.
 */
async function start(): Promise<void> {
  try {
    const server = await lifecycle.start();

    // Shutdown may have been requested during initialization.
    if (!server?.listening || shutdownPromise) {
      return;
    }

    console.info(
      `Lara API listening on http://${config.SERVER_HOST}:${config.SERVER_PORT}`,
    );
  } catch (error) {
    console.error("Failed to start Lara API:", error);

    void shutdown("startup failure", 1);
  }
}

void start();