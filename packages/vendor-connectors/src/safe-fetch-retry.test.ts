import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTrustRetry, parseRetryAfterMs, TrustViolationError } from "./safe-fetch";
import type { TrustProfile } from "./trust";

function profile(): TrustProfile {
  return {
    adapterPrefix: "test:",
    sources: [],
    allowedDomains: ["registry.npmjs.org"],
    allowRedirects: false,
    maxResponseBytes: 4096,
    timeoutMs: 1000,
    requireSignature: false,
    evidenceAuthenticity: "SOURCE_TRUSTED",
    evidenceConfidence: "HIGH",
    cadenceMs: 60_000,
  };
}

const URL = "https://registry.npmjs.org/openai";
const FAST = { baseDelayMs: 1, maxDelayMs: 5, jitterMs: 0, sleep: () => Promise.resolve() };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds and rejects absent/garbage/negative values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("  5 ")).toBe(5000);
    expect(parseRetryAfterMs("0")).toBeNull();
    expect(parseRetryAfterMs("-3")).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
  });
});

describe("fetchWithTrustRetry", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    const result = await fetchWithTrustRetry(URL, profile(), {}, { ...FAST, sleep });
    expect(result.status).toBe(200);
    expect(result.text).toBe('{"ok":true}');
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a 429 then succeeds, honoring Retry-After within the cap", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchWithTrustRetry(
      URL,
      profile(),
      {},
      { maxAttempts: 3, jitterMs: 0, retryAfterCapMs: 60_000, sleep },
    );
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBe(2000);
  });

  it("retries 5xx with exponential backoff and throws the last error on exhaustion", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 503 })));
    await expect(
      fetchWithTrustRetry(URL, profile(), {}, { ...FAST, sleep, maxAttempts: 3 }),
    ).rejects.toMatchObject({ reason: "non_ok_status", status: 503 });
    expect(sleep).toHaveBeenCalledTimes(2);
    const [first, second] = sleep.mock.calls.map((call) => call[0] as number);
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("throws trust rejections and 4xx immediately without retrying", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithTrustRetry(URL, profile(), {}, { ...FAST, sleep })).rejects.toMatchObject(
      { reason: "non_ok_status", status: 404 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transport errors and preserves the final classification", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchWithTrustRetry(URL, profile(), {}, { ...FAST, sleep });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("TrustViolationError carries a parsed retryAfterMs for rate limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("slow", { status: 429, headers: { "retry-after": "7" } })),
    );
    const error = await fetchWithTrustRetry(URL, profile(), {}, { ...FAST, maxAttempts: 1 }).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(TrustViolationError);
    expect((error as TrustViolationError).retryAfterMs).toBe(7000);
  });
});
