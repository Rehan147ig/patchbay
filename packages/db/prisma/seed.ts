/**
 * Demo seed for local development. Idempotent: safe to run repeatedly.
 * All demo data is labeled as such in the UI.
 *
 * Baseline includes organization, users, vendors, policies, repositories, completed scans,
 * usage inventory, a few historical change events, and historical audit events.
 * It intentionally creates NO remediations - those are produced by running demo scenarios.
 */
import { createHash } from "node:crypto";
import { prisma } from "../src/client";
import { AuditAction } from "@patchbay/audit";
import { ActorType, RiskTag, Severity, UsageType, VendorChangeSource } from "@patchbay/domain";
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
  await seedPolicies();
  await seedRepositories();
  await seedChangeEvents();
  await seedAuditHistory(org.id);

  console.log("[seed] done");
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
      /** Dev-only agent key: pb_agent_dev_openai (hashed, per agent-key policy). */
      agentKeyHash: createHash("sha256").update("pb_agent_dev_openai").digest("hex"),
      organizationId: "org-acme",
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

  console.log("[seed] change events (historical, no active remediations)");
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
