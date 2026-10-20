import { describe, expect, it } from "vitest";

import { parseServerEnv } from "../../src/env.js";

describe("parseServerEnv security checks", () => {
  it("rejects unsupported NODE_ENV values", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "staging",
      }),
    ).toThrow(/Invalid server environment variables: NODE_ENV/);
  });

  it.each(["SERVER_HOST", "SERVER_PORT"])(
    "requires %s explicitly in production",
    (missingKey) => {
      const env: Record<string, string> = {
        NODE_ENV: "production",
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: "3000",
      };

      delete env[missingKey];

      expect(() => parseServerEnv(env)).toThrow(missingKey);
    },
  );

  it("does not expose invalid configuration values", () => {
    const sensitiveValue = "sensitive-test-value-123";

    let errorMessage = "";

    try {
      parseServerEnv({
        NODE_ENV: "development",
        SERVER_PORT: sensitiveValue,
      });
    } catch (error) {
      errorMessage = String(error);
    }

    expect(errorMessage).toContain("SERVER_PORT");
    expect(errorMessage).not.toContain(sensitiveValue);
  });
});