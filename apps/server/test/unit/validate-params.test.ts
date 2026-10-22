import { once } from "node:events";

import { httpErrorResponseSchema } from "@lara/contracts";
import express from "express";
import type { Express } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { errorHandler } from "../../src/middleware/http-errors.js";
import { withValidatedParams } from "../../src/middleware/validate-params.js";

const validationError = {
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid request data",
  },
};

const internalError = {
  error: {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  },
};

// Keep server startup and cleanup local to these database-independent tests.
async function withHttpServer(
  app: Express,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Unexpected HTTP server address");
    }

    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

describe("withValidatedParams", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it.each([
    { name: "accepts a UUID", id: uuid, status: 200 },
    { name: "transforms an uppercase UUID", id: uuid.toUpperCase(), status: 200 },
    {
      name: "validates a decoded UUID",
      id: `%35${uuid.slice(1)}`,
      status: 200,
    },
    { name: "rejects an invalid UUID", id: "invalid", status: 400 },
    {
      name: "rejects a decoded slash in a UUID",
      id: `${uuid}%2Fother`,
      status: 400,
    },
  ])("$name", async ({ id, status }) => {
    const app = express();
    const schema = z.strictObject({
      id: z.uuid().transform((value) => value.toLowerCase()),
    });
    let handlerCalls = 0;

    app.get(
      "/items/:id",
      withValidatedParams(schema, (data, request, response) => {
        handlerCalls += 1;
        const parsedId: string = data.id;

        // Transforming the output must not replace the original parameters.
        expect(request.params.id).toBe(decodeURIComponent(id));
        response.json({ id: parsedId });
      }),
    );
    app.use(errorHandler);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/items/${id}`, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(4000),
      });

      expect(response.status).toBe(status);
      const body: unknown = await response.json();

      if (status === 400) {
        httpErrorResponseSchema.parse(body);
      }

      expect(body).toEqual(status === 200 ? { id: uuid } : validationError);
      expect(handlerCalls).toBe(status === 200 ? 1 : 0);
    });
  });

  it.each([
    { name: "passes a transformed number", value: "2", status: 200 },
    { name: "transforms a decoded number", value: "%32", status: 200 },
    { name: "rejects nonnumeric input", value: "invalid", status: 400 },
    { name: "rejects zero", value: "0", status: 400 },
    { name: "rejects fractional input", value: "1.5", status: 400 },
    { name: "rejects a failed asynchronous refinement", value: "13", status: 400 },
    { name: "masks a synchronous handler error", value: "5", status: 500 },
    { name: "masks an asynchronous handler error", value: "7", status: 500 },
  ])("$name", async ({ value, status }) => {
    const app = express();
    const schema = z.strictObject({
      value: z.string()
        .regex(/^[1-9]\d*$/)
        .pipe(z.coerce.number<string>().int().min(1).max(100)),
    }).refine(async ({ value: parsedValue }) => {
      await Promise.resolve();
      return parsedValue !== 13;
    });

    let handlerCalls = 0;
    const secret = "private-parameter-handler-detail";
    const errorLog = status === 500
      ? vi.spyOn(console, "error").mockImplementation(() => {})
      : undefined;

    app.get(
      "/numbers/:value",
      withValidatedParams(schema, (data, request, response) => {
        handlerCalls += 1;
        const parsedValue: number = data.value;
        expect(request.params.value).toBe(decodeURIComponent(value));

        if (parsedValue === 5) {
          throw new Error(secret);
        }

        return Promise.resolve().then(() => {
          if (parsedValue === 7) {
            throw new Error(secret);
          }

          response.json({ value: parsedValue });
        });
      }),
    );
    app.use(errorHandler);

    try {
      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/numbers/${value}`, {
          headers: { Connection: "close" },
          signal: AbortSignal.timeout(4000),
        });

        expect(response.status).toBe(status);
        const responseText = await response.text();
        expect(responseText).not.toContain(secret);
        const body: unknown = JSON.parse(responseText);

        if (status !== 200) {
          httpErrorResponseSchema.parse(body);
        }

        const expected = status === 200
          ? { value: 2 }
          : status === 400 ? validationError : internalError;

        expect(body).toEqual(expected);
        expect(handlerCalls).toBe(status === 400 ? 0 : 1);

        if (status === 500) {
          expect(errorLog).toHaveBeenCalledOnce();
        }
      });
    } finally {
      errorLog?.mockRestore();
    }
  });

  it.each([
    {
      name: "accepts a wildcard array",
      path: "one/two",
      expected: ["one", "two"],
      status: 200,
    },
    {
      name: "decodes wildcard segments without splitting an encoded slash again",
      path: "one%2Ftwo/hello%20world",
      expected: ["one/two", "hello world"],
      status: 200,
    },
    {
      name: "rejects a wildcard array beyond the schema's bound",
      path: "one/two/three/four",
      expected: [],
      status: 400,
    },
  ])("$name", async ({ path, expected, status }) => {
    const app = express();
    const schema = z.strictObject({
      segments: z.array(z.string().min(1)).min(1).max(3),
    });
    let handlerCalls = 0;

    app.get(
      "/files/*segments",
      withValidatedParams(schema, (data, _request, response) => {
        handlerCalls += 1;
        const segments: string[] = data.segments;
        response.json({ segments });
      }),
    );
    app.use(errorHandler);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/files/${path}`, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(4000),
      });

      expect(response.status).toBe(status);
      const body: unknown = await response.json();

      if (status === 400) {
        httpErrorResponseSchema.parse(body);
      }

      expect(body).toEqual(status === 200 ? { segments: expected } : validationError);
      expect(handlerCalls).toBe(status === 200 ? 1 : 0);
    });
  });

  it("rejects a wildcard array when the schema requires a scalar", async () => {
    const app = express();
    const handler = vi.fn();

    app.get(
      "/files/*segments",
      withValidatedParams(z.strictObject({ segments: z.string() }), handler),
    );
    app.use(errorHandler);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/files/one/two`, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(4000),
      });

      expect(response.status).toBe(400);
      const body = httpErrorResponseSchema.parse(await response.json());
      expect(body).toEqual(validationError);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
