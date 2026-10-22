import { once } from "node:events";

import { httpErrorResponseSchema } from "@lara/contracts";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { errorHandler } from "../../src/middleware/http-errors.js";
import { withValidatedBody } from "../../src/middleware/validate-body.js";

describe("withValidatedBody", () => {
  it.each([
    {
      name: "accepts and transforms valid data",
      contentType: "application/json",
      body: { quantity: "3" },
      status: 200,
      expected: { quantity: 3 },
    },
    {
      name: "accepts JSON with charset",
      contentType: "application/json; charset=utf-8",
      body: { quantity: "7" },
      status: 200,
      expected: { quantity: 7 },
    },
    {
      name: "propagates unexpected controller errors",
      contentType: "application/json",
      body: { quantity: "5" },
      status: 500,
      expected: {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
    },
    {
      name: "rejects asynchronous refinement",
      contentType: "application/json",
      body: { quantity: "4" },
      status: 400,
      expected: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
        },
      },
    },
    {
      name: "rejects a missing JSON body",
      contentType: "application/json",
      body: undefined,
      status: 400,
      expected: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
        },
      },
    },
    {
      name: "rejects a body without content type",
      contentType: undefined,
      body: { quantity: "3" },
      status: 415,
      expected: {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Unsupported media type",
        },
      },
    },
    {
      name: "rejects unsupported text content",
      contentType: "text/plain",
      body: { quantity: "3" },
      status: 415,
      expected: {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Unsupported media type",
        },
      },
    },
    {
      name: "rejects invalid data",
      contentType: "application/json",
      body: { quantity: "invalid" },
      status: 400,
      expected: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
        },
      },
    },
  ])("$name", async ({ body, status, expected, contentType }) => {
    const app = express();

    const schema = z.object({
      quantity: z.coerce.number().int().positive(),
    }).refine(async ({ quantity }) => {
      await Promise.resolve();
      return quantity % 2 === 1;
    });

    let handlerCalls = 0;
    const errorLog = status === 500
      ? vi.spyOn(console, "error").mockImplementation(() => {})
      : undefined;

    app.use(express.json());

    app.post(
      "/test",
      withValidatedBody(schema, (data, _request, response) => {
        handlerCalls += 1;
        const quantity: number = data.quantity;
        if (quantity === 5) {
          throw new Error("private-controller-detail");
        }

        response.json({ quantity });
      }),
    );

    app.use(errorHandler);

    const server = app.listen(0, "127.0.0.1");

    try {
      await once(server, "listening");

      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Unexpected HTTP server address");
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/test`,
        {
          method: "POST",
          headers: {
            ...(contentType === undefined ? {} : { "Content-Type": contentType }),
            Connection: "close",
          },
          body: contentType === undefined
            ? new Blob([JSON.stringify(body)])
            : JSON.stringify(body),
          signal: AbortSignal.timeout(4000),
        },
      );

      expect(response.status).toBe(status);

      const responseText = await response.text();
      expect(responseText).not.toContain("private-controller-detail");
      const result: unknown = JSON.parse(responseText);

      if (status !== 200) {
        httpErrorResponseSchema.parse(result);
      }

      expect(result).toEqual(expected);
      expect(handlerCalls).toBe(status === 200 || status === 500 ? 1 : 0);

      if (status === 500) {
        expect(errorLog).toHaveBeenCalledOnce();
      }
    } finally {
      server.closeAllConnections();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      errorLog?.mockRestore();
    }
  });
});
