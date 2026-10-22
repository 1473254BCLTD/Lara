import { once } from "node:events";

import { httpErrorResponseSchema } from "@lara/contracts";
import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { Request, Response } from "express";

import { createApp } from "../../src/app.js";
import { errorHandler } from "../../src/middleware/http-errors.js";

describe("HTTP error handling", () => {
  it("returns a structured 404 for an unknown route", async () => {
    const server = createApp().listen(0, "127.0.0.1");

    try {
      await once(server, "listening");

      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Unexpected HTTP server address");
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/unknown`,
        {
          headers: {
            Connection: "close",
          },
          signal: AbortSignal.timeout(4000),
        },
      );

      expect(response.status).toBe(404);

      expect(response.headers.get("content-type"))
        .toContain("application/json");

      expect(response.headers.has("x-powered-by"))
        .toBe(false);

      const body = httpErrorResponseSchema.parse(
        await response.json(),
      );

      expect(body).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "Resource not found",
        },
      });
    } finally {
      server.closeAllConnections();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it.each(["synchronous", "asynchronous"] as const)(
    "returns a safe 500 for %s route errors",
    async (mode) => {
      const app = express();
      const secret = "sensitive-internal-database-detail";

      if (mode === "synchronous") {
        app.get("/failure", () => {
          throw new Error(secret);
        });
      } else {
        app.get("/failure", async () => {
          await Promise.resolve();
          throw new Error(secret);
        });
      }

      // Error middleware must follow the routes.
      app.use(errorHandler);

      // Suppress expected diagnostic output during this test.
      const errorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const server = app.listen(0, "127.0.0.1");

      try {
        await once(server, "listening");

        const address = server.address();

        if (!address || typeof address === "string") {
          throw new Error("Unexpected HTTP server address");
        }

        const response = await fetch(
          `http://127.0.0.1:${address.port}/failure`,
          {
            headers: {
              Connection: "close",
            },
            signal: AbortSignal.timeout(4000),
          },
        );

        expect(response.status).toBe(500);

        expect(response.headers.get("content-type"))
          .toContain("application/json");

        const responseText = await response.text();

        // The internal error must never reach the client.
        expect(responseText).not.toContain(secret);

        const body = httpErrorResponseSchema.parse(
          JSON.parse(responseText),
        );

        expect(body).toEqual({
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error",
          },
        });

        // The server should retain diagnostic information.
        expect(errorLog).toHaveBeenCalledOnce();
      } finally {
        server.closeAllConnections();

        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });

        errorLog.mockRestore();
      }
    },
  );

  it.each([
    { name: "a bare percent sign", route: "/items/:id", path: "/items/%" },
    {
      name: "an incomplete UTF-8 sequence",
      route: "/items/:id",
      path: "/items/%E0%A4%A",
    },
    { name: "an invalid UTF-8 byte", route: "/items/:id", path: "/items/%FF" },
    {
      name: "a malformed wildcard segment",
      route: "/files/*segments",
      path: "/files/one/%",
    },
  ])("returns a safe 400 for $name", async ({ route, path }) => {
    const app = express();
    const handler = vi.fn((_request: Request, response: Response) => {
      response.json({ ok: true });
    });

    app.get(route, handler);
    app.use(errorHandler);

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = app.listen(0, "127.0.0.1");

    try {
      await once(server, "listening");
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Unexpected HTTP server address");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(4000),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");

      const responseText = await response.text();
      expect(responseText).not.toContain("Failed to decode param");
      expect(responseText).not.toContain(path);
      const body = httpErrorResponseSchema.parse(JSON.parse(responseText));

      expect(body).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
        },
      });
      expect(handler).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      errorLog.mockRestore();
    }
  });

  it.each([
    { name: "a URIError without status", error: new URIError("private-uri-detail") },
    {
      name: "an ordinary error carrying status 400",
      error: Object.assign(new Error("private-status-detail"), { status: 400 }),
    },
    {
      name: "a URIError carrying another status",
      error: Object.assign(new URIError("private-other-status-detail"), { status: 500 }),
    },
  ])("preserves a safe 500 for $name", ({ error }) => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();
    const response = { headersSent: false, status, json } as unknown as Response;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      errorHandler(error, {} as Request, response, next);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      });
      expect(errorLog).toHaveBeenCalledWith("Unhandled API error:", error);
      expect(next).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("delegates errors after response headers are sent", () => {
    const error = new Error("Connection interrupted");

    const next = vi.fn();
    const status = vi.fn();
    const json = vi.fn();

    // Only the relevant Express response properties
    // are needed for this middleware branch.
    const response = {
      headersSent: true,
      status,
      json,
    } as unknown as Response;

    errorHandler(
      error,
      {} as Request,
      response,
      next,
    );

    // The original error must be passed onward.
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);

    // Never attempt another HTTP response.
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

});
