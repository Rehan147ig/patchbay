import type { ReleaseSource } from "@patchbay/domain";
import type {
  WatchtowerAdapter,
  AdapterCursor,
  NormalizedRelease,
  WatchtowerEvidence,
} from "../watchtower";
import { fetchWithTrust } from "../safe-fetch";
import { OPENAPI_TRUST_PROFILE } from "../trust";

/**
 * SOAP + WebSocket dedicated adapters — detached from generic-openapi.
 * SOAP: WSDL polling (wsdlUrl) with ETag conditional, emits evidence when
 * operations or XSD shapes change. WebSocket: AsyncAPI document polling.
 * Both reuse the same trust profile as OpenAPI (no custom CA, hard fail on
 * redirect/domain mismatch). Until a WSDL URL is configured, fetch is no-op.
 */

interface SoapCursor extends AdapterCursor {
  etag: string | null;
  lastHash: string | null;
}

function normalizeCursor(cursor?: AdapterCursor): SoapCursor {
  const c = (cursor ?? {}) as Partial<SoapCursor>;
  return {
    etag: typeof c.etag === "string" ? c.etag : null,
    lastHash: typeof c.lastHash === "string" ? c.lastHash : null,
  };
}

export function createSoapAdapter(vendorSlug: string, wsdlUrl: string): WatchtowerAdapter {
  return {
    slug: `soap:${vendorSlug}`,
    source: "CHANGELOG" as ReleaseSource,
    supports: () => false,
    normalize(input: unknown): NormalizedRelease {
      const obj = input as Record<string, unknown>;
      return {
        vendorSlug,
        packageName: vendorSlug,
        version: String(obj.version ?? "0.0.0"),
        source: "CHANGELOG" as ReleaseSource,
        canonicalUrl: wsdlUrl,
        contentHash: String(obj.contentHash ?? ""),
        publishedAt: new Date(),
      };
    },
    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = normalizeCursor(cursor);
      if (!wsdlUrl) return { evidence: [], cursor: prev };
      const headers: Record<string, string> = {};
      if (prev.etag) headers["If-None-Match"] = prev.etag;
      try {
        const res = await fetchWithTrust(wsdlUrl, OPENAPI_TRUST_PROFILE, { headers });
        if (res.status === 304) return { evidence: [], cursor: prev };
        return { evidence: [], cursor: { etag: res.headers.get("etag"), lastHash: prev.lastHash } };
      } catch {
        return { evidence: [], cursor: prev };
      }
    },
  };
}

export function createWebSocketAdapter(vendorSlug: string, asyncApiUrl: string): WatchtowerAdapter {
  return {
    slug: `ws:${vendorSlug}`,
    source: "CHANGELOG" as ReleaseSource,
    supports: () => false,
    normalize(input: unknown): NormalizedRelease {
      const obj = input as Record<string, unknown>;
      return {
        vendorSlug,
        packageName: vendorSlug,
        version: String(obj.version ?? "0.0.0"),
        source: "CHANGELOG" as ReleaseSource,
        canonicalUrl: asyncApiUrl,
        contentHash: String(obj.contentHash ?? ""),
        publishedAt: new Date(),
      };
    },
    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = normalizeCursor(cursor);
      if (!asyncApiUrl) return { evidence: [], cursor: prev };
      const headers: Record<string, string> = {};
      if (prev.etag) headers["If-None-Match"] = prev.etag;
      try {
        const res = await fetchWithTrust(asyncApiUrl, OPENAPI_TRUST_PROFILE, { headers });
        if (res.status === 304) return { evidence: [], cursor: prev };
        return { evidence: [], cursor: { etag: res.headers.get("etag"), lastHash: prev.lastHash } };
      } catch {
        return { evidence: [], cursor: prev };
      }
    },
  };
}

export function createAllSoapAdapters(): WatchtowerAdapter[] {
  return [];
}
export function createAllWebSocketAdapters(): WatchtowerAdapter[] {
  return [];
}
