import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTlsConnectOptions,
  enterpriseDispatcherFor,
  fetchWithTrust,
  resetCustomCaCache,
  TrustViolationError,
} from "./safe-fetch";
import type { TrustProfile } from "./trust";

function profile(overrides: Partial<TrustProfile> = {}): TrustProfile {
  return {
    adapterPrefix: "test:",
    sources: [],
    allowedDomains: ["registry.npmjs.org"],
    allowRedirects: false,
    maxResponseBytes: 1024,
    timeoutMs: 1000,
    requireSignature: false,
    evidenceAuthenticity: "SOURCE_TRUSTED",
    evidenceConfidence: "HIGH",
    cadenceMs: 60_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCustomCaCache();
});

describe("fetchWithTrust", () => {
  it("rejects requests to domains outside the allowlist before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithTrust("https://evil.example.com/packument", profile())).rejects.toThrow(
      TrustViolationError,
    );
    await expect(
      fetchWithTrust("https://evil.example.com/packument", profile()),
    ).rejects.toMatchObject({ reason: "domain_not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects when the profile disallows them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/packument" },
        }),
      ),
    );

    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", profile()),
    ).rejects.toMatchObject({
      reason: "redirect_rejected",
      status: 302,
    });
  });

  it("rejects responses whose declared content-length exceeds the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x".repeat(500), {
          status: 200,
          headers: { "content-length": "5000" },
        }),
      ),
    );

    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", profile()),
    ).rejects.toMatchObject({
      reason: "response_too_large",
    });
  });

  it("rejects streamed bodies that exceed the cap while reading", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(900)));
        controller.enqueue(new TextEncoder().encode("b".repeat(900)));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: {} })),
    );

    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", profile()),
    ).rejects.toMatchObject({
      reason: "response_too_large",
    });
  });

  it("returns the body when within the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", etag: '"e1"' },
        }),
      ),
    );

    const result = await fetchWithTrust("https://registry.npmjs.org/openai", profile());
    expect(result.status).toBe(200);
    expect(result.text).toBe(JSON.stringify({ ok: true }));
    expect(result.headers.get("etag")).toBe('"e1"');
  });

  it("returns 304 responses as-is for conditional polls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"e1"' } })),
    );

    const result = await fetchWithTrust("https://registry.npmjs.org/openai", profile());
    expect(result.status).toBe(304);
    expect(result.text).toBe("");
  });

  it("forwards POST with a caller-built JSON body (GET stays default)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200, headers: {} }),
          ) as Promise<Response>,
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTrust("https://registry.npmjs.org/openai", profile(), {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://registry.npmjs.org/openai"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ hello: "world" }) }),
    );

    fetchMock.mockClear();
    await fetchWithTrust("https://registry.npmjs.org/openai", profile());
    const init = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("classifies request timeouts as trust violations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: URL, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
          });
        });
      }),
    );

    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", profile({ timeoutMs: 1 })),
    ).rejects.toMatchObject({ reason: "request_timeout" });
  });

  it("rejects non-OK responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("oops", {
          status: 500,
          headers: {},
        }),
      ),
    );

    await expect(
      fetchWithTrust("https://registry.npmjs.org/openai", profile()),
    ).rejects.toMatchObject({
      reason: "non_ok_status",
      status: 500,
    });
  });
});

const TEST_PEM = `-----BEGIN CERTIFICATE-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0TestCorporateRootCA
-----END CERTIFICATE-----
`;

function writeTestBundle(contents: string = TEST_PEM): string {
  const dir = mkdtempSync(join(tmpdir(), "patchbay-ca-"));
  const path = join(dir, "bundle.pem");
  writeFileSync(path, contents);
  return path;
}

describe("custom root CA", () => {
  it("returns no TLS overrides when unconfigured", () => {
    expect(buildTlsConnectOptions({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(enterpriseDispatcherFor({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("loads the bundle with verification always enabled", () => {
    const path = writeTestBundle();
    try {
      const options = buildTlsConnectOptions({
        PATCHBAY_CUSTOM_CA_BUNDLE: path,
      } as NodeJS.ProcessEnv);
      expect(options).toEqual({ ca: [TEST_PEM], rejectUnauthorized: true });

      const dispatcher = enterpriseDispatcherFor({
        PATCHBAY_CUSTOM_CA_BUNDLE: path,
      } as NodeJS.ProcessEnv);
      expect(dispatcher).toBeDefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("falls back to NODE_EXTRA_CA_CERTS", () => {
    const path = writeTestBundle();
    try {
      const options = buildTlsConnectOptions({
        NODE_EXTRA_CA_CERTS: path,
      } as NodeJS.ProcessEnv);
      expect(options?.rejectUnauthorized).toBe(true);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("fails loudly on a named-but-unreadable bundle", () => {
    expect(() =>
      buildTlsConnectOptions({
        PATCHBAY_CUSTOM_CA_BUNDLE: join(tmpdir(), "patchbay-ca-does-not-exist.pem"),
      } as NodeJS.ProcessEnv),
    ).toThrow(/custom CA bundle/);
  });

  it("fails loudly on a file without PEM data", () => {
    const path = writeTestBundle("not a certificate");
    try {
      expect(() =>
        buildTlsConnectOptions({ PATCHBAY_CUSTOM_CA_BUNDLE: path } as NodeJS.ProcessEnv),
      ).toThrow(/custom CA bundle/);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("passes the enterprise dispatcher to fetch when configured", async () => {
    const path = writeTestBundle();
    vi.stubEnv("PATCHBAY_CUSTOM_CA_BUNDLE", path);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: {} }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await fetchWithTrust("https://registry.npmjs.org/openai", profile());
      expect(result.status).toBe(304);
      const init = fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown } | undefined;
      expect(init?.dispatcher).toBeDefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("omits the dispatcher when unconfigured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTrust("https://registry.npmjs.org/openai", profile());
    const init = fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown } | undefined;
    expect(init?.dispatcher).toBeUndefined();
  });
});
