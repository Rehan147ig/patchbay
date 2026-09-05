import { describe, expect, it } from "vitest";
import { PatchbayError } from "./errors";

/**
 * WP1 stability guard: ErrorCode values are part of the public API contract
 * (predictable JSON error bodies consumed by the CLI, dashboard, and customer
 * integrations). Renaming a code silently breaks those clients, so the full
 * set is pinned here — additions are fine, renames/removals are not.
 */
const STABLE_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_FAILED",
  "POLICY_DENIED",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "PLAN_LIMIT_EXCEEDED",
  "BILLING_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

describe("stable error codes", () => {
  it("pins the exact public code set", () => {
    const probed = new PatchbayError("probe", { statusCode: 500, code: "INTERNAL_ERROR" });
    expect(probed.code).toBe("INTERNAL_ERROR");
    expect([...STABLE_ERROR_CODES]).toHaveLength(12);
  });

  it("round-trips every code through PatchbayError without coercion", () => {
    for (const code of STABLE_ERROR_CODES) {
      const error = new PatchbayError(`probe ${code}`, { statusCode: 500, code });
      expect(error.code).toBe(code);
      expect(error.name).toBe("PatchbayError");
    }
  });
});
