import { prisma, type Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { Severity, VendorChangeSource, validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import { demoRunSchema } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

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
 * Auth0 SDK authentication middleware signature change payload.
 * Triggers REQUIRE_APPROVAL decision via auth risk policy; blocks PR creation until approved.
 */
const auth0ConfigPayload = {
  sdk: "auth0",
  version: "4.0.0",
  migration: {
    signatureChanges: [
      {
        from: "jwtCheck",
        to: "auth0JwtBearer",
        description: "Auth0 SDK update: authentication middleware signature changed.",
        breaking: true,
      },
    ],
  },
  breaking: true,
  demo: true,
};

/**
 * Stripe customers.create metadata requirement change payload.
 * The connector emits a PARAMETER_REQUIRED normalization with a PAYMENT risk
 * tag; the engine applies the metadata insert as part of the same patch.
 * PAYMENT triggers REQUIRE_APPROVAL; stripe is certified for DRAFT_PR, so a
 * draft PR can be created once an admin approves and validation passes.
 */
const stripeMetadataPayload = {
  sdk: "stripe",
  version: "17.5.0",
  migration: {
    parameterChanges: [
      {
        symbol: "stripe.customers.create",
        parameter: "metadata",
        description: "Stripe API update: customer creation requires metadata tracking.",
        breaking: true,
      },
    ],
  },
  breaking: true,
  demo: true,
};

/**
 * Generic OpenAPI response field removed diff payload.
 * Triggers plan-only remediation with no automated code patch.
 */
const openapiResponseFieldPayload = {
  sourceType: "OPENAPI_DIFF",
  vendor: "generic-openapi",
  diffs: [
    {
      changeType: "RESPONSE_FIELD_REMOVED",
      symbol: "response.data.id",
      description: "Removed response property 'id' from OpenAPI specification.",
    },
  ],
  breaking: true,
  demo: true,
};

const supabaseAuthUserPayload = {
  sdk: "supabase",
  fromVersion: "1.x",
  toVersion: "2.x",
  breaking: true,
  demo: true,
};

const anthropicCompletionsPayload = {
  sdk: "anthropic",
  fromVersion: "0.x",
  toVersion: "1.x",
  breaking: true,
  demo: true,
};

const awsSdkV2ClientsPayload = {
  sdk: "aws-sdk",
  fromVersion: "2.x",
  toVersion: "3.x",
  breaking: true,
  demo: true,
};

/**
 * POST /api/demo/run
 * Runs a demo scenario deterministically:
 * - "openai-migration": creates OpenAI SDK v3 -> v4 change event, enqueues analyze-change.
 * - "auth0-config": creates Auth0 middleware change event (policy-gated, requires approval).
 * - "openapi-response-field": creates OpenAPI diff change event (plan-only, no patch).
 * - "stripe-metadata": creates Stripe customers.create metadata change event
 *   (approval-gated; stripe is certified DRAFT_PR, unlike Auth0).
 * - "anthropic-completions": Completions API → messages.create (DRAFT_PR).
 * - "aws-sdk-v2-clients": AWS.S3/SQS/DynamoDB constructor rename (DRAFT_PR, INFRASTRUCTURE).
 * - "supabase-auth-user": auth.user() → getUser() (DRAFT_PR, AUTH approval).
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const input = await parseBody(request, demoRunSchema);

    let vendorSlug: string;
    let demoEventId: string;
    let externalReference: string;
    let sourceType: VendorChangeSource;
    let title: string;
    let severity: Severity;
    let rawPayload: Prisma.InputJsonValue;

    if (input.scenario === "openai-migration") {
      vendorSlug = "openai";
      demoEventId = `c-openai-sdk-v4-${user.organizationId.slice(0, 8)}`;
      externalReference = "openai-node-4.0.0";
      sourceType = VendorChangeSource.SDK_RELEASE;
      title = "OpenAI Node SDK v4: createChatCompletion removed";
      severity = Severity.HIGH;
      rawPayload = openAiSdkV4Payload;
    } else if (input.scenario === "auth0-config") {
      vendorSlug = "auth0";
      demoEventId = `c-auth0-config-${user.organizationId.slice(0, 8)}`;
      externalReference = "auth0-node-4.0.0";
      sourceType = VendorChangeSource.SDK_RELEASE;
      title = "Auth0 SDK: authentication middleware signature changed";
      severity = Severity.HIGH;
      rawPayload = auth0ConfigPayload;
    } else if (input.scenario === "stripe-metadata") {
      vendorSlug = "stripe";
      demoEventId = `c-stripe-metadata-${user.organizationId.slice(0, 8)}`;
      externalReference = "stripe-node-17.5.0";
      sourceType = VendorChangeSource.SDK_RELEASE;
      title = "Stripe API: customers.create now requires metadata tracking";
      severity = Severity.HIGH;
      rawPayload = stripeMetadataPayload;
    } else if (input.scenario === "openapi-response-field") {
      vendorSlug = "generic-openapi";
      demoEventId = `c-openapi-field-${user.organizationId.slice(0, 8)}`;
      externalReference = "openapi-diff-2026-07-18";
      sourceType = VendorChangeSource.OPENAPI_DIFF;
      title = "Generic OpenAPI: response field removed";
      severity = Severity.MEDIUM;
      rawPayload = openapiResponseFieldPayload;
    } else if (input.scenario === "anthropic-completions") {
      vendorSlug = "anthropic";
      demoEventId = `c-anthropic-completions-${user.organizationId.slice(0, 8)}`;
      externalReference = "anthropic-sdk-messages";
      sourceType = VendorChangeSource.SDK_RELEASE;
      title = "Anthropic SDK: completions.create replaced by messages.create";
      severity = Severity.HIGH;
      rawPayload = anthropicCompletionsPayload;
    } else if (input.scenario === "aws-sdk-v2-clients") {
      vendorSlug = "aws-sdk";
      demoEventId = `c-aws-sdk-v2-${user.organizationId.slice(0, 8)}`;
      externalReference = "aws-sdk-js-v3";
      sourceType = VendorChangeSource.SDK_RELEASE;
      title = "AWS SDK v3: service constructors replaced by v3 clients";
      severity = Severity.HIGH;
      rawPayload = awsSdkV2ClientsPayload;
    } else if (input.scenario === "supabase-auth-user") {
      vendorSlug = "supabase";
      demoEventId = `c-supabase-auth-user-${user.organizationId.slice(0, 8)}`;
      externalReference = "supabase-js-v2";
      sourceType = VendorChangeSource.SDK_RELEASE;
      title = "Supabase JS v2: auth.user replaced by auth.getUser";
      severity = Severity.HIGH;
      rawPayload = supabaseAuthUserPayload;
    } else {
      throw validationFailed(`Scenario "${input.scenario}" is not recognized`);
    }

    const vendor = await prisma.vendor.findUnique({ where: { slug: vendorSlug } });
    if (!vendor) throw validationFailed(`Vendor "${vendorSlug}" is not in the catalog`);

    // Per-org event identity so demo runs never share rows across tenants.
    const event = await prisma.vendorChangeEvent.upsert({
      where: { id: demoEventId },
      update: { rawPayload },
      create: {
        id: demoEventId,
        vendorId: vendor.id,
        organizationId: user.organizationId,
        externalReference,
        sourceType,
        detectedAt: new Date(),
        title,
        severity,
        status: "DETECTED",
        rawPayload,
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
