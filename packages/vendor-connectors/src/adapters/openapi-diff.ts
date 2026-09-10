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

// ---------------------------------------------------------------------------
// Webhook payload diff (P1, events plane). Same contract as above — pure,
// deterministic, never throws on malformed input — but for the inbound event
// plane: `webhooks:` (OpenAPI 3.1) and `x-webhooks:` (3.0 extension) sections
// instead of `paths:`. Breaking means "an existing consumer handler can
// break": a removed or renamed payload field. Added fields never break a
// consumer that parses what it knows, so additions are reported but benign.
// ---------------------------------------------------------------------------

export interface WebhookFieldRename {
  from: string;
  to: string;
}

export interface WebhookPayloadDiffFacts {
  /** Event key as written in the spec, e.g. "invoice.payment_succeeded". */
  eventType: string;
  /** Dot-joined leaf paths present after but not before. */
  addedFields: string[];
  /** Dot-joined leaf paths present before but not after (and not renamed). */
  removedFields: string[];
  /** Removed+added pairs with byte-identical shape summaries. */
  renamedFields: WebhookFieldRename[];
  /** True when any field was removed or renamed. */
  breaking: boolean;
}

/** Resolution depth cap: real specs nest shallowly; cycles fail closed. */
const MAX_REF_DEPTH = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Local `#/...` JSON-pointer lookup inside one document; remote refs stay opaque. */
function resolveLocalRef(root: unknown, ref: string, seen: ReadonlySet<string>): unknown {
  if (!ref.startsWith("#/") || seen.has(ref)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(ref);
  let current: unknown = root;
  for (const segment of ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return resolveRefs(root, current, nextSeen, 0);
}

function resolveRefs(
  root: unknown,
  node: unknown,
  seen: ReadonlySet<string>,
  depth: number,
): unknown {
  if (depth > MAX_REF_DEPTH) return node;
  if (!isRecord(node) && !Array.isArray(node)) return node;
  if (Array.isArray(node)) return node.map((item) => resolveRefs(root, item, seen, depth + 1));
  const record = node as Record<string, unknown>;
  const ref = record.$ref;
  if (typeof ref === "string") {
    if (!ref.startsWith("#/")) return { $ref: ref };
    const resolved = resolveLocalRef(root, ref, seen);
    if (resolved === undefined) return { $ref: ref };
    const siblings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== "$ref") siblings[key] = value;
    }
    return isRecord(resolved) ? { ...resolved, ...siblings } : resolved;
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key] = resolveRefs(root, value, seen, depth + 1);
  }
  return next;
}

/** Leaf field paths of a JSON-schema-ish node: objects recurse with dots, arrays add `[]`. */
function flattenFields(node: unknown, prefix: string, out: Map<string, string>): void {
  if (!isRecord(node)) {
    if (prefix) out.set(prefix, JSON.stringify(summarize(node)));
    return;
  }
  const properties = node.properties;
  if (isRecord(properties)) {
    const keys = Object.keys(properties);
    if (keys.length === 0) {
      if (prefix) out.set(prefix, JSON.stringify(summarize(node)));
      return;
    }
    for (const key of keys) {
      flattenFields(
        (properties as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key,
        out,
      );
    }
    return;
  }
  if (node.type === "array" && node.items !== undefined) {
    flattenFields(node.items, `${prefix}[]`, out);
    return;
  }
  const composed = ["allOf", "oneOf", "anyOf"]
    .filter((key) => Array.isArray(node[key]))
    .flatMap((key) => node[key] as unknown[]);
  if (composed.length > 0) {
    for (const branch of composed) flattenFields(branch, prefix, out);
    return;
  }
  if (prefix) out.set(prefix, JSON.stringify(summarize(node)));
}

function requestSchemaOf(operation: unknown): unknown {
  if (!isRecord(operation)) return undefined;
  const requestBody = operation.requestBody;
  if (!isRecord(requestBody)) return undefined;
  const content = requestBody.content;
  if (!isRecord(content)) return undefined;
  const media = content["application/json"] ?? content["application/problem+json"];
  if (!isRecord(media)) {
    const first = Object.values(content).find(isRecord);
    if (!first) return undefined;
    return (first as Record<string, unknown>).schema;
  }
  return (media as Record<string, unknown>).schema;
}

function eventOperations(section: unknown): Map<string, unknown> {
  const events = new Map<string, unknown>();
  if (!isRecord(section)) return events;
  for (const [eventType, item] of Object.entries(section)) {
    if (!isRecord(item)) continue;
    for (const key of Object.keys(item)) {
      if (!METHODS.includes(key.toLowerCase())) continue;
      // First HTTP method wins per event (webhook items carry one operation).
      if (!events.has(eventType)) events.set(eventType, (item as Record<string, unknown>)[key]);
    }
  }
  return events;
}

/** `webhooks:` wins over legacy `x-webhooks:` per event key. */
function extractWebhookEvents(doc: unknown): Map<string, unknown> {
  if (!isRecord(doc)) return new Map();
  const legacy = eventOperations(doc["x-webhooks"]);
  const current = eventOperations(doc["webhooks"]);
  return new Map([...legacy, ...current]);
}

function eventFields(root: unknown, operation: unknown): Map<string, string> {
  const resolved = resolveRefs(root, requestSchemaOf(operation), new Set(), 0);
  const fields = new Map<string, string>();
  if (resolved !== undefined) flattenFields(resolved, "", fields);
  return fields;
}

/**
 * Diff webhook payload schemas between two specs. One fact per added, removed,
 * or field-changed event; unchanged events emit nothing. Renames pair a
 * removed and an added field with byte-identical shape summaries (greedy,
 * sorted — deterministic, never inferred across differing shapes).
 */
export function diffWebhookPayloads(before: unknown, after: unknown): WebhookPayloadDiffFacts[] {
  const beforeEvents = extractWebhookEvents(before);
  const afterEvents = extractWebhookEvents(after);
  const eventTypes = [...new Set([...beforeEvents.keys(), ...afterEvents.keys()])].sort();
  const facts: WebhookPayloadDiffFacts[] = [];
  for (const eventType of eventTypes) {
    const beforeFields = eventFields(before, beforeEvents.get(eventType));
    const afterFields = eventFields(after, afterEvents.get(eventType));
    const removed = [...beforeFields.keys()].filter((field) => !afterFields.has(field)).sort();
    const added = [...afterFields.keys()].filter((field) => !beforeFields.has(field)).sort();
    const renamedFields: WebhookFieldRename[] = [];
    const consumedAdded = new Set<string>();
    for (const from of removed) {
      const match = added.find(
        (to) => !consumedAdded.has(to) && beforeFields.get(from) === afterFields.get(to),
      );
      if (match !== undefined) {
        consumedAdded.add(match);
        renamedFields.push({ from, to: match });
      }
    }
    const renamedFrom = new Set(renamedFields.map((rename) => rename.from));
    const removedFields = removed.filter((field) => !renamedFrom.has(field));
    const addedFields = added.filter((field) => !consumedAdded.has(field));
    renamedFields.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (removedFields.length === 0 && addedFields.length === 0 && renamedFields.length === 0) {
      continue;
    }
    facts.push({
      eventType,
      addedFields,
      removedFields,
      renamedFields,
      breaking: removedFields.length > 0 || renamedFields.length > 0,
    });
  }
  return facts;
}
