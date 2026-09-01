import { createHash } from "node:crypto";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  WatchtowerAdapter,
  AdapterCursor,
  WatchtowerEvidence,
  NormalizedRelease,
} from "../watchtower";
import { fetchWithTrust } from "../safe-fetch";
import { DATA_TRUST_PROFILE } from "../trust";

/**
 * DATA plane: SQL / Mongo / Schema (JSON/Protobuf/Avro).
 * Schema Registry diffs are the data equivalent of openapi-diff — breaking
 * when a field is removed or its type changes. Graph already has DATABASE
 * nodes (enums.ts:265); adapters emit evidence like OPENAPI does.
 */

interface DataCursor extends AdapterCursor {
  etag: string | null;
  lastContentHash: string | null;
  lastSchema: Record<string, unknown> | null;
}

function normalizeCursor(cursor?: AdapterCursor): DataCursor {
  const c = (cursor ?? {}) as Partial<DataCursor>;
  return {
    etag: typeof c.etag === "string" ? c.etag : null,
    lastContentHash: typeof c.lastContentHash === "string" ? c.lastContentHash : null,
    lastSchema:
      c.lastSchema !== null && typeof c.lastSchema === "object" && !Array.isArray(c.lastSchema)
        ? (c.lastSchema as Record<string, unknown>)
        : null,
  };
}

function stubAdapter(slug: string, source: ReleaseSource): WatchtowerAdapter {
  return {
    slug,
    source,
    supports: () => false,
    normalize: () => {
      throw new Error(`${slug} normalize not implemented — stub`);
    },
    async fetch(
      _cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      return { evidence: [], cursor: {} };
    },
  };
}

export function diffSchemas(
  before: unknown,
  after: unknown,
): { breaking: boolean; added: string[]; removed: string[] } {
  const beforeFields = new Set(
    Object.keys(
      (before as Record<string, unknown>)?.properties ?? (before as Record<string, unknown>) ?? {},
    ),
  );
  const afterFields = new Set(
    Object.keys(
      (after as Record<string, unknown>)?.properties ?? (after as Record<string, unknown>) ?? {},
    ),
  );
  const added = [...afterFields].filter((k) => !beforeFields.has(k));
  const removed = [...beforeFields].filter((k) => !afterFields.has(k));
  // Naïve: any removed or type change is breaking. Real Avro needs field-id + type check.
  const breaking = removed.length > 0;
  return { breaking, added, removed };
}

function createSchemaHttpAdapter(
  slug: string,
  registryUrl: string,
  subject: string,
): WatchtowerAdapter {
  return {
    slug,
    source: "OPENAPI" as ReleaseSource,
    supports(input: unknown): boolean {
      if (typeof input !== "object" || input === null) return false;
      const obj = input as Record<string, unknown>;
      return obj.subject === subject;
    },
    normalize(input: unknown): NormalizedRelease {
      const obj = input as Record<string, unknown>;
      return {
        vendorSlug: subject,
        packageName: subject,
        version: String(obj.version ?? "0.0.0"),
        source: "OPENAPI" as ReleaseSource,
        canonicalUrl: registryUrl,
        contentHash: String(obj.contentHash ?? ""),
        publishedAt: new Date(),
      };
    },
    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = normalizeCursor(cursor);
      if (!registryUrl) return { evidence: [], cursor: prev };
      const headers: Record<string, string> = { Accept: "application/json" };
      if (prev.etag) headers["If-None-Match"] = prev.etag;
      const res = await fetchWithTrust(registryUrl, DATA_TRUST_PROFILE, { headers });
      if (res.status === 304) return { evidence: [], cursor: prev };
      const etag = res.headers.get("etag");
      const body = res.text;
      const contentHash = createHash("sha256").update(body).digest("hex");
      if (contentHash === prev.lastContentHash && prev.lastContentHash !== null) {
        return {
          evidence: [],
          cursor: { etag, lastContentHash: contentHash, lastSchema: prev.lastSchema },
        };
      }
      let schema: Record<string, unknown> = {};
      try {
        schema = JSON.parse(body) as Record<string, unknown>;
      } catch {
        schema = { raw: body.slice(0, 2000) };
      }
      const version = String(
        (schema as Record<string, unknown>).version ?? contentHash.slice(0, 8),
      );
      const diff = prev.lastSchema ? diffSchemas(prev.lastSchema, schema) : null;
      const evidence: WatchtowerEvidence = {
        externalId: `${slug}@${version}@${contentHash.slice(0, 12)}`,
        vendorSlug: subject,
        packageName: subject,
        version,
        source: "OPENAPI" as ReleaseSource,
        canonicalUrl: registryUrl,
        contentHash,
        rawPayload: body,
        publishedAt: new Date(),
        metadata: { registryUrl, subject, ...(diff ? { schemaDiff: diff } : {}) },
      };
      return {
        evidence: [evidence],
        cursor: { etag, lastContentHash: contentHash, lastSchema: schema },
      };
    },
  };
}

export function createSqlAdapter(dsn?: string): WatchtowerAdapter {
  const url = dsn ?? process.env.SQL_DSN;
  const slug = `data:sql:${dsn ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createSchemaHttpAdapter(slug, url, dsn ?? "sql");
}
export function createMongoAdapter(uri?: string): WatchtowerAdapter {
  const url = uri ?? process.env.MONGO_URI;
  const slug = `data:mongo:${uri ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createSchemaHttpAdapter(slug, url, uri ?? "mongo");
}
export function createSchemaRegistryAdapter(
  registryUrl?: string,
  subject?: string,
): WatchtowerAdapter {
  const url = registryUrl ?? process.env.SCHEMA_REGISTRY_URL;
  const slug = `data:schema:${subject ?? registryUrl ?? "default"}`;
  if (!url) return stubAdapter(slug, "OPENAPI" as ReleaseSource);
  return createSchemaHttpAdapter(slug, url, subject ?? "schema");
}

export function createAllDataAdapters(): WatchtowerAdapter[] {
  const adapters: WatchtowerAdapter[] = [];
  if (process.env.SCHEMA_REGISTRY_URL)
    adapters.push(
      createSchemaRegistryAdapter(
        process.env.SCHEMA_REGISTRY_URL,
        process.env.SCHEMA_SUBJECT ?? "users-value",
      ),
    );
  if (process.env.SQL_DSN) adapters.push(createSqlAdapter(process.env.SQL_DSN));
  if (process.env.MONGO_URI) adapters.push(createMongoAdapter(process.env.MONGO_URI));
  return adapters;
}
