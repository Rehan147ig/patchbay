/**
 * Deterministic OpenAPI contract diff. Pure functions, no network, no DB.
 * Compares two parsed OpenAPI documents and emits stable facts about what
 * changed between them, so a changed spec can be classified without an LLM.
 */

export interface OpenApiChangedOperation {
  /** "{METHOD} {path}", e.g. "POST /v1/chat/completions". */
  operation: string;
  reason: string;
}

export interface OpenApiDiffFacts {
  /** spec.info.version before and after ("" when absent). */
  specBefore: string;
  specAfter: string;
  /** "{METHOD} {path}" entries present after but not before. */
  addedOperations: string[];
  /** "{METHOD} {path}" entries present before but not after. */
  removedOperations: string[];
  /** Operations present in both specs whose request/response shape changed. */
  changedOperations: OpenApiChangedOperation[];
  /** True when any operation was removed or its shape changed. */
  breaking: boolean;
}

type OpenApiOperation = {
  method: string;
  path: string;
  operationId?: string;
};

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

function specVersion(doc: unknown): string {
  if (typeof doc !== "object" || doc === null) return "";
  const info = (doc as Record<string, unknown>).info;
  if (typeof info !== "object" || info === null) return "";
  const version = (info as Record<string, unknown>).version;
  return typeof version === "string" ? version : "";
}

function extractOperations(doc: unknown): OpenApiOperation[] {
  if (typeof doc !== "object" || doc === null) return [];
  const paths = (doc as Record<string, unknown>).paths;
  if (typeof paths !== "object" || paths === null) return [];
  const operations: OpenApiOperation[] = [];
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (typeof item !== "object" || item === null) continue;
    for (const [key, op] of Object.entries(item as Record<string, unknown>)) {
      if (!METHODS.includes(key.toLowerCase())) continue;
      const record = op as Record<string, unknown> | null;
      const operationId = record?.operationId;
      operations.push({
        method: key.toUpperCase(),
        path,
        operationId: typeof operationId === "string" ? operationId : undefined,
      });
    }
  }
  return operations;
}

function operationSpec(doc: unknown, op: OpenApiOperation): Record<string, unknown> | undefined {
  if (typeof doc !== "object" || doc === null) return undefined;
  const paths = (doc as Record<string, unknown>).paths;
  if (typeof paths !== "object" || paths === null) return undefined;
  const pathItem = (paths as Record<string, unknown>)[op.path];
  if (typeof pathItem !== "object" || pathItem === null) return undefined;
  const spec = (pathItem as Record<string, unknown>)[op.method.toLowerCase()];
  return typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>) : undefined;
}

/** Shape fingerprint: type/required/enum/parameters minus descriptions/examples. */
function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(summarize);
  if (typeof value === "object" && value !== null) {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "description" || k === "example" || k === "examples" || k === "format") continue;
      next[k] = summarize(v);
    }
    return Object.keys(next).length === 0 ? "{}" : next;
  }
  return value;
}

function signature(doc: unknown, op: OpenApiOperation): string {
  return JSON.stringify(summarize(operationSpec(doc, op) ?? {}));
}

/**
 * Diff two OpenAPI documents. `before` and `after` are the parsed JSON bodies.
 * Returns a stable fact set; never throws on malformed input.
 */
export function diffOpenApiSpecs(before: unknown, after: unknown): OpenApiDiffFacts {
  const beforeOps = extractOperations(before);
  const afterOps = extractOperations(after);

  const keyOf = (op: OpenApiOperation): string => `${op.method} ${op.path}`;
  const beforeKeyed = new Set(beforeOps.map(keyOf));
  const afterKeyed = new Set(afterOps.map(keyOf));

  const addedOperations = [...afterKeyed].filter((key) => !beforeKeyed.has(key));
  const removedOperations = [...beforeKeyed].filter((key) => !afterKeyed.has(key));

  const changedOperations: OpenApiChangedOperation[] = [];
  for (const afterOp of afterOps) {
    const beforeOp = beforeOps.find(
      (op) => op.operationId !== undefined && op.operationId === afterOp.operationId,
    );
    if (!beforeOp) continue;
    if (signature(before, beforeOp) !== signature(after, afterOp)) {
      changedOperations.push({
        operation: keyOf(afterOp),
        reason: "request or response shape changed",
      });
    }
  }

  return {
    specBefore: specVersion(before),
    specAfter: specVersion(after),
    addedOperations,
    removedOperations,
    changedOperations,
    breaking: removedOperations.length > 0 || changedOperations.length > 0,
  };
}
