/**
 * Demo seed for local development. Idempotent: safe to run repeatedly.
 * All demo data is labeled as such in the UI.
 *
 * Baseline includes organization, users, vendors, policies, repositories, completed scans,
 * usage inventory, a few historical change events, historical audit events, a 13-outcome
 * classified ledger staggered over 14 days plus healthy capability gates and one
 * SUSPENDED kill-switch demo so SLO cards and the circuit breaker are visible on
 * fresh tenants. Interactive remediations beyond those are produced by running
 * demo scenarios.
 */
import { createHash } from "node:crypto";
import { prisma } from "../src/client";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  RiskLevel,
  RiskTag,
  Severity,
  UsageType,
  VendorChangeSource,
} from "@patchbay/domain";
import type { Prisma } from "@prisma/client";

const ORG_ID = "org-acme";
const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@patchbay.dev";

async function main(): Promise<void> {
  console.log("[seed] starting");

  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: "Acme SaaS" },
    create: { id: ORG_ID, name: "Acme SaaS" },
  });
  console.log(`[seed] organization ${org.id}`);

  const admin = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: { name: "Demo Admin", role: "ADMIN", organizationId: ORG_ID },
    create: {
      id: "user-demo-admin",
      organizationId: ORG_ID,
      email: DEMO_USER_EMAIL,
      name: "Demo Admin",
      role: "ADMIN",
    },
  });
  await prisma.user.upsert({
    where: { email: "engineer@patchbay.dev" },
    update: { organizationId: ORG_ID },
    create: {
      id: "user-demo-engineer",
      organizationId: ORG_ID,
      email: "engineer@patchbay.dev",
      name: "Demo Engineer",
      role: "MEMBER",
    },
  });
  await prisma.user.upsert({
    where: { email: "viewer@patchbay.dev" },
    update: { organizationId: ORG_ID },
    create: {
      id: "user-demo-viewer",
      organizationId: ORG_ID,
      email: "viewer@patchbay.dev",
      name: "Demo Viewer",
      role: "VIEWER",
    },
  });
  console.log(`[seed] users (admin: ${admin.email})`);

  await seedVendors();
  await seedVendorEnrollments();
  await seedPolicies();
  await seedRepositories();
  await seedSubscription();
  await seedChangeEvents();
  await seedOutcomes();
  await seedAuditHistory(org.id);
  await seedTaskParameters();
  await seedValidationProfiles();
  await seedContractSources();
  await seedCases();

  console.log("[seed] done");
}

/**
 * Gives the demo org a PRO subscription so the seven seeded repositories fit
 * under the 10-repo cap (the FREE tier allows only 1). Idempotent; never
 * downgrades an existing subscription.
 */
async function seedSubscription(): Promise<void> {
  const existing = await prisma.subscription.findUnique({ where: { organizationId: ORG_ID } });
  if (existing) {
    console.log(`[seed] subscription already exists (${existing.planTier})`);
    return;
  }
  await prisma.subscription.create({
    data: {
      organizationId: ORG_ID,
      planTier: "PRO",
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  console.log("[seed] subscription (PRO)");
}

/**
 * Seeds the Watchtower daemon's initial task parameters: one PENDING npm
 * update task per launch product. The worker's update-task daemon picks
 * these up on start. Idempotent via the (taskId, type) unique key.
 */
async function seedTaskParameters(): Promise<void> {
  const products = [
    { taskId: "npm:openai@latest", packageName: "openai" },
    { taskId: "npm:stripe@latest", packageName: "stripe" },
    { taskId: "npm:twilio@latest", packageName: "twilio" },
  ];
  for (const product of products) {
    await prisma.taskParameter.upsert({
      where: {
        organizationId_taskId_type: {
          organizationId: ORG_ID,
          taskId: product.taskId,
          type: "PRODUCT_UPDATE",
        },
      },
      update: {
        domain: "NPM",
        status: "PENDING",
        inputJson: { packageName: product.packageName, organizationId: ORG_ID },
      },
      create: {
        organizationId: ORG_ID,
        taskId: product.taskId,
        type: "PRODUCT_UPDATE",
        domain: "NPM",
        status: "PENDING",
        inputJson: { packageName: product.packageName, organizationId: ORG_ID },
      },
    });
  }
  console.log(`[seed] task parameters (${products.length})`);
}

/**
 * Seeds the org-default validation execution profile (WP8): the legacy static
 * command set expressed as registry ids, pinned to the default image with
 * standard bounds. findFirst-then-create (not upsert) because the compound
 * key carries a NULL repositoryId. Idempotent.
 */
async function seedValidationProfiles(): Promise<void> {
  const existing = await prisma.validationProfile.findFirst({
    where: { organizationId: ORG_ID, repositoryId: null, name: "default" },
  });
  if (existing) {
    console.log(`[seed] validation profile already exists (${existing.id})`);
    return;
  }
  await prisma.validationProfile.create({
    data: {
      organizationId: ORG_ID,
      repositoryId: null,
      name: "default",
      commandIds: ["pnpm-install-frozen"],
      image: "node:20-slim",
      imageDigest: null,
      timeoutMs: 120_000,
      memoryLimit: "512m",
      networkPolicy: "none",
    },
  });
  console.log("[seed] validation profile (default)");
}

/**
 * Demo contract sources (WP13 staging): the org watches the OpenAI and
 * Stripe SDK feeds and the NPM registry channel. No credentials
 * (configEncrypted stays null); sync runs through the
 * normal poll pipeline. Idempotent via the (org, vendor, kind, name) key.
 */
async function seedContractSources(): Promise<void> {
  const sources = [
    { vendorSlug: "openai", kind: "SDK", name: "openai-node" },
    { vendorSlug: "stripe", kind: "SDK", name: "stripe-node" },
    { vendorSlug: "openai", kind: "REST", name: "npm-registry" },
  ];
  for (const source of sources) {
    await prisma.contractSource.upsert({
      where: {
        organizationId_vendorSlug_kind_name: {
          organizationId: ORG_ID,
          vendorSlug: source.vendorSlug,
          kind: source.kind,
          name: source.name,
        },
      },
      update: {},
      create: {
        organizationId: ORG_ID,
        vendorSlug: source.vendorSlug,
        kind: source.kind,
        name: source.name,
        status: "ACTIVE",
      },
    });
  }
  console.log(`[seed] contract sources (${sources.length})`);
}

/**
 * Representative cases across the lifecycle (WP13 staging): one per major
 * funnel stage, tied to seeded repos. Evidence-light rows (no assessments
 * attached) — the drills and demo scenarios produce full evidence live.
 * Idempotent via fixed ids.
 */
async function seedCases(): Promise<void> {
  const cases = [
    { id: "case-seed-observed", repo: "r-ai", status: "OBSERVED", reason: "dependency-match" },
    {
      id: "case-seed-impact",
      repo: "r-billing",
      status: "IMPACT_CONFIRMED",
      reason: "usage-evidence",
    },
    {
      id: "case-seed-planning",
      repo: "r-notification",
      status: "PLANNING",
      reason: "usage-evidence",
    },
    {
      id: "case-seed-approval",
      repo: "r-auth-gateway",
      status: "APPROVAL_REQUIRED",
      reason: "approved",
    },
    { id: "case-seed-delivered", repo: "r-claude", status: "DRAFT_PR_CREATED", reason: "approved" },
    { id: "case-seed-merged", repo: "r-supabase", status: "MERGED", reason: "approved" },
  ] as const;
  for (const seedCase of cases) {
    await prisma.remediationCase.upsert({
      where: { id: seedCase.id },
      update: {},
      create: {
        id: seedCase.id,
        organizationId: ORG_ID,
        scopeKey: `seed:${seedCase.id}`,
        status: seedCase.status as never,
        reasonCode: seedCase.reason,
        capabilityLevel: "DRAFT_PR",
        repositoryId: seedCase.repo,
        correlationId: `seed-${seedCase.id}`,
      },
    });
  }
  console.log(`[seed] cases (${cases.length} across lifecycle)`);
}

async function seedVendors(): Promise<void> {
  const vendors = [
    {
      id: "v-stripe",
      slug: "stripe",
      name: "Stripe",
      category: "Payments",
      docsUrl: "https://docs.stripe.com",
      enabled: true,
    },
    {
      id: "v-openai",
      slug: "openai",
      name: "OpenAI",
      category: "AI",
      docsUrl: "https://platform.openai.com/docs",
      enabled: true,
      // Shared catalog row: no org claim, no credential. The dev-only agent
      // key lives on org-acme's enrollment (see seedVendorEnrollments).
    },
    {
      id: "v-twilio",
      slug: "twilio",
      name: "Twilio",
      category: "Communications",
      docsUrl: "https://www.twilio.com/docs",
      enabled: true,
    },
    {
      id: "v-auth0",
      slug: "auth0",
      name: "Auth0",
      category: "Identity",
      docsUrl: "https://auth0.com/docs",
      enabled: true,
    },
    {
      id: "v-anthropic",
      slug: "anthropic",
      name: "Anthropic",
      category: "AI",
      docsUrl: "https://docs.anthropic.com",
      enabled: true,
    },
    {
      id: "v-aws-sdk",
      slug: "aws-sdk",
      name: "AWS SDK",
      category: "Cloud",
      docsUrl: "https://docs.aws.amazon.com/sdk-for-javascript",
      enabled: true,
    },
    {
      id: "v-supabase",
      slug: "supabase",
      name: "Supabase",
      category: "Backend",
      docsUrl: "https://supabase.com/docs",
      enabled: true,
    },
    {
      id: "v-vercel-ai-sdk",
      slug: "vercel-ai-sdk",
      name: "Vercel AI SDK",
      category: "AI",
      docsUrl: "https://sdk.vercel.ai/docs",
      enabled: true,
    },
    {
      id: "v-generic",
      slug: "generic-openapi",
      name: "Generic OpenAPI",
      category: "API Platform",
      docsUrl: null,
      enabled: true,
    },
  ] as const;
  for (const v of vendors) {
    await prisma.vendor.upsert({
      where: { id: v.id },
      update: v,
      create: v,
    });
  }
  console.log(`[seed] vendors (${vendors.length})`);
}

/**
 * Dev-only agent-key enrollment (P0-1). The shared `openai` catalog row stays
 * credential-free; org-acme's dev key (`pb_agent_dev_openai`, sha256-hashed
 * per the legacy window) lives on its enrollment row. Also repairs databases
 * seeded before the enrollment model existed (clears the legacy claim+hash).
 */
async function seedVendorEnrollments(): Promise<void> {
  await prisma.vendor.update({
    where: { id: "v-openai" },
    data: { organizationId: null, agentKeyHash: null, agentKeyHashPrevious: null },
  });
  await prisma.organizationVendorEnrollment.upsert({
    where: { organizationId_vendorId: { organizationId: ORG_ID, vendorId: "v-openai" } },
    update: {},
    create: {
      organizationId: ORG_ID,
      vendorId: "v-openai",
      agentKeyHash: createHash("sha256").update("pb_agent_dev_openai").digest("hex"),
      status: "ACTIVE",
    },
  });
  console.log("[seed] vendor enrollments (org-acme × openai)");
}

async function seedPolicies(): Promise<void> {
  const policies: Array<{
    id: string;
    name: string;
    enabled: boolean;
    definitionJson: Prisma.InputJsonValue;
  }> = [
    {
      id: "p-payment-approval",
      name: "Payment changes require approval",
      enabled: true,
      definitionJson: {
        description:
          "Any change touching payment risk paths requires explicit human approval before a pull request can be created.",
        rules: [
          {
            when: { riskTags: [RiskTag.PAYMENT] },
            then: "REQUIRE_APPROVAL",
            reason: "Payment execution paths are high risk",
          },
        ],
      },
    },
    {
      id: "p-auth-approval",
      name: "Auth changes require approval",
      enabled: true,
      definitionJson: {
        description:
          "Any change touching authentication or authorization (including Auth0) requires explicit human approval.",
        rules: [
          {
            when: { riskTags: [RiskTag.AUTH] },
            then: "REQUIRE_APPROVAL",
            reason: "Authentication/authorization is high risk",
          },
        ],
      },
    },
    {
      id: "p-webhook-approval",
      name: "Webhook verification changes require approval",
      enabled: true,
      definitionJson: {
        description:
          "Webhook handling and signature verification changes require explicit human approval.",
        rules: [
          {
            when: { riskTags: [RiskTag.WEBHOOK] },
            then: "REQUIRE_APPROVAL",
            reason: "Webhook verification failures can allow spoofed events",
          },
        ],
      },
    },
    {
      id: "p-generic-plan-only",
      name: "Generic OpenAPI changes are plan-only",
      enabled: true,
      definitionJson: {
        description:
          "Changes from the generic OpenAPI connector produce an impact mapping and remediation plan only; no patches are generated in the MVP.",
        rules: [
          {
            when: { vendor: "generic-openapi" },
            then: "ALLOW_PLAN_ONLY",
            reason: "No deterministic migration rules exist for generic providers",
          },
        ],
      },
    },
    {
      id: "p-failed-validation-denies",
      name: "Failed validation blocks PR creation",
      enabled: true,
      definitionJson: {
        description:
          "A remediation with any failed validation run can never produce a pull request.",
        rules: [
          {
            when: { validationStatus: "FAILED" },
            then: "DENY",
            reason: "Validation must pass before a PR can exist",
          },
        ],
      },
    },
    {
      id: "p-test-only-lower-risk",
      name: "Test-only changes are lower risk",
      enabled: true,
      definitionJson: {
        description: "Changes confined to test-only files are classified as lower risk.",
        rules: [
          {
            when: { riskTags: [RiskTag.TEST_ONLY] },
            then: "ALLOW_VALIDATE",
            reason: "Test-only impact does not reach production paths",
          },
        ],
      },
    },
  ];
  for (const p of policies) {
    await prisma.policy.upsert({
      where: { id: p.id },
      update: { name: p.name, enabled: p.enabled, definitionJson: p.definitionJson },
      create: { ...p, organizationId: ORG_ID },
    });
  }
  console.log(`[seed] policies (${policies.length})`);
}

async function seedRepositories(): Promise<void> {
  const repos = [
    {
      id: "r-billing",
      name: "billing-service",
      fullName: "acme/billing-service",
      vendor: "v-stripe",
      fixture: "stripe-node-legacy",
    },
    {
      id: "r-ai",
      name: "ai-assistant-service",
      fullName: "acme/ai-assistant-service",
      vendor: "v-openai",
      fixture: "openai-node-legacy",
    },
    {
      id: "r-notification",
      name: "notification-service",
      fullName: "acme/notification-service",
      vendor: "v-twilio",
      fixture: "twilio-node-legacy",
    },
    {
      id: "r-auth-gateway",
      name: "auth-gateway",
      fullName: "acme/auth-gateway",
      vendor: "v-auth0",
      fixture: "auth0-node-legacy",
    },
    {
      id: "r-claude",
      name: "claude-assistant-service",
      fullName: "acme/claude-assistant-service",
      vendor: "v-anthropic",
      fixture: "anthropic-node-legacy",
    },
    {
      id: "r-aws-workers",
      name: "aws-workers-service",
      fullName: "acme/aws-workers-service",
      vendor: "v-aws-sdk",
      fixture: "aws-sdk-node-legacy",
    },
    {
      id: "r-supabase",
      name: "supabase-backend-service",
      fullName: "acme/supabase-backend-service",
      vendor: "v-supabase",
      fixture: "supabase-js-legacy",
    },
    {
      id: "r-vercel",
      name: "ai-chat-service",
      fullName: "acme/ai-chat-service",
      vendor: "v-vercel-ai-sdk",
      fixture: "vercel-ai-sdk-legacy",
    },
  ] as const;

  for (const r of repos) {
    await prisma.repository.upsert({
      where: { id: r.id },
      update: {
        name: r.name,
        fullName: r.fullName,
        languageProfile: { typescript: true, packageManager: "pnpm", packageCount: 12 },
        metadata: { fixture: r.fixture, demo: true },
      },
      create: {
        id: r.id,
        organizationId: ORG_ID,
        provider: "LOCAL",
        externalId: `fixture:${r.fixture}`,
        name: r.name,
        fullName: r.fullName,
        defaultBranch: "main",
        languageProfile: { typescript: true, packageManager: "pnpm", packageCount: 12 },
        status: "ACTIVE",
        metadata: { fixture: r.fixture, demo: true },
      },
    });
    await seedScanAndUsages(r.id, r.name, r.fixture, r.vendor);
  }
  console.log(`[seed] repositories (${repos.length})`);
}

const USAGE_FIXTURES: Record<
  string,
  Array<{
    vendor: string;
    filePath: string;
    symbol: string;
    usageType: UsageType;
    line: number;
    column: number;
    excerpt: string;
    ownerHint: string;
    riskTags: RiskTag[];
  }>
> = {
  "stripe-node-legacy": [
    {
      vendor: "v-stripe",
      filePath: "src/payments/customers.ts",
      symbol: "stripe.customers.create",
      usageType: UsageType.METHOD_CALL,
      line: 24,
      column: 5,
      excerpt: `stripe.customers.create({ email: user.email });`,
      ownerHint: "payments-team",
      riskTags: [RiskTag.PAYMENT],
    },
    {
      vendor: "v-stripe",
      filePath: "src/lib/stripe-client.ts",
      symbol: "stripe",
      usageType: UsageType.INITIALIZATION,
      line: 9,
      column: 5,
      excerpt: `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);`,
      ownerHint: "payments-team",
      riskTags: [RiskTag.PAYMENT],
    },
    {
      vendor: "v-stripe",
      filePath: "src/payments/customers.ts",
      symbol: "stripe",
      usageType: UsageType.IMPORT,
      line: 1,
      column: 1,
      excerpt: `import Stripe from "stripe";`,
      ownerHint: "payments-team",
      riskTags: [RiskTag.PAYMENT],
    },
  ],
  "openai-node-legacy": [
    {
      vendor: "v-openai",
      filePath: "src/chat/chat-service.ts",
      symbol: "openai.createChatCompletion",
      usageType: UsageType.METHOD_CALL,
      line: 31,
      column: 5,
      excerpt: `const completion = openai.createChatCompletion({ model: "gpt-4", messages });`,
      ownerHint: "ml-team",
      riskTags: [],
    },
    {
      vendor: "v-openai",
      filePath: "src/lib/openai-client.ts",
      symbol: "openai",
      usageType: UsageType.INITIALIZATION,
      line: 8,
      column: 5,
      excerpt: `const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`,
      ownerHint: "ml-team",
      riskTags: [],
    },
    {
      vendor: "v-openai",
      filePath: "src/lib/openai-client.ts",
      symbol: "openai",
      usageType: UsageType.IMPORT,
      line: 1,
      column: 1,
      excerpt: `import OpenAI from "openai";`,
      ownerHint: "ml-team",
      riskTags: [],
    },
  ],
  "twilio-node-legacy": [
    {
      vendor: "v-twilio",
      filePath: "src/notifications/sms.ts",
      symbol: "client.messages.create",
      usageType: UsageType.METHOD_CALL,
      line: 18,
      column: 5,
      excerpt: `await client.messages.create({ body, to, from });`,
      ownerHint: "notifications-team",
      riskTags: [],
    },
    {
      vendor: "v-twilio",
      filePath: "src/lib/twilio-client.ts",
      symbol: "twilio",
      usageType: UsageType.INITIALIZATION,
      line: 7,
      column: 5,
      excerpt: `const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);`,
      ownerHint: "notifications-team",
      riskTags: [],
    },
    {
      vendor: "v-twilio",
      filePath: "src/lib/twilio-client.ts",
      symbol: "twilio",
      usageType: UsageType.IMPORT,
      line: 1,
      column: 1,
      excerpt: `import twilio from "twilio";`,
      ownerHint: "notifications-team",
      riskTags: [],
    },
  ],
  "auth0-node-legacy": [
    {
      vendor: "v-auth0",
      filePath: "src/middleware/authn.ts",
      symbol: "auth0.verifyJwt",
      usageType: UsageType.METHOD_CALL,
      line: 22,
      column: 5,
      excerpt: `await auth0.verifyJwt({ audience: process.env.AUTH0_AUDIENCE });`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.AUTH],
    },
    {
      vendor: "v-auth0",
      filePath: "src/middleware/authn.ts",
      symbol: "auth0",
      usageType: UsageType.IMPORT,
      line: 2,
      column: 1,
      excerpt: `import auth0 from "auth0";`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.AUTH],
    },
    {
      vendor: "v-auth0",
      filePath: "src/config/auth.ts",
      symbol: "AUTH0_DOMAIN",
      usageType: UsageType.ENVIRONMENT_REFERENCE,
      line: 4,
      column: 5,
      excerpt: `export const auth0Config = { domain: process.env.AUTH0_DOMAIN };`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.AUTH],
    },
  ],
  "anthropic-node-legacy": [
    {
      vendor: "v-anthropic",
      filePath: "src/chat/complete.ts",
      symbol: "anthropic.completions.create",
      usageType: UsageType.METHOD_CALL,
      line: 6,
      column: 5,
      excerpt: `const completion = await anthropic.completions.create({`,
      ownerHint: "ml-team",
      riskTags: [],
    },
    {
      vendor: "v-anthropic",
      filePath: "src/lib/anthropic-client.ts",
      symbol: "Anthropic",
      usageType: UsageType.IMPORT,
      line: 1,
      column: 1,
      excerpt: `import Anthropic from "@anthropic-ai/sdk";`,
      ownerHint: "ml-team",
      riskTags: [],
    },
  ],
  "aws-sdk-node-legacy": [
    {
      vendor: "v-aws-sdk",
      filePath: "src/aws-clients.ts",
      symbol: "AWS.S3",
      usageType: UsageType.INITIALIZATION,
      line: 7,
      column: 5,
      excerpt: `const s3 = new AWS.S3({ region: "us-east-1" });`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.INFRASTRUCTURE],
    },
    {
      vendor: "v-aws-sdk",
      filePath: "src/aws-clients.ts",
      symbol: "AWS.SQS",
      usageType: UsageType.INITIALIZATION,
      line: 8,
      column: 5,
      excerpt: `const sqs = new AWS.SQS({ region: "us-east-1" });`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.INFRASTRUCTURE],
    },
    {
      vendor: "v-aws-sdk",
      filePath: "src/aws-clients.ts",
      symbol: "AWS.DynamoDB",
      usageType: UsageType.INITIALIZATION,
      line: 9,
      column: 5,
      excerpt: `const dynamo = new AWS.DynamoDB({ region: "us-east-1" });`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.INFRASTRUCTURE],
    },
  ],
  "supabase-js-legacy": [
    {
      vendor: "v-supabase",
      filePath: "src/auth/session.ts",
      symbol: "supabase.auth.user",
      usageType: UsageType.METHOD_CALL,
      line: 12,
      column: 3,
      excerpt: `return supabase.auth.user();`,
      ownerHint: "platform-team",
      riskTags: [RiskTag.AUTH],
    },
  ],
  "vercel-ai-sdk-legacy": [
    {
      vendor: "v-vercel-ai-sdk",
      filePath: "src/app.ts",
      symbol: "useChat",
      usageType: UsageType.IMPORT,
      line: 2,
      column: 1,
      excerpt: `import { useChat } from "ai";`,
      ownerHint: "frontend-team",
      riskTags: [],
    },
  ],
};

async function seedScanAndUsages(
  repositoryId: string,
  _name: string,
  fixture: string,
  vendorId: string,
): Promise<void> {
  const usages = USAGE_FIXTURES[fixture] ?? [];
  const scan = await prisma.repositoryScan.upsert({
    where: { id: `s-${repositoryId}` },
    update: {
      commitSha: "demo-commit",
      status: "COMPLETED",
      summary: {
        usageCount: usages.length,
        filesScanned: 6,
        typescriptFiles: 6,
        durationMs: 350,
        demo: true,
      },
    },
    create: {
      id: `s-${repositoryId}`,
      organizationId: ORG_ID,
      repositoryId,
      commitSha: "demo-commit",
      status: "COMPLETED",
      startedAt: new Date("2026-07-20T09:00:00Z"),
      completedAt: new Date("2026-07-20T09:00:01Z"),
      summary: {
        usageCount: usages.length,
        filesScanned: 6,
        typescriptFiles: 6,
        durationMs: 350,
        demo: true,
      },
    },
  });

  for (const u of usages) {
    const excerpt = { text: u.excerpt, line: u.line, column: u.column };
    await prisma.integrationUsage.upsert({
      where: { id: `u-${repositoryId}-${u.symbol}-${u.usageType}-${u.line}` },
      update: {
        organizationId: ORG_ID,
        filePath: u.filePath,
        symbol: u.symbol,
        usageType: u.usageType,
        astLocation: { file: u.filePath, line: u.line, column: u.column },
        surroundingCodeHash: hashCode(excerpt.text),
        codeExcerpt: excerpt,
        ownerHint: u.ownerHint,
        riskTags: u.riskTags,
        metadata: { demo: true },
      },
      create: {
        id: `u-${repositoryId}-${u.symbol}-${u.usageType}-${u.line}`,
        organizationId: ORG_ID,
        repositoryId,
        scanId: scan.id,
        vendorId,
        filePath: u.filePath,
        symbol: u.symbol,
        usageType: u.usageType,
        astLocation: { file: u.filePath, line: u.line, column: u.column },
        surroundingCodeHash: hashCode(excerpt.text),
        codeExcerpt: excerpt,
        ownerHint: u.ownerHint,
        riskTags: u.riskTags,
        metadata: { demo: true },
      },
    });
  }
}

async function seedChangeEvents(): Promise<void> {
  const twilioEvent = await prisma.vendorChangeEvent.upsert({
    where: { id: "c-twilio-deprecation" },
    update: { organizationId: "org-acme" },
    create: {
      id: "c-twilio-deprecation",
      vendorId: "v-twilio",
      organizationId: "org-acme",
      externalReference: "twilio-changelog-2026-07-15",
      sourceType: VendorChangeSource.CHANGELOG,
      detectedAt: new Date("2026-07-15T10:00:00Z"),
      effectiveAt: new Date("2026-10-01T00:00:00Z"),
      title: "Twilio: messages.create mediaUrl parameter deprecated",
      sourceUrl: "https://www.twilio.com/changelog/demo",
      severity: Severity.MEDIUM,
      status: "TRIAGED",
      rawPayload: { vendor: "twilio", product: "messaging", note: "demo data" },
    },
  });
  await prisma.normalizedChange.upsert({
    where: { id: "n-twilio-1" },
    update: {},
    create: {
      id: "n-twilio-1",
      changeEventId: twilioEvent.id,
      changeType: "PARAMETER_REMOVED",
      oldValue: "mediaUrl",
      description: "The mediaUrl parameter is deprecated in favor of contentSid.",
      breaking: false,
      evidence: { source: "changelog", fixture: true },
    },
  });

  await prisma.vendorChangeEvent.upsert({
    where: { id: "c-openapi-generic" },
    update: { organizationId: "org-acme" },
    create: {
      id: "c-openapi-generic",
      vendorId: "v-generic",
      organizationId: "org-acme",
      externalReference: "openapi-diff-2026-07-18",
      sourceType: VendorChangeSource.OPENAPI_DIFF,
      detectedAt: new Date("2026-07-18T12:00:00Z"),
      title: "Example API: response field user.billing_address removed",
      severity: Severity.MEDIUM,
      status: "DETECTED",
      rawPayload: {
        diff: { removedProperties: ["user.billing_address"], endpointsRemoved: [] },
        demo: true,
      },
    },
  });
  await prisma.normalizedChange.upsert({
    where: { id: "n-openapi-1" },
    update: {},
    create: {
      id: "n-openapi-1",
      changeEventId: "c-openapi-generic",
      changeType: "RESPONSE_FIELD_REMOVED",
      oldValue: "user.billing_address",
      description: "GET /users response no longer includes billing_address.",
      breaking: true,
      evidence: { diffKind: "response-field-removed", fixture: true },
    },
  });

  await prisma.vendorChangeEvent.upsert({
    where: { id: "c-stripe-ignored" },
    update: { organizationId: "org-acme" },
    create: {
      id: "c-stripe-ignored",
      vendorId: "v-stripe",
      organizationId: "org-acme",
      externalReference: "stripe-sdk-2026-07-02",
      sourceType: VendorChangeSource.SDK_RELEASE,
      detectedAt: new Date("2026-07-02T08:00:00Z"),
      title: "Stripe node SDK v17.5: internal rate-limit headers",
      severity: Severity.INFO,
      status: "IGNORED",
      rawPayload: { vendor: "stripe", release: "17.5.0", demo: true },
    },
  });

  await prisma.vendorChangeEvent.upsert({
    where: { id: "c-openai-feature-adoption" },
    update: { organizationId: "org-acme" },
    create: {
      id: "c-openai-feature-adoption",
      vendorId: "v-openai",
      organizationId: "org-acme",
      externalReference: "openai-structured-outputs-2026-07-10",
      sourceType: VendorChangeSource.SDK_RELEASE,
      detectedAt: new Date("2026-07-10T09:00:00Z"),
      title: "OpenAI launches structured outputs (JSON mode)",
      sourceUrl: "https://platform.openai.com/docs/guides/structured-outputs",
      severity: Severity.INFO,
      status: "DETECTED",
      rawPayload: {
        sdk: "openai",
        capabilities: [
          {
            symbol: "openai.createChatCompletion",
            feature: "Structured outputs (JSON mode)",
            searchText: 'model: "gpt-4"',
            insertText: ', response_format: { type: "json_object" }',
          },
        ],
        demo: true,
      },
    },
  });
  await prisma.normalizedChange.upsert({
    where: { id: "n-openai-feature-1" },
    update: {},
    create: {
      id: "n-openai-feature-1",
      changeEventId: "c-openai-feature-adoption",
      changeType: "NEW_CAPABILITY",
      description:
        "OpenAI launched Structured outputs (JSON mode); adopting it is optional and non-breaking.",
      breaking: false,
      evidence: {
        rule: "feature-adoption",
        feature: "Structured outputs (JSON mode)",
        fixture: true,
      },
    },
  });

  // Outcome-ledger change events: vendor-linked releases whose seeded PRs
  // populate the /outcomes SLO cards (vendor column resolves via vendorId).
  const ledgerEvents = [
    {
      id: "c-anthropic-upgrade",
      vendorId: "v-anthropic",
      externalReference: "anthropic-sdk-2026-08-02",
      title: "Anthropic SDK 0.20: completions.create response envelope",
      severity: Severity.MEDIUM,
      normalizationId: "n-anthropic-1",
      changeType: "RESPONSE_FIELD_TYPE_CHANGED" as const,
      oldValue: "completion",
      description: "completions.create response envelope narrowed; call sites updated.",
    },
    {
      id: "c-supabase-upgrade",
      vendorId: "v-supabase",
      externalReference: "supabase-js-2026-08-09",
      title: "Supabase JS 1.35: auth.user() session helper",
      severity: Severity.MEDIUM,
      normalizationId: "n-supabase-1",
      changeType: "METHOD_RENAMED" as const,
      oldValue: "supabase.auth.user",
      description: "auth.user() renamed; session helper call sites updated.",
    },
    {
      id: "c-vercel-upgrade",
      vendorId: "v-vercel-ai-sdk",
      externalReference: "vercel-ai-sdk-2026-08-16",
      title: "Vercel AI SDK 3.0: useChat options shape",
      severity: Severity.MEDIUM,
      normalizationId: "n-vercel-1",
      changeType: "PARAMETER_RENAMED" as const,
      oldValue: "api",
      description: "useChat options renamed; chat hook call sites updated.",
    },
  ] as const;
  for (const event of ledgerEvents) {
    await prisma.vendorChangeEvent.upsert({
      where: { id: event.id },
      update: { organizationId: "org-acme" },
      create: {
        id: event.id,
        vendorId: event.vendorId,
        organizationId: "org-acme",
        externalReference: event.externalReference,
        sourceType: VendorChangeSource.SDK_RELEASE,
        detectedAt: new Date("2026-08-01T09:00:00Z"),
        title: event.title,
        severity: event.severity,
        status: "TRIAGED",
        rawPayload: { demo: true },
      },
    });
    await prisma.normalizedChange.upsert({
      where: { id: event.normalizationId },
      update: {},
      create: {
        id: event.normalizationId,
        changeEventId: event.id,
        changeType: event.changeType,
        oldValue: event.oldValue,
        description: event.description,
        breaking: true,
        evidence: { fixture: true },
      },
    });
  }

  console.log("[seed] change events (historical, no active remediations)");
}

/**
 * Seeds a 13-outcome classified ledger (12 MERGED + 1 CLOSED ≈ 92% merge
 * rate) staggered over the last 14 days plus healthy capability gates and one
 * SUSPENDED kill-switch demo, so fresh tenants see working SLO cards, a
 * feedback-queue example, and the circuit breaker in action instead of empty
 * states. Idempotent via fixed ids (create-only fields like createdAt never
 * move on re-runs); demo-only (labeled in the UI as seeded data).
 */
async function seedOutcomes(): Promise<void> {
  const chains = [
    {
      impactId: "seed-ia-stripe",
      planId: "seed-plan-stripe",
      prId: "seed-pr-stripe",
      outcomeId: "seed-outcome-stripe",
      changeEventId: "c-stripe-ignored",
      repositoryId: "r-billing",
      score: 68,
      riskLevel: RiskLevel.HIGH,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      note: "Stripe metadata patch merged without edits.",
      branch: "patchbay/seed-stripe-metadata",
    },
    {
      impactId: "seed-ia-openai",
      planId: "seed-plan-openai",
      prId: "seed-pr-openai",
      outcomeId: "seed-outcome-openai",
      changeEventId: "c-openai-feature-adoption",
      repositoryId: "r-ai",
      score: 45,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "MANUAL_EDITS" as const,
      note: "Merged after the reviewer adjusted response_format handling.",
      branch: "patchbay/seed-openai-structured-outputs",
    },
    {
      impactId: "seed-ia-twilio",
      planId: "seed-plan-twilio",
      prId: "seed-pr-twilio",
      outcomeId: "seed-outcome-twilio",
      changeEventId: "c-twilio-deprecation",
      repositoryId: "r-notification",
      score: 55,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "CLOSED" as const,
      classification: "WRONG_PATCH" as const,
      note: "Closed: patch targeted the wrong contentSid overload.",
      branch: "patchbay/seed-twilio-content-sid",
    },
  ] as const;

  // Historical ledger: additional plans/PRs/outcomes under the same impacts
  // (openai/stripe/twilio) plus new vendor impacts, staggered by daysAgo so
  // the 30-day SLO window and the ledger read as two weeks of production.
  // daysAgo is create-only: re-runs never shift history.
  const historyChains = [
    {
      impactId: "seed-ia-stripe",
      planId: "seed-plan-stripe-2",
      prId: "seed-pr-stripe-2",
      outcomeId: "seed-outcome-stripe-2",
      score: 74,
      riskLevel: RiskLevel.HIGH,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Stripe PaymentIntents migration merged; quorum 2/2 verified.",
      branch: "patchbay/seed-stripe-payment-intents",
      daysAgo: 3,
    },
    {
      impactId: "seed-ia-stripe",
      planId: "seed-plan-stripe-3",
      prId: "seed-pr-stripe-3",
      outcomeId: "seed-outcome-stripe-3",
      score: 61,
      riskLevel: RiskLevel.HIGH,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Stripe webhook handler patch merged without edits.",
      branch: "patchbay/seed-stripe-webhooks",
      daysAgo: 7,
    },
    {
      impactId: "seed-ia-openai",
      planId: "seed-plan-openai-2",
      prId: "seed-pr-openai-2",
      outcomeId: "seed-outcome-openai-2",
      score: 52,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "OpenAI v4 chat completions migration merged.",
      branch: "patchbay/seed-openai-v4-chat",
      daysAgo: 4,
    },
    {
      impactId: "seed-ia-openai",
      planId: "seed-plan-openai-3",
      prId: "seed-pr-openai-3",
      outcomeId: "seed-outcome-openai-3",
      score: 48,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "OpenAI embeddings migration merged.",
      branch: "patchbay/seed-openai-embeddings",
      daysAgo: 8,
    },
    {
      impactId: "seed-ia-twilio",
      planId: "seed-plan-twilio-2",
      prId: "seed-pr-twilio-2",
      outcomeId: "seed-outcome-twilio-2",
      score: 58,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Twilio messaging migration merged.",
      branch: "patchbay/seed-twilio-messaging",
      daysAgo: 5,
    },
    {
      impactId: "seed-ia-anthropic",
      planId: "seed-plan-anthropic-1",
      prId: "seed-pr-anthropic-1",
      outcomeId: "seed-outcome-anthropic-1",
      changeEventId: "c-anthropic-upgrade",
      repositoryId: "r-claude",
      score: 57,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Anthropic completions migration merged.",
      branch: "patchbay/seed-anthropic-completions",
      daysAgo: 2,
    },
    {
      impactId: "seed-ia-anthropic",
      planId: "seed-plan-anthropic-2",
      prId: "seed-pr-anthropic-2",
      outcomeId: "seed-outcome-anthropic-2",
      changeEventId: "c-anthropic-upgrade",
      repositoryId: "r-claude",
      score: 49,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "MANUAL_EDITS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Merged after the reviewer adjusted the response envelope.",
      branch: "patchbay/seed-anthropic-envelope",
      daysAgo: 9,
    },
    {
      impactId: "seed-ia-supabase",
      planId: "seed-plan-supabase-1",
      prId: "seed-pr-supabase-1",
      outcomeId: "seed-outcome-supabase-1",
      changeEventId: "c-supabase-upgrade",
      repositoryId: "r-supabase",
      score: 53,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Supabase auth helper migration merged.",
      branch: "patchbay/seed-supabase-auth",
      daysAgo: 6,
    },
    {
      impactId: "seed-ia-vercel",
      planId: "seed-plan-vercel-1",
      prId: "seed-pr-vercel-1",
      outcomeId: "seed-outcome-vercel-1",
      changeEventId: "c-vercel-upgrade",
      repositoryId: "r-vercel",
      score: 44,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "UNCLASSIFIED" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Vercel AI SDK migration merged; awaiting human verdict.",
      branch: "patchbay/seed-vercel-use-chat",
      daysAgo: 10,
    },
    {
      impactId: "seed-ia-generic",
      planId: "seed-plan-generic-1",
      prId: "seed-pr-generic-1",
      outcomeId: "seed-outcome-generic-1",
      changeEventId: "c-openapi-generic",
      repositoryId: "r-supabase",
      score: 41,
      riskLevel: RiskLevel.MEDIUM,
      prStatus: "MERGED" as const,
      classification: "SUCCESS" as const,
      source: "GITHUB_WEBHOOK" as const,
      note: "Internal API response-field migration merged.",
      branch: "patchbay/seed-generic-billing-address",
      daysAgo: 12,
    },
  ] as const;

  // New vendor impacts for the historical ledger (existing three impacts are
  // created by the chains loop below via their own changeEventId/repositoryId).
  const newImpacts = [
    {
      id: "seed-ia-anthropic",
      changeEventId: "c-anthropic-upgrade",
      repositoryId: "r-claude",
      score: 57,
      riskLevel: RiskLevel.MEDIUM,
    },
    {
      id: "seed-ia-supabase",
      changeEventId: "c-supabase-upgrade",
      repositoryId: "r-supabase",
      score: 53,
      riskLevel: RiskLevel.MEDIUM,
    },
    {
      id: "seed-ia-vercel",
      changeEventId: "c-vercel-upgrade",
      repositoryId: "r-vercel",
      score: 44,
      riskLevel: RiskLevel.MEDIUM,
    },
    {
      id: "seed-ia-generic",
      changeEventId: "c-openapi-generic",
      repositoryId: "r-supabase",
      score: 41,
      riskLevel: RiskLevel.MEDIUM,
    },
  ] as const;
  for (const impact of newImpacts) {
    await prisma.impactAssessment.upsert({
      where: {
        changeEventId_repositoryId: {
          changeEventId: impact.changeEventId,
          repositoryId: impact.repositoryId,
        },
      },
      update: {},
      create: {
        id: impact.id,
        organizationId: ORG_ID,
        changeEventId: impact.changeEventId,
        repositoryId: impact.repositoryId,
        score: impact.score,
        confidence: 92,
        affectedUsageCount: 2,
        riskLevel: impact.riskLevel,
        rationale: `Seeded demo assessment for ${impact.repositoryId}.`,
        status: "AFFECTED",
      },
    });
  }

  for (const chain of chains) {
    const impact = await prisma.impactAssessment.upsert({
      where: {
        changeEventId_repositoryId: {
          changeEventId: chain.changeEventId,
          repositoryId: chain.repositoryId,
        },
      },
      update: {},
      create: {
        id: chain.impactId,
        organizationId: ORG_ID,
        changeEventId: chain.changeEventId,
        repositoryId: chain.repositoryId,
        score: chain.score,
        confidence: 92,
        affectedUsageCount: 2,
        riskLevel: chain.riskLevel,
        rationale: `Seeded demo assessment for ${chain.repositoryId}.`,
        status: "AFFECTED",
      },
    });
    await seedOutcomeChain({
      planId: chain.planId,
      prId: chain.prId,
      outcomeId: chain.outcomeId,
      impactId: impact.id,
      prStatus: chain.prStatus,
      classification: chain.classification,
      source: "SYSTEM",
      note: chain.note,
      branch: chain.branch,
      daysAgo: null,
    });
  }

  for (const chain of historyChains) {
    await seedOutcomeChain({
      planId: chain.planId,
      prId: chain.prId,
      outcomeId: chain.outcomeId,
      impactId: chain.impactId,
      prStatus: chain.prStatus,
      classification: chain.classification,
      source: chain.source,
      note: chain.note,
      branch: chain.branch,
      daysAgo: chain.daysAgo,
    });
  }

  const gates = [
    {
      vendorSlug: "openai",
      status: "ACTIVE" as const,
      reason: "Seeded healthy gate for demo SLOs.",
    },
    {
      vendorSlug: "stripe",
      status: "ACTIVE" as const,
      reason: "Seeded healthy gate for demo SLOs.",
    },
    {
      vendorSlug: "twilio",
      status: "ACTIVE" as const,
      reason: "Seeded healthy gate for demo SLOs.",
    },
    {
      vendorSlug: "anthropic",
      status: "ACTIVE" as const,
      reason: "Seeded healthy gate for demo SLOs.",
    },
    {
      vendorSlug: "supabase",
      status: "ACTIVE" as const,
      reason: "Seeded healthy gate for demo SLOs.",
    },
    {
      vendorSlug: "vercel-ai-sdk",
      status: "ACTIVE" as const,
      reason: "Seeded healthy gate for demo SLOs.",
    },
    {
      vendorSlug: "legacy-custom-crm",
      status: "SUSPENDED" as const,
      reason:
        "Auto-suspended by SLO monitor: merge rate 33% (1/3) fell below the 50% threshold. Requires admin re-certification.",
    },
  ];
  for (const gate of gates) {
    await prisma.capabilityGate.upsert({
      where: {
        organizationId_vendorSlug_level: {
          organizationId: ORG_ID,
          vendorSlug: gate.vendorSlug,
          level: "DRAFT_PR",
        },
      },
      update: {},
      create: {
        organizationId: ORG_ID,
        vendorSlug: gate.vendorSlug,
        level: "DRAFT_PR",
        status: gate.status,
        reason: gate.reason,
        ...(gate.status === "SUSPENDED"
          ? { suspendedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          : {}),
      },
    });
  }

  console.log("[seed] outcomes (13 classified) + capability gates (6 ACTIVE, 1 SUSPENDED)");
}

/**
 * One plan → PR → outcome triple. daysAgo staggers createdAt over the last 14
 * days and is create-only, so re-runs never shift history. Idempotent via the
 * fixed plan/PR/outcome ids.
 */
async function seedOutcomeChain(chain: {
  planId: string;
  prId: string;
  outcomeId: string;
  impactId: string;
  prStatus: "MERGED" | "CLOSED";
  classification: "SUCCESS" | "MANUAL_EDITS" | "WRONG_PATCH" | "UNCLASSIFIED";
  source: "SYSTEM" | "GITHUB_WEBHOOK";
  note: string;
  branch: string;
  daysAgo: number | null;
}): Promise<void> {
  const createdAt =
    chain.daysAgo === null ? undefined : new Date(Date.now() - chain.daysAgo * 86_400_000);
  const plan = await prisma.remediationPlan.upsert({
    where: { id: chain.planId },
    update: {},
    create: {
      id: chain.planId,
      organizationId: ORG_ID,
      impactAssessmentId: chain.impactId,
      status: "VALIDATED",
      strategy: "Seeded rule-based demo plan.",
      confidence: 90,
      requiresHumanReview: false,
      ...(createdAt ? { createdAt } : {}),
    },
  });
  const pullRequest = await prisma.pullRequest.upsert({
    where: { remediationPlanId: plan.id },
    update: { status: chain.prStatus },
    create: {
      id: chain.prId,
      organizationId: ORG_ID,
      remediationPlanId: plan.id,
      provider: "LOCAL",
      url: `https://example.com/demo/${chain.branch}`,
      branchName: chain.branch,
      status: chain.prStatus,
      ...(createdAt ? { createdAt } : {}),
    },
  });
  await prisma.prOutcome.upsert({
    where: { pullRequestId: pullRequest.id },
    update: {
      status: chain.prStatus,
      classification: chain.classification,
      note: chain.note,
    },
    create: {
      id: chain.outcomeId,
      organizationId: ORG_ID,
      pullRequestId: pullRequest.id,
      status: chain.prStatus,
      classification: chain.classification,
      source: chain.source,
      note: chain.note,
      rulePackVersion: "seed-rulepack-1",
      extractorVersion: "graph-1",
      recordedBy: "seed",
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

async function seedAuditHistory(orgId: string): Promise<void> {
  const events: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorType: string;
    actorId: string | null;
    createdAt: Date;
    before?: unknown;
    after: unknown;
    metadata?: Record<string, unknown>;
  }> = [
    {
      id: "a-1",
      action: AuditAction.ORGANIZATION_CREATED,
      entityType: "organization",
      entityId: ORG_ID,
      actorType: ActorType.SYSTEM,
      actorId: null,
      createdAt: new Date("2026-07-01T08:00:00Z"),
      after: { name: "Acme SaaS" },
    },
    {
      id: "a-2",
      action: AuditAction.USER_LOGIN,
      entityType: "user",
      entityId: "user-demo-admin",
      actorType: ActorType.USER,
      actorId: "user-demo-admin",
      createdAt: new Date("2026-07-01T08:05:00Z"),
      after: { email: DEMO_USER_EMAIL },
    },
    {
      id: "a-3",
      action: AuditAction.REPOSITORY_REGISTERED,
      entityType: "repository",
      entityId: "r-billing",
      actorType: ActorType.USER,
      actorId: "user-demo-admin",
      createdAt: new Date("2026-07-05T09:00:00Z"),
      after: { name: "billing-service", provider: "LOCAL", demo: true },
    },
    {
      id: "a-4",
      action: AuditAction.REPOSITORY_REGISTERED,
      entityType: "repository",
      entityId: "r-ai",
      actorType: ActorType.USER,
      actorId: "user-demo-admin",
      createdAt: new Date("2026-07-05T09:01:00Z"),
      after: { name: "ai-assistant-service", provider: "LOCAL", demo: true },
    },
    {
      id: "a-5",
      action: AuditAction.REPOSITORY_REGISTERED,
      entityType: "repository",
      entityId: "r-notification",
      actorType: ActorType.USER,
      actorId: "user-demo-admin",
      createdAt: new Date("2026-07-05T09:02:00Z"),
      after: { name: "notification-service", provider: "LOCAL", demo: true },
    },
    {
      id: "a-6",
      action: AuditAction.REPOSITORY_REGISTERED,
      entityType: "repository",
      entityId: "r-auth-gateway",
      actorType: ActorType.USER,
      actorId: "user-demo-admin",
      createdAt: new Date("2026-07-05T09:03:00Z"),
      after: { name: "auth-gateway", provider: "LOCAL", demo: true },
    },
    {
      id: "a-7",
      action: AuditAction.SCAN_COMPLETED,
      entityType: "repositoryScan",
      entityId: "s-r-billing",
      actorType: ActorType.SYSTEM,
      actorId: null,
      createdAt: new Date("2026-07-20T09:00:02Z"),
      after: { repository: "billing-service", usageCount: 3, demo: true },
    },
    {
      id: "a-8",
      action: AuditAction.SCAN_COMPLETED,
      entityType: "repositoryScan",
      entityId: "s-r-ai",
      actorType: ActorType.SYSTEM,
      actorId: null,
      createdAt: new Date("2026-07-20T09:00:03Z"),
      after: { repository: "ai-assistant-service", usageCount: 3, demo: true },
    },
    {
      id: "a-9",
      action: AuditAction.POLICY_UPDATED,
      entityType: "policy",
      entityId: "p-generic-plan-only",
      actorType: ActorType.USER,
      actorId: "user-demo-admin",
      createdAt: new Date("2026-07-25T11:00:00Z"),
      before: { enabled: false },
      after: { enabled: true },
      metadata: { note: "demo data" },
    },
    {
      id: "a-10",
      action: AuditAction.CHANGE_DETECTED,
      entityType: "vendorChangeEvent",
      entityId: "c-twilio-deprecation",
      actorType: ActorType.SYSTEM,
      actorId: null,
      createdAt: new Date("2026-07-15T10:00:01Z"),
      after: { title: "Twilio: messages.create mediaUrl parameter deprecated", demo: true },
    },
  ];

  for (const e of events) {
    const existing = await prisma.auditEvent.findUnique({ where: { id: e.id } });
    if (existing) continue;
    await prisma.auditEvent.create({
      data: {
        id: e.id,
        organizationId: orgId,
        actorType: e.actorType as "USER" | "SYSTEM" | "AGENT",
        actorId: e.actorId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        correlationId: `seed-${e.id}`,
        beforeJson: e.before === undefined ? undefined : (e.before as Prisma.InputJsonValue),
        afterJson: e.after as Prisma.InputJsonValue,
        metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
        createdAt: e.createdAt,
      },
    });
  }
  console.log(`[seed] audit history (${events.length})`);
}

function hashCode(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

main()
  .catch((error) => {
    console.error("[seed] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
