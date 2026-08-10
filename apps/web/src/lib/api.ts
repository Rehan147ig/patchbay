import "server-only";
import { prisma } from "@patchbay/db";
import { buildAuditEvent, type AuditEventInput } from "@patchbay/audit";
import { logger, PatchbayError, payloadTooLarge } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

export const CORRELATION_HEADER = "x-correlation-id";

export function getCorrelationId(request: NextRequest): string {
  return request.headers.get(CORRELATION_HEADER) ?? crypto.randomUUID();
}

export interface ApiOkResponse<T> {
  data: T;
  correlationId: string;
}

export function jsonOk<T>(data: T, correlationId: string, status = 200): Response {
  return Response.json({ data, correlationId } satisfies ApiOkResponse<T>, {
    status,
    headers: { [CORRELATION_HEADER]: correlationId },
  });
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  };
  correlationId: string;
}

export function jsonError(error: unknown, correlationId: string): Response {
  const isProduction = process.env.NODE_ENV === "production";
  if (error instanceof PatchbayError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
        ...(!isProduction && error.stack ? { stack: error.stack } : {}),
      },
      correlationId,
    };
    return Response.json(body, {
      status: error.statusCode,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  }

  logger.error("unhandled api error", { correlationId, error: String(error) });
  const body: ApiErrorBody = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      ...(!isProduction && error instanceof Error && error.stack ? { stack: error.stack } : {}),
    },
    correlationId,
  };
  return Response.json(body, {
    status: 500,
    headers: { [CORRELATION_HEADER]: correlationId },
  });
}

export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new PatchbayError("Request body must be valid JSON", {
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new PatchbayError("Request validation failed", {
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/**
 * Reads a request body stream with a hard byte cap. The cap is enforced on
 * the actual streamed bytes, so it cannot be bypassed by lying about
 * Content-Length (NaN, negative, huge) or by chunked transfer encoding.
 */
export async function readBoundedBody(request: NextRequest, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw payloadTooLarge();
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

/** Content-Length aware variant of parseBody: body is capped, not trusted. */
export async function parseBodyBounded<T>(
  request: NextRequest,
  schema: ZodType<T>,
  maxBytes: number,
): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedBody(request, maxBytes));
  } catch (error) {
    if (error instanceof PatchbayError) throw error;
    throw new PatchbayError("Request body must be valid JSON", {
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new PatchbayError("Request validation failed", {
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function parseQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new PatchbayError("Query validation failed", {
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export interface AuditWriteInput extends Omit<AuditEventInput, "organizationId"> {
  organizationId: string;
  correlationId: string;
}

/** Persists an audit event. Redaction is applied by buildAuditEvent. */
export async function writeAuditEvent(input: AuditWriteInput): Promise<void> {
  const record = buildAuditEvent({
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    correlationId: input.correlationId,
    before: input.before,
    after: input.after,
    metadata: input.metadata,
  });
  await prisma.auditEvent.create({
    data: {
      id: record.id,
      organizationId: record.organizationId,
      actorType: record.actorType,
      actorId: record.actorId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      correlationId: record.correlationId,
      beforeJson: record.beforeJson as never,
      afterJson: record.afterJson as never,
      metadata: (record.metadata as never) ?? undefined,
      createdAt: record.createdAt,
    },
  });
}
