import { defineConfig } from "vitest/config";

/**
 * Lara — PostgreSQL Integration Tests
 *
 * These tests execute against a real, isolated PostgreSQL
 * instance rather than an in-memory or mocked database.
 *
 * Database connection validation and fixture management are
 * implemented in the test support files, with RLS assertions
 * covered by the integration test suite.
 */
export default defineConfig({
  test: {
    /**
     * PostgreSQL integration tests run in Node.js.
     */
    environment: "node",

    /**
     * Only discover database integration tests.
     *
     * Unit tests will have a separate configuration
     * when introduced.
     */
    include: [
      "test/integration/**/*.test.ts",
    ],

    /**
     * Execute test files sequentially.
     *
     * This prevents multiple test files from modifying
     * shared PostgreSQL fixtures simultaneously.
     */
    fileParallelism: false,

    /**
     * Prevent explicitly concurrent tests and hooks
     * from executing simultaneously.
     */
    maxConcurrency: 1,

    /**
     * Database integration tests should terminate
     * after one execution rather than watch files.
     */
    watch: false,
  },
});
