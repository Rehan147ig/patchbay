import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

describe("buildSecurityHeaders", () => {
  it("sets the baseline hardening headers", () => {
    const headers = buildSecurityHeaders({ nonce: "n1", isProduction: true });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("uses a strict nonce-based CSP in production", () => {
    const headers = buildSecurityHeaders({ nonce: "abc123", isProduction: true });
    const csp = headers["Content-Security-Policy"]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");
  });

  it("relaxes script-src for development and skips HSTS/upgrade", () => {
    const headers = buildSecurityHeaders({ nonce: "n1", isProduction: false });
    expect(headers["Content-Security-Policy"]).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(headers["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("emits HSTS only in production", () => {
    const prod = buildSecurityHeaders({ nonce: "n1", isProduction: true });
    expect(prod["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });
});
