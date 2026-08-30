import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/redis-pr-slot-integration.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globalSetup: "./vitest.redis.setup.ts",
    globalTeardown: "./vitest.redis.teardown.ts",
    sequence: { concurrent: false },
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  server: {
    deps: {
      inline: [/ioredis/],
    },
  },
});
