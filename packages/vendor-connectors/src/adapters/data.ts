import type { ReleaseSource } from "@patchbay/domain";
import type { WatchtowerAdapter, AdapterCursor, WatchtowerEvidence } from "../watchtower";

/**
 * DATA plane skeleton: SQL / Mongo / Schema (JSON/Protobuf/Avro).
 * Schema Registry diffs are the data equivalent of openapi-diff — breaking
 * when a field is removed or its type changes. Graph already has DATABASE
 * nodes (enums.ts:265); these adapters will emit evidence like OPENAPI does.
 */

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

export function createSqlAdapter(dsn?: string): WatchtowerAdapter {
  return stubAdapter(`data:sql:${dsn ?? "default"}`, "CHANGELOG" as ReleaseSource);
}
export function createMongoAdapter(uri?: string): WatchtowerAdapter {
  return stubAdapter(`data:mongo:${uri ?? "default"}`, "CHANGELOG" as ReleaseSource);
}
export function createSchemaRegistryAdapter(registryUrl?: string): WatchtowerAdapter {
  return stubAdapter(`data:schema:${registryUrl ?? "default"}`, "OPENAPI" as ReleaseSource);
}

export function diffSchemas(
  _before: unknown,
  _after: unknown,
): { breaking: boolean; added: string[]; removed: string[] } {
  // Placeholder — real impl mirrors openapi-diff.ts:96 diffOpenApiSpecs but for JSON Schema / Avro.
  return { breaking: false, added: [], removed: [] };
}

export function createAllDataAdapters(): WatchtowerAdapter[] {
  return [];
}
