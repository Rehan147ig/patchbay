import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, readRawEvidence } from "@patchbay/db";
import {
  buildEvidenceBlock,
  createDeliveryKey,
  parseEvidenceBlock,
  type DeliveryEvidencePayload,
} from "@patchbay/domain";
import { evaluatePolicy } from "@patchbay/policy-engine";
import { setCapabilityGate } from "@patchbay/operations";
import { assertWorkerCapabilityGateOpen } from "./capability-gates";
import { ingestContractSnapshot } from "./contract-pipeline";
import { recordValidationArtifact } from "./validation-profiles";
import { claimDeliveryAttempt, completeDeliveryAttempt } from "./delivery-attempts";

/**
 * WP13 operational drills (§13.4, §14.5) against a REAL database.
 *
 * What runs for real: contract ingest (hash→dedupe→store→snapshot→change),
 * validation artifact attestation (object store + descriptor hash),
 * policy evaluation, the delivery ledger, the §7.4 evidence round-trip,
 * webhook dedup constraints, and the capability kill switch — all on live
 * Postgres with a temp evidence dir. Skipped automatically when no database
 * is reachable.
 *
 * Explicitly OUTSIDE these drills (documented, not hidden): the GitHub REST
 * calls (provider unit tests cover them with recorded HTTP shapes) and
 * container execution (sandbox-runner Docker integration tests). The ledger
 * duplicate path — the zero-second-delivery guarantee — IS exercised here.
 */

const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

const suffix = randomUUID().slice(0, 8);
const ORG = `org-drill-${suffix}`;
const VENDOR_SLUG = `drill-vendor-${suffix}`;

let evidenceDir = "";
let previousEvidenceDir: string | undefined;

async function cleanup(): Promise<void> {
  // Break-glass for WORM-guarded audit rows (same pattern as worm-db.test.ts);
  // everything else cascades off the org. Webhook deliveries survive org
  // deletion (SetNull) and carry global unique keys, so they go first.
  await prisma.webhookDelivery.deleteMany({
    where: { deliveryId: { startsWith: "drill-delivery-" } },
  });
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_worm_trigger`,
  );
  try {
    await prisma.auditEvent.deleteMany({ where: { organizationId: ORG } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.vendor.deleteMany({ where: { slug: VENDOR_SLUG } });
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_worm_trigger`,
    );
  }
}

(reachable ? describe : describe.skip)("WP13 operational drills (real database)", () => {
  beforeAll(async () => {
    evidenceDir = mkdtempSync(path.join(tmpdir(), "patchbay-drill-evidence-"));
    previousEvidenceDir = process.env.EVIDENCE_STORE_DIR;
    process.env.EVIDENCE_STORE_DIR = evidenceDir;
    await cleanup();
    await prisma.organization.create({ data: { id: ORG, name: "drill org" } });
  });

  afterAll(async () => {
    await cleanup();
    if (previousEvidenceDir === undefined) delete process.env.EVIDENCE_STORE_DIR;
    else process.env.EVIDENCE_STORE_DIR = previousEvidenceDir;
    rmSync(evidenceDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("drill 1 — full loop: ingest → attest → policy → ledger → evidence block", async () => {
    // 0. Fixture graph: vendor, org source, repo.
    const vendor = await prisma.vendor.create({
      data: { slug: VENDOR_SLUG, name: "Drill Vendor", category: "sdk", organizationId: null },
    });
    const source = await prisma.contractSource.create({
      data: { organizationId: ORG, vendorSlug: VENDOR_SLUG, kind: "SDK", name: "drill-sdk" },
    });
    const repository = await prisma.repository.create({
      data: {
        organizationId: ORG,
        provider: "LOCAL",
        externalId: `fixture:drill-${suffix}`,
        name: "drill-service",
        fullName: `drill/drill-service-${suffix}`,
        languageProfile: {},
        metadata: {},
      },
    });

    // 1. Contract ingest v1 (no changes), then v2 with a normalized change.
    const rawV1 = JSON.stringify({ version: "1.0.0", methods: ["createChat"] });
    const first = await ingestContractSnapshot({
      sourceId: source.id,
      organizationId: ORG,
      rawText: rawV1,
      normalizedJson: { version: "1.0.0" },
      parserVersion: "drill-v1",
    });
    expect(first.deduplicated).toBe(false);
    const rawV2 = JSON.stringify({ version: "2.0.0", methods: ["chat"] });
    const second = await ingestContractSnapshot({
      sourceId: source.id,
      organizationId: ORG,
      rawText: rawV2,
      normalizedJson: { version: "2.0.0" },
      parserVersion: "drill-v1",
      changes: [
        {
          identity: "method-removed:createChat",
          changeType: "METHOD_REMOVED",
          severity: "HIGH",
          description: "createChat removed in 2.0.0",
          migrationHints: [],
        },
      ],
    });
    expect(second.deduplicated).toBe(false);
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]?.created).toBe(true);
    // Re-ingest converges: same bytes, no new rows.
    const replay = await ingestContractSnapshot({
      sourceId: source.id,
      organizationId: ORG,
      rawText: rawV2,
      normalizedJson: { version: "2.0.0" },
      parserVersion: "drill-v1",
    });
    expect(replay.deduplicated).toBe(true);
    expect(replay.snapshotId).toBe(second.snapshotId);

    // 2. Release-funnel rows: change → assessment → plan → patch → run.
    const changeEvent = await prisma.vendorChangeEvent.create({
      data: {
        vendorId: vendor.id,
        organizationId: ORG,
        sourceType: "SDK_RELEASE",
        title: "Drill SDK 2.0.0 removes createChat",
      },
    });
    const assessment = await prisma.impactAssessment.create({
      data: {
        organizationId: ORG,
        changeEventId: changeEvent.id,
        repositoryId: repository.id,
        score: 82,
        confidence: 90,
        riskLevel: "HIGH",
        rationale: "drill",
        status: "AFFECTED",
      },
    });
    const plan = await prisma.remediationPlan.create({
      data: {
        organizationId: ORG,
        impactAssessmentId: assessment.id,
        strategy: "deterministic-ast",
        confidence: 90,
      },
    });
    await prisma.patchArtifact.create({
      data: {
        organizationId: ORG,
        remediationPlanId: plan.id,
        filePath: "src/chat.ts",
        unifiedDiff: "@@ drill",
        originalContent: "createChat()",
        patchedContent: "chat()",
        originalHash: "0".repeat(64),
        patchedHash: "1".repeat(64),
        generationMethod: "RULE_BASED",
        confidence: 90,
      },
    });
    const run = await prisma.validationRun.create({
      data: {
        organizationId: ORG,
        remediationPlanId: plan.id,
        status: "PASSED",
        commands: ["pnpm install --frozen-lockfile"],
        exitCode: 0,
        completedAt: new Date(),
      },
    });

    // 3. Attest the terminal run (real object store + descriptor hash).
    const { artifactId, artifactHash } = await recordValidationArtifact({
      validationRunId: run.id,
      organizationId: ORG,
      validationProfileId: null,
      commandsExecuted: ["pnpm install --frozen-lockfile"],
      exitCodes: [0],
      image: "node:20-slim",
      imageDigest: "sha256:drill",
      fullStdout: "$ pnpm install --frozen-lockfile\ndone in 12s",
      fullStderr: "",
    });
    expect(artifactHash).toMatch(/^[0-9a-f]{64}$/);
    const artifact = await prisma.validationArtifact.findUnique({ where: { id: artifactId } });
    expect(artifact?.stdoutUri).toBeTruthy();
    expect(artifact?.stderrUri).toBeNull();
    // The attested log round-trips through content addressing.
    await expect(readRawEvidence(artifact!.stdoutUri!)).resolves.toContain("done in 12s");

    // 4. Policy evaluation on the plan's real inputs allows delivery.
    const policyResult = evaluatePolicy({
      confidence: 90,
      patchCount: 1,
      requiresHumanReview: false,
      hasPassingValidation: true,
      approvalDecision: null,
      riskTags: [],
    });
    expect(policyResult.canCreatePR).toBe(true);

    // 5. Delivery ledger: first writer wins with a stable key.
    const key = createDeliveryKey("CREATE", `drill-${suffix}`);
    const claim = await claimDeliveryAttempt({
      organizationId: ORG,
      remediationPlanId: plan.id,
      idempotencyKey: key,
      action: "CREATE",
    });
    expect(claim.duplicate).toBe(false);
    if (claim.duplicate) throw new Error("unreachable");
    await completeDeliveryAttempt(claim.attemptId, {
      status: "SUCCEEDED",
      externalId: "4242",
      url: "https://github.com/drill/drill-service/pull/4242",
    });

    // 6. §7.4 evidence block carries the REAL artifact hash and parses back.
    const payload: DeliveryEvidencePayload = {
      version: 1,
      caseId: null,
      remediationPlanId: plan.id,
      caseVersion: 1,
      policyDecision: policyResult.decision,
      policyReasons: policyResult.reasons,
      validationStatus: "PASSED",
      validationRunId: run.id,
      validationArtifactHash: artifactHash,
      commandsExecuted: ["pnpm install --frozen-lockfile"],
      imageDigest: "sha256:drill",
      riskTags: [],
      affectedUsageCount: 1,
      patchCount: 1,
      approvalDecision: null,
      agentVerdict: null,
      correlationId: `drill-${suffix}`,
      createdAt: new Date().toISOString(),
    };
    const body = buildEvidenceBlock(payload, {
      repositoryName: repository.name,
      branchName: "patchbay/drill",
      baseBranch: "main",
      caseVersion: 1,
      policyDecision: policyResult.decision,
      policyReasons: policyResult.reasons,
      validationStatus: "PASSED",
      validationArtifactHash: artifactHash,
      approvalDecision: null,
      riskTags: [],
      affectedUsageCount: 1,
      patchCount: 1,
    });
    expect(body).toContain("<!-- patchbay:evidence");
    expect(body).toContain("### Rollback");
    const parsed = parseEvidenceBlock(body);
    expect(parsed?.validationArtifactHash).toBe(artifactHash);
    expect(parsed?.remediationPlanId).toBe(plan.id);
  });

  it("drill 2 — duplicate invariance: 3 identical webhooks, 1 row; retry converges", async () => {
    const deliveryId = `drill-delivery-${suffix}`;
    const payloadHash = `${suffix}-payload`.padEnd(64, "0").slice(0, 64);
    let created = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await prisma.webhookDelivery.create({
          data: {
            deliveryId,
            event: "pull_request",
            payloadHash,
            organizationId: ORG,
          },
        });
        created += 1;
      } catch (error) {
        // Insert-conflict dedup (not a racy find-first): replays converge.
        expect((error as { code?: unknown }).code).toBe("P2002");
      }
    }
    expect(created).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId } })).toBe(1);

    // Ledger retry of a delivered key returns the winner — no second delivery.
    // (Needs a real plan row: DeliveryAttempt.remediationPlanId is a FK.)
    const drillRepo = await prisma.repository.create({
      data: {
        organizationId: ORG,
        provider: "LOCAL",
        externalId: `fixture:drill-retry-${suffix}`,
        name: "drill-retry-service",
        fullName: `drill/drill-retry-${suffix}`,
        languageProfile: {},
        metadata: {},
      },
    });
    const drillAssessment = await prisma.impactAssessment.create({
      data: {
        organizationId: ORG,
        repositoryId: drillRepo.id,
        score: 10,
        confidence: 50,
        riskLevel: "LOW",
        rationale: "drill",
        status: "NOT_AFFECTED",
      },
    });
    const drillPlan = await prisma.remediationPlan.create({
      data: {
        organizationId: ORG,
        impactAssessmentId: drillAssessment.id,
        strategy: "deterministic-ast",
        confidence: 50,
      },
    });
    const key = createDeliveryKey("CREATE", `drill-retry-${suffix}`);
    const first = await claimDeliveryAttempt({
      organizationId: ORG,
      remediationPlanId: drillPlan.id,
      idempotencyKey: key,
      action: "CREATE",
    });
    expect(first.duplicate).toBe(false);
    if (first.duplicate) throw new Error("unreachable");
    await completeDeliveryAttempt(first.attemptId, {
      status: "SUCCEEDED",
      externalId: "99",
      url: "https://github.com/drill/x/pull/99",
    });
    const retry = await claimDeliveryAttempt({
      organizationId: ORG,
      remediationPlanId: drillPlan.id,
      idempotencyKey: key,
      action: "CREATE",
    });
    expect(retry).toEqual({
      duplicate: true,
      attempt: expect.objectContaining({ status: "SUCCEEDED", externalId: "99" }),
    });
    expect(await prisma.deliveryAttempt.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("drill 3 — kill switch: suspended connector fails closed, others run", async () => {
    await setCapabilityGate(prisma, {
      organizationId: ORG,
      vendorSlug: "openai",
      level: "DRAFT_PR",
      status: "ACTIVE",
      correlationId: `drill-${suffix}`,
    });
    await assertWorkerCapabilityGateOpen(ORG, "openai", "DRAFT_PR");

    await setCapabilityGate(prisma, {
      organizationId: ORG,
      vendorSlug: "openai",
      level: "DRAFT_PR",
      status: "SUSPENDED",
      reason: `drill breach ${suffix}`,
      correlationId: `drill-${suffix}`,
    });
    await expect(assertWorkerCapabilityGateOpen(ORG, "openai", "DRAFT_PR")).rejects.toThrow(
      /suspended/,
    );
    // Unaffected connector continues through the same gate function.
    await assertWorkerCapabilityGateOpen(ORG, "stripe", "DRAFT_PR");
    // Suspension is audited (the incident trail exists).
    const suspension = await prisma.auditEvent.findFirst({
      where: { organizationId: ORG, action: "capability.gate_suspended" },
      orderBy: { createdAt: "desc" },
    });
    expect(suspension).not.toBeNull();
  });
});
