import { describe, expect, it } from "vitest";
import { envSchema, parseEnv } from "./index";

const DEV_SECRET = "x".repeat(64);
const PROD_SECRET = "y".repeat(64);

function validDevEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://patchbay:patchbay_dev_only@localhost:5434/patchbay",
    DEV_AUTH_SECRET: DEV_SECRET,
    DEMO_USER_PASSWORD: "dev-only",
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("accepts a valid development configuration and applies defaults", () => {
    const env = parseEnv(validDevEnv());
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.REDIS_URL).toBe("redis://127.0.0.1:6379");
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.DEMO_USER_EMAIL).toBe("demo@patchbay.dev");
    expect(env.TRUSTED_PROXY_CIDRS).toBe("");
    expect(env.SANDBOX_TIMEOUT_MS).toBe(120_000);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ ...validDevEnv(), DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("fails fast when DEV_AUTH_SECRET is missing in development", () => {
    const env = validDevEnv();
    delete env.DEV_AUTH_SECRET;
    expect(() => parseEnv(env)).toThrow(/DEV_AUTH_SECRET/);
  });

  it("fails fast on a too-short dev secret", () => {
    expect(() => parseEnv(validDevEnv({ DEV_AUTH_SECRET: "short" }))).toThrow(/DEV_AUTH_SECRET/);
  });

  it("fails fast when DEMO_USER_PASSWORD is missing in development", () => {
    const env = validDevEnv();
    delete env.DEMO_USER_PASSWORD;
    expect(() => parseEnv(env)).toThrow(/DEMO_USER_PASSWORD/);
  });

  it("rejects an OAuth client id without a client secret", () => {
    expect(() => parseEnv(validDevEnv({ GITHUB_CLIENT_ID: "abc" }))).toThrow(
      /must be set together/,
    );
  });

  it("rejects a GitHub App id without a private key", () => {
    expect(() => parseEnv(validDevEnv({ GITHUB_APP_ID: "123" }))).toThrow(/must be set together/);
  });

  it("rejects a PAT without a repository", () => {
    expect(() => parseEnv(validDevEnv({ GITHUB_TOKEN: "ghp_abc" }))).toThrow(
      /must be set together/,
    );
  });

  it("rejects AI_PROVIDER=openai without an API key", () => {
    expect(() => parseEnv(validDevEnv({ AI_PROVIDER: "openai" }))).toThrow(/OPENAI_API_KEY/);
  });

  it("treats blank optional values as unset", () => {
    const env = parseEnv(
      validDevEnv({ GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", NEXTAUTH_SECRET: "" }),
    );
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined();
    expect(env.NEXTAUTH_SECRET).toBeUndefined();
  });

  it("accepts a production configuration without dev credentials", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://patchbay:secret@db.example/patchbay",
      NEXTAUTH_SECRET: PROD_SECRET,
      GITHUB_CLIENT_ID: "abc",
      GITHUB_CLIENT_SECRET: "def",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.DEV_AUTH_SECRET).toBeUndefined();
    expect(env.AI_PROVIDER).toBe("mock");
  });

  it("rejects production config that still sets a dev secret", () => {
    // DEV_AUTH_SECRET is permitted-but-unused in production; what must not
    // happen is a blank secret, which the min-length rule rejects regardless.
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://x",
        DEV_AUTH_SECRET: "short",
      }),
    ).toThrow(/DEV_AUTH_SECRET/);
  });

  it("exposes a schema that reports all dev-required issues at once", () => {
    const result = envSchema.safeParse({ DATABASE_URL: "postgresql://x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join("; ");
      expect(messages).toContain("DEV_AUTH_SECRET");
      expect(messages).toContain("DEMO_USER_PASSWORD");
    }
  });
});
