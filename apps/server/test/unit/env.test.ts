import { describe, expect, it } from "vitest";

import { parseServerEnv } from "../../src/env.js";

describe("parseServerEnv", () => {
  it("requires an explicit NODE_ENV", () => {
    expect(() => parseServerEnv({})).toThrow(
      /Invalid server environment variables: NODE_ENV/,
    );
  });

  it("provides safe development defaults", () => {
    const config = parseServerEnv({
      NODE_ENV: "development",
    });

    expect(config).toEqual({
      NODE_ENV: "development",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: 3000,
    });
  });

  it("accepts custom host and port settings", () => {
    const config = parseServerEnv({
      NODE_ENV: "test",
      SERVER_HOST: "0.0.0.0",
      SERVER_PORT: "8080",
    });

    expect(config.SERVER_HOST).toBe("0.0.0.0");
    expect(config.SERVER_PORT).toBe(8080);
  });

  it.each(["0", "65536", "abc", "3000.5"])(
    "rejects invalid port %s",
    (port) => {
      expect(() =>
        parseServerEnv({
          NODE_ENV: "development",
          SERVER_PORT: port,
        }),
      ).toThrow(/Invalid server environment variables: SERVER_PORT/);
    },
  );

  it("requires explicit production host and port", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
      }),
    ).toThrow(
      /Missing production server environment variables: SERVER_HOST, SERVER_PORT/,
    );
  });

  it("accepts an explicitly configured production environment", () => {
    const config = parseServerEnv({
      NODE_ENV: "production",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: "3001",
    });

    expect(config).toEqual({
      NODE_ENV: "production",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: 3001,
    });
  });
});