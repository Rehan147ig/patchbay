import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: [
      "apps/web/src/app/api/pull-requests/**/*.test.ts",
      "apps/web/src/app/api/cases/**/*.test.ts",
      "apps/web/src/app/api/remediations/**/*.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "server-only": path.resolve(__dirname, "apps/web/test/server-only.ts"),
    },
  },
});
