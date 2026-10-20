import { describe, expect, it, vi } from "vitest";

import { createApiLifecycle } from "../../src/lifecycle.js";

import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";

describe("createApiLifecycle failures", () => {
  it("handles database initialization failure safely", async () => {
    const databaseError = new Error("Database unavailable");

    const initializeDatabase = vi.fn(
      async (): Promise<{ close(): Promise<void> }> => {
        throw databaseError;
      },
    );

    const createApp = vi.fn(() => ({
      listen() {
        throw new Error("HTTP must not start");
      },
    }));

    const lifecycle = createApiLifecycle(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        initializeDatabase,
        createApp,
      },
    );

    // Database initialization fails.
    await expect(lifecycle.start()).rejects.toBe(
      databaseError,
    );

    // HTTP startup must never be attempted.
    expect(initializeDatabase).toHaveBeenCalledOnce();
    expect(createApp).not.toHaveBeenCalled();

    // Shutdown must remain safe after startup failure.
    const firstStop = lifecycle.stop();
    const secondStop = lifecycle.stop();

    expect(secondStop).toBe(firstStop);

    await expect(firstStop).resolves.toBeUndefined();

    // A failed lifecycle cannot be restarted.
    await expect(lifecycle.start()).rejects.toThrow(
      "Cannot start a stopping API lifecycle",
    );
  });

  it("releases the database after HTTP startup failure", async () => {
    // Occupy an available local TCP port.
    const blocker = createTcpServer();

    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");

    const address = blocker.address();

    if (!address || typeof address === "string") {
      throw new Error("Unexpected TCP listener address");
    }

    // Simulate an initialized database runtime.
    const database = {
      close: vi.fn(async () => {}),
    };

    const initializeDatabase = vi.fn(async () => database);

    const onHttpError = vi.fn();

    const createApp = vi.fn(() => ({
      listen(port: number, host: string) {
        return createHttpServer().listen(port, host);
      },
    }));

    const lifecycle = createApiLifecycle(
      {
        host: "127.0.0.1",
        port: address.port,
      },
      {
        initializeDatabase,
        createApp,
        onHttpError
      },
    );

    try {
      // The HTTP listener must reject the occupied port.
      await expect(lifecycle.start()).rejects.toMatchObject({
        code: "EADDRINUSE",
      });

      expect(onHttpError).not.toHaveBeenCalled();

      // Database initialization succeeded before HTTP failed.
      expect(initializeDatabase).toHaveBeenCalledOnce();
      expect(createApp).toHaveBeenCalledOnce();

      // Shutdown must release the initialized database.
      await lifecycle.stop();

      expect(database.close).toHaveBeenCalledOnce();

      // The failed lifecycle cannot be restarted.
      await expect(lifecycle.start()).rejects.toThrow(
        "Cannot start a stopping API lifecycle",
      );
    } finally {
      try {
        await lifecycle.stop();
      } finally {
        await new Promise<void>((resolve) => {
          blocker.close(() => resolve());
        });
      }
    }
  });

  it("reports unexpected HTTP errors after startup", async () => {
    const runtimeError = new Error("Unexpected HTTP server error");

    const onHttpError = vi.fn();

    const database = {
      close: vi.fn(async () => {}),
    };

    const lifecycle = createApiLifecycle(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        initializeDatabase: async () => database,

        createApp: () => ({
          listen(port: number, host: string) {
            return createHttpServer().listen(port, host);
          },
        }),

        onHttpError,
      },
    );

    try {
      const server = await lifecycle.start();

      // The HTTP listener must start successfully.
      expect(server?.listening).toBe(true);

      // Simulate an unexpected error after startup.
      server?.emit("error", runtimeError);

      // The original error must reach the callback.
      expect(onHttpError).toHaveBeenCalledOnce();
      expect(onHttpError).toHaveBeenCalledWith(runtimeError);
    } finally {
      // Resources must be released even if assertions fail.
      await lifecycle.stop();
    }

    expect(database.close).toHaveBeenCalledOnce();
  });

  it("propagates database cleanup failure after closing HTTP", async () => {
    const databaseError = new Error("Database pool shutdown failed");

    const database = {
      close: vi.fn(async () => {
        throw databaseError;
      }),
    };

    const lifecycle = createApiLifecycle(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        initializeDatabase: async () => database,

        createApp: () => ({
          listen(port: number, host: string) {
            return createHttpServer().listen(port, host);
          },
        }),
      },
    );

    try {
      const server = await lifecycle.start();

      expect(server?.listening).toBe(true);

      const firstStop = lifecycle.stop();
      const secondStop = lifecycle.stop();

      // Repeated shutdown calls share one operation.
      expect(secondStop).toBe(firstStop);

      // The database cleanup failure must reach the caller.
      await expect(firstStop).rejects.toMatchObject({
        errors: [databaseError],
      });

      // HTTP should already be closed.
      expect(server?.listening).toBe(false);

      // Database cleanup is attempted exactly once.
      expect(database.close).toHaveBeenCalledOnce();

      // A stopped lifecycle must not restart.
      await expect(lifecycle.start()).rejects.toThrow(
        "Cannot start a stopping API lifecycle",
      );
    } finally {
      // Ensure shutdown is requested if an earlier assertion fails.
      await lifecycle.stop().catch(() => {});
    }
  });

});