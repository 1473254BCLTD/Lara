import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { closeResources } from "../../src/lifecycle.js";

describe("closeResources with active HTTP requests", () => {
  it("finishes an active request before closing the database", async () => {
    const operations: string[] = [];

    let requestStarted!: () => void;
    let finishResponse: (() => void) | undefined;

    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });

    const server = createServer((_request, response) => {
      // Avoid retaining an idle HTTP connection after the response.
      response.setHeader("Connection", "close");

      response.once("finish", () => {
        operations.push("http.finished");
      });

      finishResponse = () => {
        response.end("completed");
      };

      requestStarted();
    });

    const database = {
      close: vi.fn(async () => {
        operations.push("database.closed");
      }),
    };

    server.listen(0, "127.0.0.1");

    await once(server, "listening");

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Unexpected HTTP server address");
    }

    try {
      const responsePromise = fetch(
        `http://127.0.0.1:${address.port}/`,
        {
          signal: AbortSignal.timeout(4000),
        },
      );

      // Wait until the request reaches the HTTP handler.
      await started;

      // Begin shutdown while the request is still active.
      const shutdown = closeResources(server, database);

      // PostgreSQL must remain available at this point.
      expect(database.close).not.toHaveBeenCalled();

      // Allow the active request to finish.
      finishResponse?.();

      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("completed");

      // Wait for all resources to close.
      await shutdown;

      expect(database.close).toHaveBeenCalledOnce();

      expect(operations).toEqual([
        "http.finished",
        "database.closed",
      ]);
    } finally {
      // Ensure test resources are released.
      finishResponse?.();

      server.closeAllConnections();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});