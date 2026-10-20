import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { createApiLifecycle } from "../../src/lifecycle.js";

describe("createApiLifecycle", () => {
  it("starts and stops resources exactly once", async () => {
    const operations: string[] = [];

    const database = {
      close: vi.fn(async () => {
        operations.push("database.close");
      }),
    };

    const initializeDatabase = vi.fn(async () => {
      operations.push("database.initialize");

      return database;
    });

    const createApp = vi.fn(() => {
      operations.push("app.create");

      return {
        listen(port: number, host: string) {
          operations.push("http.listen");

          const server = createServer((_request, response) => {
            response.end("ok");
          });

          server.listen(port, host);

          return server;
        },
      };
    });

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

    const firstStart = lifecycle.start();
    const secondStart = lifecycle.start();

    expect(secondStart).toBe(firstStart);

    const server = await firstStart;

    try {
      expect(server?.listening).toBe(true);

      expect(initializeDatabase).toHaveBeenCalledOnce();
      expect(createApp).toHaveBeenCalledOnce();

      expect(operations).toEqual([
        "database.initialize",
        "app.create",
        "http.listen",
      ]);

      const firstStop = lifecycle.stop();
      const secondStop = lifecycle.stop();

      expect(secondStop).toBe(firstStop);

      await firstStop;

      expect(server?.listening).toBe(false);
      expect(database.close).toHaveBeenCalledOnce();

      expect(operations).toEqual([
        "database.initialize",
        "app.create",
        "http.listen",
        "database.close",
      ]);
    } finally {
      await lifecycle.stop();
    }

    await expect(lifecycle.start()).rejects.toThrow(
      "Cannot start a stopping API lifecycle",
    );
  });

  it("does not start HTTP when shutdown occurs during initialization", async () => {
    const database = {
      close: vi.fn(async () => {}),
    };

    let completeInitialization!: (
      runtime: typeof database,
    ) => void;

    const initialization = new Promise<typeof database>(
      (resolve) => {
        completeInitialization = resolve;
      },
    );

    const createApp = vi.fn(() => ({
      listen: vi.fn(() => {
        throw new Error("HTTP must not start");
      }),
    }));

    const lifecycle = createApiLifecycle(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        initializeDatabase: () => initialization,
        createApp,
      },
    );

    // Database initialization remains pending.
    const starting = lifecycle.start();

    // Request shutdown before initialization finishes.
    const stopping = lifecycle.stop();

    // Simulate the database finishing initialization.
    completeInitialization(database);

    expect(await starting).toBeUndefined();

    await stopping;

    // HTTP application creation must have been skipped.
    expect(createApp).not.toHaveBeenCalled();

    // The initialized database must still be released.
    expect(database.close).toHaveBeenCalledOnce();

    // Shutdown is terminal for this lifecycle instance.
    await expect(lifecycle.start()).rejects.toThrow(
      "Cannot start a stopping API lifecycle",
    );
  });
});