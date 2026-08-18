import { createHash } from "node:crypto";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  AdapterCursor,
  NormalizedRelease,
  WatchtowerAdapter,
  WatchtowerEvidence,
} from "../watchtower";
import { diffOpenApiSpecs, type OpenApiDiffFacts } from "./openapi-diff";
import { fetchWithTrust } from "../safe-fetch";
import { OPENAPI_TRUST_PROFILE } from "../trust";

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
}

interface OpenApiCursor extends AdapterCursor {
  /** ETag of the last spec response, replayed for conditional polls. */
  etag: string | null;
  /** Content hash of the last observed spec. */
  lastContentHash: string | null;
  /** Parsed JSON of the last observed spec (basis for the next diff). */
  lastSpec: Record<string, unknown> | null;
}

function isSpec(input: unknown): input is OpenAPISpec {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.info === "object" &&
    obj.info !== null &&
    typeof (obj.info as Record<string, unknown>).version === "string"
  );
}

/**
 * OpenAPI spec adapter - conditionally fetches a vendor OpenAPI document and
 * emits an evidence item whenever the contract changes. Evidence carries a
 * deterministic apiDiff fact set (added/removed/changed operations) instead of
 * just a raw snapshot, so a contract change is explainable without an LLM.
 */
export function createOpenAPIAdapter(vendorSlug: string, specUrl: string): WatchtowerAdapter {
  return {
    slug: `openapi:${vendorSlug}`,
    source: "OPENAPI" as ReleaseSource,

    supports(input: unknown): boolean {
      if (typeof input !== "object" || input === null) return false;
      const obj = input as Record<string, unknown>;
      return obj.vendorSlug === vendorSlug && obj.spec !== undefined;
    },

    normalize(input: unknown): NormalizedRelease {
      if (!this.supports(input)) {
        throw new Error(`Input not supported by OpenAPI adapter for ${vendorSlug}`);
      }
      const obj = input as Record<string, unknown>;
      const spec = obj.spec;
      if (!isSpec(spec)) {
        throw new Error(`Spec for ${vendorSlug} is missing info.version`);
      }
      return {
        vendorSlug,
        packageName: vendorSlug,
        version: spec.info.version,
        source: "OPENAPI" as ReleaseSource,
        canonicalUrl: specUrl,
        contentHash: obj.contentHash as string,
        publishedAt: new Date(),
        metadata: { specTitle: spec.info.title, specVersion: spec.openapi },
      };
    },

    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = (cursor ?? {
        etag: null,
        lastContentHash: null,
        lastSpec: null,
      }) as OpenApiCursor;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (prev.etag) headers["If-None-Match"] = prev.etag;

      const response = await fetchWithTrust(specUrl, OPENAPI_TRUST_PROFILE, { headers });
      if (response.status === 304) {
        return { evidence: [], cursor: prev };
      }

      const etag = response.headers.get("etag");
      const spec = JSON.parse(response.text) as OpenAPISpec;
      const raw = JSON.stringify(spec);
      const contentHash = createHash("sha256").update(raw).digest("hex");

      const next: OpenApiCursor = {
        etag,
        lastContentHash: contentHash,
        lastSpec: spec as unknown as Record<string, unknown>,
      };
      if (contentHash === prev.lastContentHash && prev.lastContentHash !== null) {
        return { evidence: [], cursor: next };
      }

      let apiDiff: OpenApiDiffFacts | null = null;
      if (prev.lastSpec !== null && prev.lastSpec !== undefined) {
        try {
          apiDiff = diffOpenApiSpecs(prev.lastSpec, spec);
        } catch {
          apiDiff = null;
        }
      }

      const evidence: WatchtowerEvidence = {
        externalId: `openapi:${vendorSlug}@${spec.info.version}@${contentHash.slice(0, 12)}`,
        vendorSlug,
        packageName: vendorSlug,
        version: spec.info.version,
        source: "OPENAPI" as ReleaseSource,
        canonicalUrl: specUrl,
        contentHash,
        rawPayload: raw,
        publishedAt: new Date(),
        metadata: {
          specTitle: spec.info.title,
          specVersion: spec.openapi,
          ...(apiDiff ? { apiDiff } : {}),
        },
      };
      return { evidence: [evidence], cursor: next };
    },
  };
}

export function createOpenAPIAdapters(): WatchtowerAdapter[] {
  const specs: Record<string, string> = {
    stripe: "https://api.stripe.com/openapi/spec3.json",
  };
  return Object.entries(specs).map(([vendor, url]) => createOpenAPIAdapter(vendor, url));
}
