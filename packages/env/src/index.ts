/**
 * Single source of truth for runtime environment variables across web and
 * worker. Call `parseEnv()` explicitly at every process boot point; never
 * parse at import time in libraries that tests import, so unit tests can
 * inject their own values through `parseEnv(source)`.
 */
import { z } from "zod";

/** Treat a blank optional value as unset so template `.env` files stay valid. */
function optionalText(minLength: number) {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(minLength).optional(),
  );
}

function optionalUrl() {
  return z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required (set it in .env)"),
    REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),

    // Dev-only session cookie signing secret. Required outside production;
    // ignored in production, where the dev session must never be trusted.
    DEV_AUTH_SECRET: optionalText(32),
    NEXTAUTH_SECRET: optionalText(32),

    // GitHub OAuth sign-in (NextAuth). Both or neither.
    GITHUB_CLIENT_ID: optionalText(1),
    GITHUB_CLIENT_SECRET: optionalText(1),

    // GitHub App (installations, webhooks, draft PRs).
    GITHUB_APP_ID: optionalText(1),
    GITHUB_APP_PRIVATE_KEY: optionalText(1),
    GITHUB_APP_WEBHOOK_SECRET: optionalText(16),
    GITHUB_APP_SLUG: optionalText(1),

    // PAT fallback (single-repository mode). Both or neither.
    GITHUB_TOKEN: optionalText(1),
    GITHUB_REPOSITORY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^[^/]+\/[^/]+$/, "GITHUB_REPOSITORY must be owner/repo")
        .optional(),
    ),
    GITHUB_API_URL: optionalUrl(),

    // Local demo identity.
    DEMO_USER_EMAIL: z.string().trim().email().default("demo@patchbay.dev"),
    DEMO_USER_PASSWORD: z.string().min(1).optional(),

    // AI provider. Anything other than "mock" requires an API key.
    AI_PROVIDER: z.enum(["mock", "openai", "openai-compatible"]).default("mock"),
    OPENAI_API_KEY: optionalText(1),
    OPENAI_BASE_URL: optionalUrl(),
    OPENAI_MODEL: z.string().trim().min(1).default("gpt-4o-mini"),

    // Ingress trust for x-forwarded-for (comma-separated CIDRs; empty = trust none).
    TRUSTED_PROXY_CIDRS: z.string().default(""),

    // Sandbox runner.
    SANDBOX_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(120_000),
    SANDBOX_MAX_OUTPUT_CHARS: z.coerce.number().int().min(1).max(1_000_000).default(20_000),

    // Release Watchtower polling. Schedulers are registered at worker boot
    // only when enabled; intervals in milliseconds.
    WATCHTOWER_POLLING_ENABLED: z.preprocess((value) => {
      if (value === undefined) return true;
      if (value === "true") return true;
      if (value === "false") return false;
      return true;
    }, z.boolean()),
    WATCHTOWER_POLL_INTERVAL_NPM_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(15 * 60_000),
    WATCHTOWER_POLL_INTERVAL_GITHUB_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(30 * 60_000),

    // Stripe billing. All optional: when STRIPE_SECRET_KEY is unset the app
    // runs without billing (checkout/portal routes 503 and plan stays FREE).
    STRIPE_SECRET_KEY: optionalText(1),
    STRIPE_WEBHOOK_SECRET: optionalText(16),
    STRIPE_PRICE_PRO_MONTHLY: optionalText(1),
    STRIPE_PRICE_TEAM_MONTHLY: optionalText(1),
  })
  .superRefine((env, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: "custom", message });
    };

    if (env.NODE_ENV !== "production") {
      if (!env.DEV_AUTH_SECRET) {
        issue("DEV_AUTH_SECRET (min 32 chars) is required outside production");
      }
      if (!env.DEMO_USER_PASSWORD) {
        issue("DEMO_USER_PASSWORD is required outside production");
      }
    }

    if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(env.GITHUB_CLIENT_SECRET)) {
      issue("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together");
    }
    if (Boolean(env.GITHUB_APP_ID) !== Boolean(env.GITHUB_APP_PRIVATE_KEY)) {
      issue("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set together");
    }
    // A lone GITHUB_REPOSITORY is inert (GitHub Actions injects it into every
    // job; the provider only activates when both are set). Failing closed on a
    // token without a repository keeps the PAT fallback explicit.
    if (env.GITHUB_TOKEN && !env.GITHUB_REPOSITORY) {
      issue("GITHUB_TOKEN and GITHUB_REPOSITORY must be set together");
    }
    if (env.AI_PROVIDER !== "mock" && !env.OPENAI_API_KEY) {
      issue("OPENAI_API_KEY is required when AI_PROVIDER is not mock");
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate an environment. Throws on the first boot failure with a
 * readable summary so misconfigured servers and workers die fast instead of
 * serving half-configured behavior.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

export { EnvSecretStore, getSecretStore } from "./secrets";
export type { SecretStore, SecretStoreOptions } from "./secrets";
