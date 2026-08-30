import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/worker/src/jobs/redis-pr-slot-integration.test.ts",
      "packages/queue/src/redis-pr-slot-integration.test.ts",
    ],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globalSetup: "./vitest.redis.setup.ts",
    globalTeardown: "./vitest.redis.teardown.ts",
  },
});
