import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Include only Redis integration test files
    include: [
      "apps/worker/src/jobs/*redis*integration*.test.ts",
      "packages/queue/src/*redis*integration*.test.ts",
    ],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Global setup that runs before all tests
    globalSetup: "./vitest.redis.setup.ts",
    // Global teardown that runs after all tests
    globalTeardown: "./vitest.redis.teardown.ts",
  },
});
