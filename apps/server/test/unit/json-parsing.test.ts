import { once } from "node:events";

import { httpErrorResponseSchema } from "@lara/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";

describe("JSON request parsing", () => {
  it.each([
    {
      name: "valid JSON",
      contentType: "application/json",
      body: JSON.stringify({ data: "accepted" }),
      status: 404,
      code: "NOT_FOUND",
      message: "Resource not found",
    },
    {
      name: "unsupported JSON charset",
      contentType: "application/json; charset=iso-8859-1",
      body: JSON.stringify({ data: "accepted" }),
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Unsupported media type",
    },
    {
      name: "top-level JSON primitive",
      contentType: "application/json",
      body: JSON.stringify("hello"),
      status: 400,
      code: "INVALID_JSON",
      message: "Invalid JSON request body",
    },
    {
      name: "malformed JSON",
      contentType: "application/json",
      body: "{invalid",
      status: 400,
      code: "INVALID_JSON",
      message: "Invalid JSON request body",
    },
    {
      name: "oversized JSON",
      contentType: "application/json",
      body: JSON.stringify({ data: "x".repeat(70 * 1024) }),
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "JSON request body exceeds size limit",
    },
  ])("handles $name safely", async ({
    body,
    contentType,
    status,
    code,
    message,
  }) => {
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
          method: "POST",
          headers: {
            "Content-Type": contentType,
            Connection: "close",
          },
          body,
          signal: AbortSignal.timeout(4000),
        },
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("content-type"))
        .toContain("application/json");

      const result = httpErrorResponseSchema.parse(
        await response.json(),
      );

      expect(result).toEqual({
        error: { code, message },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
