import type { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { closeResources } from "../../src/lifecycle.js";

describe("closeResources", () => {
  it("waits for HTTP shutdown before closing the database", async () => {
    const operations: string[] = [];

    const pending: {
      finish?: () => void;
    } = {};

    const httpServer = {
      listening: true,

      close(callback: (error?: Error) => void) {
        operations.push("http.close");

        pending.finish = () => callback();
      },
    } as unknown as Server;

    const database = {
      close: vi.fn(async () => {
        operations.push("database.close");
      }),
    };

    const shutdown = closeResources(httpServer, database);

    expect(operations).toEqual(["http.close"]);
    expect(database.close).not.toHaveBeenCalled();

    pending.finish?.();

    await shutdown;

    expect(operations).toEqual([
      "http.close",
      "database.close",
    ]);

    expect(database.close).toHaveBeenCalledOnce();
  });

  it("closes the database when no HTTP server exists", async () => {
    const database = {
      close: vi.fn(async () => {}),
    };

    await closeResources(undefined, database);

    expect(database.close).toHaveBeenCalledOnce();
  });

  it("attempts database cleanup when HTTP shutdown fails", async () => {
    const httpError = new Error("HTTP shutdown failed");

    const httpServer = {
      listening: true,

      close(callback: (error?: Error) => void) {
        callback(httpError);
      },
    } as unknown as Server;

    const database = {
      close: vi.fn(async () => {}),
    };

    await expect(
      closeResources(httpServer, database),
    ).rejects.toMatchObject({
      errors: [httpError],
    });

    expect(database.close).toHaveBeenCalledOnce();
  });

  it("preserves failures from both cleanup operations", async () => {
    const httpError = new Error("HTTP shutdown failed");
    const databaseError = new Error("Database shutdown failed");

    const httpServer = {
      listening: true,

      close(callback: (error?: Error) => void) {
        callback(httpError);
      },
    } as unknown as Server;

    const database = {
      close: vi.fn(async () => {
        throw databaseError;
      }),
    };

    await expect(
      closeResources(httpServer, database),
    ).rejects.toMatchObject({
      errors: [httpError, databaseError],
    });

    expect(database.close).toHaveBeenCalledOnce();
  });
});