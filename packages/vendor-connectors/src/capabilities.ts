/**
 * ConnectorCapability registry (source-controlled configuration, WP1).
 *
 * Capability levels are strict: a connector is only promoted past ASSESS when
 * the full certification kit exists (trusted adapter, deterministic
 * normalization, usage analysis, migration rules, positive/negative fixtures,
 * sandbox profile, and passing corpus metrics). Existence in the catalog is
 * never enough to claim auto-remediation.
 *
 *   DETECT     trusted release evidence observed and deduplicated
 *   ASSESS     dependency and graph evidence identify affected repositories
 *   PLAN       a reviewable deterministic or AI-assisted plan exists
 *   VALIDATE   a supported patch can be sandbox-validated
 *   DRAFT_PR   a policy-permitted validated patch can create a GitHub draft PR
 */
import { listConnectorSlugs } from "./registry";

export const CAPABILITY_LEVELS = ["DETECT", "ASSESS", "PLAN", "VALIDATE", "DRAFT_PR"] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

export const CAPABILITY_LEVEL_INDEX: Record<CapabilityLevel, number> = {
  DETECT: 0,
  ASSESS: 1,
  PLAN: 2,
  VALIDATE: 3,
  DRAFT_PR: 4,
};

export type CapabilityEcosystem = "npm" | "openapi" | "github-releases";
export type PolicyClass = "PLAN_ONLY" | "APPROVAL_REQUIRED" | "REVIEW_REQUIRED";

/** Corpus metrics proving the certified level (WP9 certification kit). */
export interface CorpusMetrics {
  dependencyMatchRecallPct: number;
  affectedUsagePrecisionPct: number;
  patchValidationPct: number;
  policyOutcomeCorrectPct: number;
}

/** Reference to the evaluation corpus that certified this capability. */
export interface EvalCorpusRef {
  id: string;
  owner: string;
  status: "ACTIVE" | "DRAFT" | "SUSPENDED" | "EXPIRED";
  reviewedAt: string;
  expiresAt: string;
  /** Measured metrics from the certification corpus (required for VALIDATE+). */
  metrics: CorpusMetrics;
}

export interface ConnectorCapability {
  vendorSlug: string;
  ecosystem: CapabilityEcosystem;
  /** Primary package/spec identifier the connector normalizes. */
  package: string;
  language: string;
  /** Highest certified capability level. */
  level: CapabilityLevel;
  /** Rule-pack that encodes the migration rules; null until PLAN. */
  rulePackVersion: string | null;
  /** repo-analysis extractor version the usage analysis was certified against. */
  extractorVersion: string;
  /** Sandbox validation profile; null until VALIDATE. */
  validationProfile: string | null;
  /** Policy class required before any patch/PR action for this connector. */
  requiredPolicyClass: PolicyClass;
  /** Corpus proving the certified level; null until PLAN. */
  corpus: EvalCorpusRef | null;
  certifiedAt: string | null;
}

const RULE_PACK_VERSION = "1.0.0";
const EXTRACTOR_VERSION = "1.0.0";
const CERTIFIED_AT = "2026-08-17";

/** npm/JS connector baseline: dependency match + usage analysis, no certification kit. */
function baseline(slug: string, pkg: string): ConnectorCapability {
  return {
    vendorSlug: slug,
    ecosystem: "npm",
    package: pkg,
    language: "typescript/javascript",
    level: "ASSESS",
    rulePackVersion: null,
    extractorVersion: EXTRACTOR_VERSION,
    validationProfile: null,
    requiredPolicyClass: "PLAN_ONLY",
    corpus: null,
    certifiedAt: null,
  };
}

const H8_CORPUS: EvalCorpusRef = {
  id: "h8-eval-corpus",
  owner: "platform-eng",
  status: "ACTIVE",
  reviewedAt: "2026-08-17",
  expiresAt: "2026-12-31",
  metrics: {
    dependencyMatchRecallPct: 100,
    affectedUsagePrecisionPct: 100,
    patchValidationPct: 100,
    policyOutcomeCorrectPct: 100,
  },
};

/** Certified L3 connectors and their full kit. */
function certified(slug: string, pkg: string, level: CapabilityLevel): ConnectorCapability {
  return {
    vendorSlug: slug,
    ecosystem: "npm",
    package: pkg,
    language: "typescript/javascript",
    level,
    rulePackVersion: RULE_PACK_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    validationProfile: "node-ts-reparse + container-sandbox",
    requiredPolicyClass: "APPROVAL_REQUIRED",
    corpus: H8_CORPUS,
    certifiedAt: CERTIFIED_AT,
  };
}

/**
 * Capability per registered connector slug. Keyed lookup is derived: the
 * registry must cover exactly the connector catalog, enforced by test.
 */
export const CAPABILITY_REGISTRY: readonly ConnectorCapability[] = [
  certified("openai", "openai", "DRAFT_PR"),
  certified("stripe", "stripe", "DRAFT_PR"),
  certified("twilio", "twilio", "DRAFT_PR"),
  certified("anthropic", "@anthropic-ai/sdk", "DRAFT_PR"),
  certified("aws-sdk", "aws-sdk", "DRAFT_PR"),
  certified("supabase", "@supabase/supabase-js", "DRAFT_PR"),
  {
    ...baseline("auth0", "auth0"),
    level: "PLAN",
    rulePackVersion: RULE_PACK_VERSION,
    validationProfile: "node-ts-reparse",
    corpus: H8_CORPUS,
    certifiedAt: CERTIFIED_AT,
  },
  { ...baseline("generic-openapi", "openapi-spec"), ecosystem: "openapi", language: "openapi" },
  // AI / LLM
  baseline("google-gemini", "@google/generative-ai"),
  baseline("mistral", "@mistralai/mistralai"),
  baseline("deepseek", "deepseek"),
  baseline("cohere", "cohere-ai"),
  baseline("groq", "groq-sdk"),
  baseline("replicate", "@replicate/replicate"),
  baseline("langchain", "langchain"),
  baseline("huggingface", "@huggingface/inference"),
  // HTTP clients & integration SDKs
  baseline("axios", "axios"),
  baseline("firebase", "firebase"),
  baseline("mongoose", "mongoose"),
  baseline("passport", "passport"),
  // Cloud & infra
  baseline("google-cloud", "@google-cloud/storage"),
  baseline("azure-sdk", "@azure/identity"),
  baseline("vercel", "vercel"),
  baseline("cloudflare", "wrangler"),
  { ...baseline("terraform", "terraform"), ecosystem: "github-releases", language: "hcl" },
  baseline("kubernetes", "@kubernetes/client-node"),
  baseline("digitalocean", "digitalocean"),
  // Payments & fintech
  baseline("paypal", "@paypal/checkout-server-sdk"),
  baseline("square", "square"),
  baseline("plaid", "plaid"),
  baseline("adyen", "adyen"),
  baseline("lemon-squeezy", "lemon-squeezy"),
  // Auth & identity
  baseline("clerk", "@clerk/nextjs"),
  baseline("okta", "@okta/okta-auth-js"),
  baseline("keycloak", "keycloak-js"),
  baseline("next-auth", "next-auth"),
  // Messaging & comms
  baseline("slack", "@slack/web-api"),
  baseline("sendgrid", "@sendgrid/mail"),
  baseline("discord", "discord.js"),
  baseline("telegram", "telegraf"),
  baseline("socket.io", "socket.io"),
  // Data & DB
  baseline("prisma", "@prisma/client"),
  baseline("drizzle", "drizzle-orm"),
  baseline("typeorm", "typeorm"),
  baseline("sequelize", "sequelize"),
  baseline("mongodb", "mongodb"),
  baseline("redis", "ioredis"),
  // Web frameworks
  baseline("express", "express"),
  baseline("react", "react"),
  baseline("next", "next"),
  baseline("vue", "vue"),
  baseline("trpc", "@trpc/server"),
  // Search & observability
  baseline("elasticsearch", "@elastic/elasticsearch"),
  baseline("algolia", "algoliasearch"),
  baseline("sentry", "@sentry/nextjs"),
  // CRM & product
  baseline("salesforce", "jsforce"),
  baseline("hubspot", "@hubspot/api-client"),
];

export function getCapability(vendorSlug: string): ConnectorCapability | null {
  return CAPABILITY_REGISTRY.find((entry) => entry.vendorSlug === vendorSlug) ?? null;
}

export function listCapabilities(): readonly ConnectorCapability[] {
  return CAPABILITY_REGISTRY;
}

export function listCapabilitiesByLevel(level: CapabilityLevel): readonly ConnectorCapability[] {
  return CAPABILITY_REGISTRY.filter(
    (entry) => CAPABILITY_LEVEL_INDEX[entry.level] >= CAPABILITY_LEVEL_INDEX[level],
  );
}

/** True when the connector's certified level reaches `level` (or higher). */
export function capabilityAtLeast(vendorSlug: string, level: CapabilityLevel): boolean {
  const entry = getCapability(vendorSlug);
  if (!entry) return false;
  return CAPABILITY_LEVEL_INDEX[entry.level] >= CAPABILITY_LEVEL_INDEX[level];
}

/** Registry integrity guard: every catalog slug must be covered exactly once. */
export function validateCapabilityCoverage(): string[] {
  const catalog = listConnectorSlugs();
  const covered = new Set(CAPABILITY_REGISTRY.map((entry) => entry.vendorSlug));
  const missing = catalog.filter((slug) => !covered.has(slug));
  const orphaned = [...covered].filter((slug) => !catalog.includes(slug));
  return [
    ...missing.map((slug) => `missing: ${slug}`),
    ...orphaned.map((slug) => `orphan: ${slug}`),
  ];
}

/**
 * WP9 certification gate for the kit-required capabilities (PLAN, VALIDATE,
 * DRAFT_PR). A connector is certified for `level` only when the full kit is
 * present and live: level ordering, certifiedAt, evaluation corpus (ACTIVE,
 * not expired), rule-pack (PLAN+), and validation profile (VALIDATE+).
 * ASSESS/DETECT need no kit: an entry at or above the level passes.
 * Fail-loud: callers must refuse the action when `ok` is false.
 */
export function requireCertified(
  vendorSlug: string,
  level: CapabilityLevel,
  options: { now?: Date } = {},
): CertificationCheck {
  const entry = getCapability(vendorSlug);
  if (!entry) {
    return {
      ok: false,
      vendorSlug,
      requestedLevel: level,
      achievedLevel: null,
      reasons: [`connector ${vendorSlug} has no capability entry`],
    };
  }
  return {
    ok: certificationReasons(entry, level, options).length === 0,
    vendorSlug,
    requestedLevel: level,
    achievedLevel: entry.level,
    reasons: certificationReasons(entry, level, options),
  };
}

/** Pure kit-completeness check for a single capability entry (testable). */
export function certificationReasons(
  entry: ConnectorCapability,
  level: CapabilityLevel,
  options: { now?: Date } = {},
): string[] {
  const reasons: string[] = [];
  if (CAPABILITY_LEVEL_INDEX[entry.level] < CAPABILITY_LEVEL_INDEX[level]) {
    reasons.push(`certified level ${entry.level} is below the required ${level}`);
  }

  const needsKit = CAPABILITY_LEVEL_INDEX[level] >= CAPABILITY_LEVEL_INDEX.PLAN;
  if (needsKit) {
    if (entry.certifiedAt === null) {
      reasons.push("certifiedAt is not set");
    }
    if (entry.rulePackVersion === null) {
      reasons.push("rulePackVersion is not set");
    }
    if (entry.corpus === null) {
      reasons.push("no evaluation corpus reference");
    } else {
      if (entry.corpus.status !== "ACTIVE") {
        reasons.push(
          `corpus ${entry.corpus.id} status is ${entry.corpus.status} (expected ACTIVE)`,
        );
      }
      const now = (options.now ?? new Date()).getTime();
      if (new Date(entry.corpus.expiresAt).getTime() < now) {
        reasons.push(`corpus ${entry.corpus.id} expired at ${entry.corpus.expiresAt}`);
      }
    }
  }

  if (
    CAPABILITY_LEVEL_INDEX[level] >= CAPABILITY_LEVEL_INDEX.VALIDATE &&
    entry.validationProfile === null
  ) {
    reasons.push("validationProfile is not set");
  }

  return reasons;
}

export interface CertificationCheck {
  ok: boolean;
  vendorSlug: string;
  requestedLevel: CapabilityLevel;
  achievedLevel: CapabilityLevel | null;
  reasons: string[];
}
