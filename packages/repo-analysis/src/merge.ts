import type { GraphExtraction, GraphNodeFact, GraphEdgeFact } from "./graph";

/**
 * Merges a baseline extraction with an incremental extraction so the result
 * equals a clean full extraction for meaningful nodes and edges.
 *
 * Ownership rules (proven by the comparator corpus):
 *  - A node is owned by the incremental extraction when its own file OR any of
 *    its evidence files was re-extracted; otherwise it is kept from baseline.
 *  - An edge is generated from the source file's code (imports/calls/usage
 *    originate in `fromKey`'s file), so it is owned by the incremental
 *    extraction when the source file was re-extracted; otherwise it is kept
 *    from baseline provided both endpoint nodes survive the merge.
 */
export function mergeIncrementalExtraction(
  baseline: GraphExtraction,
  incremental: GraphExtraction,
  reextract: Set<string>,
): GraphExtraction {
  const incrementalNodeKeys = new Set(incremental.nodeFacts.map((node) => node.key));
  const incrementalEdgeKeys = new Set(incremental.edgeFacts.map((edge) => edge.key));

  const baselineNodeByKey = new Map(baseline.nodeFacts.map((node) => [node.key, node]));

  const reextractedByNode = new Map<string, boolean>();
  const isReextractedNode = (node: GraphNodeFact): boolean => {
    if (node.filePath !== null && reextract.has(node.filePath)) return true;
    return node.evidence.some((evidence) => reextract.has(evidence.filePath));
  };

  const nodes = new Map<string, GraphNodeFact>();
  const edges = new Map<string, GraphEdgeFact>();
  const errors = [...baseline.errors, ...incremental.errors];
  const reextractedNodeKeys = new Set<string>();

  for (const node of baseline.nodeFacts) {
    const reextracted = isReextractedNode(node);
    reextractedByNode.set(node.key, reextracted);
    if (reextracted) {
      reextractedNodeKeys.add(node.key);
      continue;
    }
    if (incrementalNodeKeys.has(node.key)) continue;
    nodes.set(node.key, node);
  }
  for (const node of incremental.nodeFacts) {
    nodes.set(node.key, node);
  }

  for (const edge of baseline.edgeFacts) {
    const source = baselineNodeByKey.get(edge.fromKey);
    const target = baselineNodeByKey.get(edge.toKey);
    if (incrementalEdgeKeys.has(edge.key)) continue;
    if (source === undefined || target === undefined) continue;
    // Edges originate in the source file's code: when the source file was
    // re-extracted, the incremental extraction owns them; when it was not,
    // the baseline edge is still accurate as long as its target survives.
    const sourceReextracted = reextractedByNode.get(source.key) ?? isReextractedNode(source);
    if (sourceReextracted) continue;
    if (!nodes.has(source.key) || !nodes.has(target.key)) continue;
    edges.set(edge.key, edge);
  }
  for (const edge of incremental.edgeFacts) {
    if (!nodes.has(edge.fromKey) || !nodes.has(edge.toKey)) continue;
    edges.set(edge.key, edge);
  }

  return {
    commitSha: incremental.commitSha,
    rootTreeHash: incremental.rootTreeHash,
    nodeFacts: [...nodes.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edgeFacts: [...edges.values()].sort((a, b) => a.key.localeCompare(b.key)),
    errors: dedupeErrors(errors),
  };
}

function dedupeErrors(errors: GraphExtraction["errors"]): GraphExtraction["errors"] {
  const seen = new Set<string>();
  const out: GraphExtraction["errors"] = [];
  for (const error of errors) {
    const signature = `${error.filePath}:${error.message}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(error);
  }
  return out;
}

/** Node comparison key for the full-vs-incremental comparator corpus. */
export function nodeComparisonKey(node: GraphNodeFact): string {
  return JSON.stringify({
    key: node.key,
    kind: node.kind,
    displayName: node.displayName,
    properties: node.properties,
    contentHash: node.contentHash,
  });
}

/** Edge comparison key for the full-vs-incremental comparator corpus. */
export function edgeComparisonKey(edge: GraphEdgeFact): string {
  return JSON.stringify({
    kind: edge.kind,
    fromKey: edge.fromKey,
    toKey: edge.toKey,
    provenance: edge.provenance,
    confidence: edge.confidence,
  });
}
