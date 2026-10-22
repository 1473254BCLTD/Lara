import { once } from "node:events";

import { httpErrorResponseSchema } from "@lara/contracts";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { errorHandler } from "../../src/middleware/http-errors.js";
import { withValidatedQuery } from "../../src/middleware/validate-query.js";

const validationError = {
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid request data",
  },
};

describe("withValidatedQuery", () => {
  it.each([
    {
      name: "transforms a valid scalar into a number",
      query: "?page=2",
      status: 200,
      expected: { page: 2 },
    },
    {
      name: "applies a default when the parameter is absent",
      query: "",
      status: 200,
      expected: { page: 1 },
    },
    {
      name: "accepts the upper numeric bound",
      query: "?page=100",
      status: 200,
      expected: { page: 100 },
    },
    {
      name: "validates decoded query keys and values",
      query: "?pa%67e=%32",
      status: 200,
      expected: { page: 2 },
    },
    {
      name: "rejects zero",
      query: "?page=0",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects negative numbers",
      query: "?page=-1",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects numbers beyond the bound",
      query: "?page=101",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects fractional numbers",
      query: "?page=1.5",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects nonnumeric text",
      query: "?page=invalid",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects an empty value instead of applying the default",
      query: "?page=",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects a parameter without an equals sign",
      query: "?page",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects whitespace instead of coercing it",
      query: "?page=%20",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects repeated scalar parameters",
      query: "?page=2&page=3",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects bracket array syntax under the simple parser",
      query: "?page[]=2",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects nested query syntax under the simple parser",
      query: "?filter[page]=2",
      status: 400,
      expected: validationError,
    },
    {
      name: "honors the schema's rejection of unknown keys",
      query: "?page=2&unexpected=value",
      status: 400,
      expected: validationError,
    },
    {
      name: "rejects a failed asynchronous refinement",
      query: "?page=13",
      status: 400,
      expected: validationError,
    },
    {
      name: "propagates an asynchronous handler error as a safe 500",
      query: "?page=5",
      status: 500,
      expected: {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
    },
  ])("$name", async ({ query, status, expected }) => {
    const app = express();

    // This test-only schema requires a scalar decimal string before
    // conversion, then checks the parsed integer's permitted range.
    const schema = z.strictObject({
      page: z.string()
        .regex(/^[1-9]\d*$/)
        .pipe(z.coerce.number<string>().int().min(1).max(100))
        .default(1),
    }).refine(async ({ page }) => {
      await Promise.resolve();
      return page !== 13;
    });

    let handlerCalls = 0;
    const errorLog = status === 500
      ? vi.spyOn(console, "error").mockImplementation(() => {})
      : undefined;

    app.get(
      "/test",
      withValidatedQuery(schema, async (data, request, response) => {
        handlerCalls += 1;

        // The test type check verifies that the handler receives output,
        // including the numeric transformation and the applied default.
        const page: number = data.page;

        // Validated output must not replace Express's raw query values.
        expect(request.query.page).toBe(query === "" ? undefined : String(page));

        await Promise.resolve();

        if (page === 5) {
          throw new Error("private-query-handler-detail");
        }

        response.json({ page });
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

      // GET requests deliberately have no JSON content-type requirement.
      const response = await fetch(
        `http://127.0.0.1:${address.port}/test${query}`,
        {
          headers: { Connection: "close" },
          signal: AbortSignal.timeout(4000),
        },
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain("application/json");

      const responseText = await response.text();
      expect(responseText).not.toContain("private-query-handler-detail");
      const result: unknown = JSON.parse(responseText);

      if (status !== 200) {
        httpErrorResponseSchema.parse(result);
      }

      expect(result).toEqual(expected);
      expect(handlerCalls).toBe(status === 400 ? 0 : 1);

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
