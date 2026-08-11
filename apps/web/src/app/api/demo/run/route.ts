import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { Severity, VendorChangeSource, validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import { demoRunSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf";

/**
 * OpenAI SDK v3 -> v4 change payload with a feature-adoption capability:
 * v4 ships structured outputs (JSON mode); the connector emits a NEW_CAPABILITY
 * normalization and the engine applies the insert as part of the same patch.
 */
const openAiSdkV4Payload = {
  sdk: "openai",
  fromVersion: "3.x",
  toVersion: "4.x",
  migration: {
    methodRenames: [
      {
        from: "openai.createChatCompletion",
        to: "openai.chat.completions.create",
        breaking: true,
      },
      {
        from: "openai.createCompletion",
        to: "openai.completions.create",
        breaking: true,
      },
    ],
    responseChanges: [
      {
        symbol: "completion.data",
        description: "v4 responses are returned directly; the wrapping .data field is gone.",
        breaking: true,
      },
    ],
  },
  capabilities: [
    {
      symbol: "openai.createChatCompletion",
      feature: "Structured outputs (JSON mode)",
      searchText: 'model: "gpt-4"',
      insertText: ', response_format: { type: "json_object" }',
    },
  ],
  breaking: true,
  demo: true,
};

/**
 * POST /api/demo/run
 * Runs a demo scenario deterministically:
 * - "openai-migration": creates (idempotently) the OpenAI SDK v3 -> v4 change
 *   event and enqueues analyze-change.
 * Other scenarios arrive with their engine phases (Phase 6).
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const input = await parseBody(request, demoRunSchema);

    if (input.scenario !== "openai-migration") {
      throw validationFailed(
        `Scenario "${input.scenario}" is not implemented yet (ships with a later phase)`,
      );
    }

    const vendor = await prisma.vendor.findUnique({ where: { slug: "openai" } });
    if (!vendor) throw validationFailed('Vendor "openai" is not in the catalog');

    // Per-org event identity so demo runs never share rows across tenants.
    const demoEventId = `c-openai-sdk-v4-${user.organizationId.slice(0, 8)}`;
    const event = await prisma.vendorChangeEvent.upsert({
      where: { id: demoEventId },
      update: { rawPayload: openAiSdkV4Payload },
      create: {
        id: demoEventId,
        vendorId: vendor.id,
        organizationId: user.organizationId,
        externalReference: "openai-node-4.0.0",
        sourceType: VendorChangeSource.SDK_RELEASE,
        detectedAt: new Date(),
        title: "OpenAI Node SDK v4: createChatCompletion removed",
        severity: Severity.HIGH,
        status: "DETECTED",
        rawPayload: openAiSdkV4Payload,
      },
    });

    await enqueue(JobType.ANALYZE_CHANGE, {
      changeEventId: event.id,
      organizationId: user.organizationId,
      correlationId,
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.DEMO_RUN,
      entityType: "vendorChangeEvent",
      entityId: event.id,
      correlationId,
      after: { scenario: input.scenario, changeEventId: event.id },
    });

    return jsonOk({ changeEventId: event.id, status: "QUEUED" }, correlationId, 202);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
