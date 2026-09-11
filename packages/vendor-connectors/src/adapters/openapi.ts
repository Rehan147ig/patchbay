import { createHash } from "node:crypto";
import yaml from "js-yaml";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  AdapterCursor,
  NormalizedRelease,
  WatchtowerAdapter,
  WatchtowerEvidence,
} from "../watchtower";
import { diffOpenApiSpecs, diffWebhookPayloads, type OpenApiDiffFacts } from "./openapi-diff";
import type { WebhookPayloadDiffFacts } from "./openapi-diff";
import { fetchWithTrust } from "../safe-fetch";
import { OPENAPI_TRUST_PROFILE } from "../trust";

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
}

interface OpenApiCursor extends AdapterCursor {
  /** ETag of the last spec response, replayed for conditional polls. */
  etag: string | null;
  /** Content hash of the last observed spec. */
  lastContentHash: string | null;
  /** Parsed JSON of the last observed spec (basis for the next diff). */
  lastSpec: Record<string, unknown> | null;
}

/** Defensive cursor normalization: stored cursors outlive adapter code changes. */
function normalizeCursor(cursor?: AdapterCursor): OpenApiCursor {
  const c = (cursor ?? {}) as Partial<OpenApiCursor>;
  return {
    etag: typeof c.etag === "string" ? c.etag : null,
    lastContentHash: typeof c.lastContentHash === "string" ? c.lastContentHash : null,
    lastSpec:
      c.lastSpec !== null && typeof c.lastSpec === "object" && !Array.isArray(c.lastSpec)
        ? (c.lastSpec as Record<string, unknown>)
        : null,
  };
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
      const prev = normalizeCursor(cursor);
      // YAML specs (openai) advertise YAML; JSON specs keep the JSON accept.
      // raw.githubusercontent serves either regardless — the header documents intent.
      const wantsYaml = specUrl.endsWith(".yaml") || specUrl.endsWith(".yml");
      const headers: Record<string, string> = {
        Accept: wantsYaml ? "application/yaml, text/yaml, application/json" : "application/json",
      };
      if (prev.etag) headers["If-None-Match"] = prev.etag;

      const response = await fetchWithTrust(specUrl, OPENAPI_TRUST_PROFILE, { headers });
      if (response.status === 304) {
        return { evidence: [], cursor: prev };
      }

      const etag = response.headers.get("etag");
      let parsed: unknown;
      try {
        parsed = wantsYaml ? yaml.load(response.text) : JSON.parse(response.text);
      } catch {
        throw new Error(
          `Spec for ${vendorSlug} is not parseable as ${wantsYaml ? "YAML" : "JSON"}`,
        );
      }
      const spec = parsed as OpenAPISpec;
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
      let webhookDiff: WebhookPayloadDiffFacts[] = [];
      if (prev.lastSpec !== null && prev.lastSpec !== undefined) {
        try {
          apiDiff = diffOpenApiSpecs(prev.lastSpec, spec);
          webhookDiff = diffWebhookPayloads(prev.lastSpec, spec);
        } catch {
          apiDiff = null;
          webhookDiff = [];
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
          ...(webhookDiff.length > 0 ? { webhookDiff } : {}),
        },
      };
      return { evidence: [evidence], cursor: next };
    },
  };
}

export function createOpenAPIAdapters(): WatchtowerAdapter[] {
  // Stripe publishes its canonical spec in the stripe/openapi repo; the
  // api.stripe.com/openapi path does not exist (404). /HEAD/ resolves to the
  // default branch without a redirect (raw 302s are hard-rejected by the
  // trust profile), so branch renames like master->main cannot break polls.
  // Poll-volume note: GitHub's description is multi-MB, but conditional polls
  // (ETag → 304) plus content-hash dedup mean unchanged specs cost one small
  // request per cadence — same mechanism the stripe adapter already relies on.
  // Each URL needs its trust-profile path prefix (trust.ts) or polls fail
  // closed as domain_not_allowed.
  const specs: Record<string, string> = {
    stripe: "https://raw.githubusercontent.com/stripe/openapi/HEAD/openapi/spec3.json",
    github:
      "https://raw.githubusercontent.com/github/rest-api-description/HEAD/descriptions/api.github.com/api.github.com.json",
    openai: "https://raw.githubusercontent.com/openai/openai-openapi/HEAD/openapi.yaml",
  };
  return Object.entries(specs).map(([vendor, url]) => createOpenAPIAdapter(vendor, url));
}
