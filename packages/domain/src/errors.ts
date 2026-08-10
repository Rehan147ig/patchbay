/**
 * Typed application errors mapped to predictable JSON API responses.
 * Never leak stack traces to clients (see apps/web API helpers).
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "POLICY_DENIED"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export interface PatchbayErrorOptions {
  statusCode: number;
  code: ErrorCode;
  details?: unknown;
  cause?: unknown;
}

export class PatchbayError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;
  override readonly cause: unknown;

  constructor(message: string, options: PatchbayErrorOptions) {
    super(message);
    this.name = "PatchbayError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function badRequest(message: string, details?: unknown): PatchbayError {
  return new PatchbayError(message, { statusCode: 400, code: "BAD_REQUEST", details });
}

export function validationFailed(message: string, details?: unknown): PatchbayError {
  return new PatchbayError(message, { statusCode: 422, code: "VALIDATION_FAILED", details });
}

export function unauthorized(message = "Authentication required"): PatchbayError {
  return new PatchbayError(message, { statusCode: 401, code: "UNAUTHORIZED" });
}

export function forbidden(
  message = "You do not have permission to perform this action",
): PatchbayError {
  return new PatchbayError(message, { statusCode: 403, code: "FORBIDDEN" });
}

export function notFound(message = "Resource not found"): PatchbayError {
  return new PatchbayError(message, { statusCode: 404, code: "NOT_FOUND" });
}

export function conflict(message: string, details?: unknown): PatchbayError {
  return new PatchbayError(message, { statusCode: 409, code: "CONFLICT", details });
}

export function policyDenied(message: string, details?: unknown): PatchbayError {
  return new PatchbayError(message, { statusCode: 403, code: "POLICY_DENIED", details });
}

export function tooManyRequests(message = "Too many requests, slow down"): PatchbayError {
  return new PatchbayError(message, { statusCode: 429, code: "RATE_LIMITED" });
}

export function payloadTooLarge(message = "Request body exceeds the size limit"): PatchbayError {
  return new PatchbayError(message, { statusCode: 413, code: "PAYLOAD_TOO_LARGE" });
}
