import { afterEach, describe, expect, it, vi } from "vitest";

const env = process.env as Record<string, string | undefined>;

describe("login route in production", () => {
  const originalNodeEnv = env.NODE_ENV;
  const originalDbUrl = env.DATABASE_URL;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalNodeEnv;
    if (originalDbUrl === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = originalDbUrl;
    vi.resetModules();
  });

  it("returns 404 in production instead of attempting password login", async () => {
    env.NODE_ENV = "production";
    env.DATABASE_URL = "postgresql://irrelevant-for-this-test";
    vi.resetModules();
    const { POST } = await import("./route");

    const request = {
      headers: { get: () => null },
      json: async () => ({ email: "demo@patchbay.dev", password: "whatever" }),
    };
    const response = await POST(request as never);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
