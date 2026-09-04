import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTrust } from "./safe-fetch";
import { NPM_TRUST_PROFILE, OSV_TRUST_PROFILE } from "./trust";

/**
 * SSRF / network-boundary hardening (production gate).
 *
 * fetchWithTrust resolves the URL and checks the profile allowlist BEFORE
 * any socket opens: requests to non-allowlisted hosts throw and the fetch
 * mock is never invoked, proving no request leaves the process. These tests
 * pin that ordering for cloud-metadata, loopback (decimal, IPv6, hex), and
 * redirect-escape shapes.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSRF boundary", () => {
  it("blocks AWS instance metadata (IMDS) without opening a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchWithTrust("http://169.254.169.254/latest/meta-data/", NPM_TRUST_PROFILE),
    ).rejects.toThrow(/not in the trust profile allowlist/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks loopback in decimal, IPv6, and hex-encoded forms", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const target of [
      "http://localhost:3000/api/admin",
      "http://127.0.0.1:5432/",
      "http://[::1]/",
      "http://0x7f000001/",
    ]) {
      await expect(fetchWithTrust(target, NPM_TRUST_PROFILE)).rejects.toThrow(
        /not in the trust profile allowlist/,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks redirect escapes from an allowed domain to IMDS", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", NPM_TRUST_PROFILE),
    ).rejects.toMatchObject({ reason: "redirect_rejected" });
  });

  it("pins the OSV profile to its API path (no domain-wide trust)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // api.osv.dev is allowed only under /v1/ — other paths are rejected.
    await expect(fetchWithTrust("https://api.osv.dev/other", OSV_TRUST_PROFILE)).rejects.toThrow(
      /allowed path prefixes|not in the trust profile allowlist/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before buffering them fully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x".repeat(100), {
          status: 200,
          headers: { "content-length": "999999999" },
        }),
      ),
    );
    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", {
        ...NPM_TRUST_PROFILE,
        maxResponseBytes: 10,
      }),
    ).rejects.toMatchObject({ reason: "response_too_large" });
  });
});
