import { Prisma } from "@prisma/client";
import { GraphNodeKind } from "@patchbay/domain";
import { prisma } from "./client";

/**
 * Tenant-scoped graph read model (Phase D).
 *
 * Every query is bounded by (organizationId, repositoryId), only ever reads
 * READY snapshots, caps result sizes, and records traversal timing so
 * PostgreSQL graph latency (p95) is measurable before any graph database is
 * considered. Returned objects are plain serializable values, so route
 * handlers can hand them to the client without transformation.
 */

/** Hard cap on impacted modules returned for one package impact query. */
export const MAX_IMPACT_MODULES = 200;
/** Hard cap on impacted modules counted in one impact query. */
const MAX_EVIDENCE_COUNT_LOOKUPS = 200;

/**
 * Query timing ring buffer: records per-query durations so operators can
 * measure PostgreSQL graph p95 without external tooling.
 */
const QUERY_SAMPLES = 512;
const querySamples = new Map<string, number[]>();
let sampleCount = 0;

function recordQuery(name: string, startedAt: number): void {
  const elapsed = Date.now() - startedAt;
  let samples = querySamples.get(name);
  if (!samples) {
    samples = [];
    querySamples.set(name, samples);
  }
  samples.push(elapsed);
  if (samples.length > QUERY_SAMPLES) samples.shift();
  sampleCount += 1;
}

/** p95 latency (ms) for a query name over the last QUERY_SAMPLES calls. */
export function graphQueryP95(name: string): number | null {
  const samples = querySamples.get(name);
  if (!samples || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index]!;
}

/** All recorded query p95 latencies plus total samples. */
export function graphQueryMetrics(): Record<string, { p95: number | null; samples: number }> {
  const metrics: Record<string, { p95: number | null; samples: number }> = {};
  for (const [name, samples] of querySamples) {
    metrics[name] = { p95: graphQueryP95(name), samples: samples.length };
  }
  metrics._total = { p95: null, samples: sampleCount };
  return metrics;
}

export interface SnapshotSummary {
  id: string;
  status: "INDEXING" | "READY" | "FAILED";
  commitSha: string;
  rootTreeHash: string;
  sourceHash: string | null;
  nodesAffected: number;
  edgesAffected: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ImpactedModule {
  filePath: string;
  edgeKinds: string[];
  evidenceCount: number;
}

export interface PackageImpact {
  packageName: string;
  resolvedVersion: string | null;
  declaredRanges: string;
  clientCount: number;
  apiOperationCount: number;
  modules: ImpactedModule[];
  snapshotId: string;
}

interface GraphNodeRow {
  id: string;
  kind: GraphNodeKind;
  stableKey: string;
  displayName: string;
  filePath: string | null;
  propertiesJson: Prisma.JsonValue | null;
}

interface GraphEdgeRow {
  id: string;
  kind: string;
  fromNodeId: string;
  toNodeId: string;
}

const NODE_SELECT = {
  id: true,
  kind: true,
  stableKey: true,
  displayName: true,
  filePath: true,
  propertiesJson: true,
} as const;

const EDGE_SELECT = {
  id: true,
  kind: true,
  fromNodeId: true,
  toNodeId: true,
} as const;

export async function latestSnapshot(args: {
  organizationId: string;
  repositoryId: string;
}): Promise<SnapshotSummary | null> {
  const started = Date.now();
  try {
    return await prisma.graphSnapshot.findFirst({
      where: { ...args, status: "READY" },
      select: {
        id: true,
        status: true,
        commitSha: true,
        rootTreeHash: true,
        sourceHash: true,
        nodesAffected: true,
        edgesAffected: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { completedAt: "desc" },
    });
  } finally {
    recordQuery("latestSnapshot", started);
  }
}

export async function impactByKind(args: {
  organizationId: string;
  repositoryId: string;
  kinds: GraphNodeKind[];
}): Promise<Array<{ kind: GraphNodeKind; count: number }>> {
  const started = Date.now();
  try {
    const rows = await prisma.graphNode.groupBy({
      by: ["kind"],
      where: {
        organizationId: args.organizationId,
        repositoryId: args.repositoryId,
        kind: { in: args.kinds },
        snapshot: { status: "READY" },
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({ kind: row.kind, count: row._count._all }));
  } finally {
    recordQuery("impactByKind", started);
  }
}

/**
 * Impact of one package on one repository at its latest READY snapshot:
 * the resolved package the repository pins, every module that uses it, and
 * evidence density per module. Everything is derived from graph edges, so
 * "why is this repository affected" always has a graph answer.
 */
export async function packageImpact(args: {
  organizationId: string;
  repositoryId: string;
  packageName: string;
}): Promise<PackageImpact | null> {
  const started = Date.now();
  try {
    const { organizationId, repositoryId, packageName } = args;
    const snapshot = await prisma.graphSnapshot.findFirst({
      where: { organizationId, repositoryId, status: "READY" },
      select: { id: true, nodes: true, edges: true, evidence: true },
      orderBy: { completedAt: "desc" },
    });
    if (!snapshot) return null;
    const snapshotId = snapshot.id;

    const dependency = await findNode({
      where: {
        organizationId,
        repositoryId,
        snapshotId,
        kind: GraphNodeKind.DEPENDENCY,
        stableKey: `dep:${packageName}`,
      },
    });
    if (!dependency) return null;

    const properties = asRecord(dependency.propertiesJson);
    const depId = dependency.id;

    const [usesEdges, clientEdges, apiNodes] = await Promise.all([
      findEdges({
        where: { organizationId, repositoryId, snapshotId, kind: "USES_PACKAGE", toNodeId: depId },
      }),
      findEdges({ where: { organizationId, repositoryId, snapshotId, kind: "CREATES_CLIENT" } }),
      findNodes({
        where: {
          organizationId,
          repositoryId,
          snapshotId,
          kind: GraphNodeKind.API_OPERATION,
          propertiesJson: { path: ["packageName"], equals: packageName },
        },
      }),
    ]);

    let apiEdges: GraphEdgeRow[] = [];
    if (apiNodes.length > 0) {
      apiEdges = await findEdges({
        where: {
          organizationId,
          repositoryId,
          snapshotId,
          kind: "INVOKES_API",
          toNodeId: { in: apiNodes.map((node) => node.id) },
        },
      });
    }

    const clientIds = clientEdges.map((edge) => edge.toNodeId);
    const resolvers = clientIds.length
      ? await findEdges({
          where: {
            organizationId,
            repositoryId,
            snapshotId,
            kind: "RESOLVES_TO",
            fromNodeId: { in: clientIds },
            toNodeId: depId,
          },
        })
      : [];
    const resolvingClientIds = new Set(resolvers.map((edge) => edge.fromNodeId));

    const moduleIds = new Set<string>();
    const edgeKindsByModule = new Map<string, Set<string>>();
    for (const edge of [...usesEdges, ...apiEdges]) {
      moduleIds.add(edge.fromNodeId);
      addEdgeKind(edgeKindsByModule, edge.fromNodeId, edge.kind);
    }
    for (const edge of clientEdges) {
      if (resolvingClientIds.has(edge.toNodeId)) {
        moduleIds.add(edge.fromNodeId);
        addEdgeKind(edgeKindsByModule, edge.fromNodeId, "CREATES_CLIENT");
      }
    }

    const modules: ImpactedModule[] = [];
    if (moduleIds.size > 0) {
      const moduleNodes = await findNodes({
        where: {
          organizationId,
          repositoryId,
          snapshotId,
          id: { in: [...moduleIds] },
          kind: GraphNodeKind.MODULE,
        },
        take: MAX_IMPACT_MODULES,
      });
      for (const moduleNode of moduleNodes) {
        if (modules.length >= MAX_EVIDENCE_COUNT_LOOKUPS) break;
        const evidenceCount = await prisma.graphSourceEvidence.count({
          where: { organizationId, snapshotId, nodeId: moduleNode.id },
        });
        modules.push({
          filePath: moduleNode.filePath ?? moduleNode.displayName,
          edgeKinds: [...(edgeKindsByModule.get(moduleNode.id) ?? [])].sort(),
          evidenceCount,
        });
      }
      modules.sort((a, b) => a.filePath.localeCompare(b.filePath));
    }

    return {
      packageName,
      resolvedVersion: properties.resolvedVersion ?? null,
      declaredRanges: properties.declaredRanges ?? "",
      clientCount: resolvingClientIds.size,
      apiOperationCount: apiNodes.length,
      modules,
      snapshotId,
    };
  } finally {
    recordQuery("packageImpact", started);
  }
}

async function findNode(args: { where: object }): Promise<GraphNodeRow | null> {
  const row = await prisma.graphNode.findFirst({
    ...args,
    select: NODE_SELECT,
  });
  return row as unknown as GraphNodeRow | null;
}

async function findNodes(args: { where: object; take?: number }): Promise<GraphNodeRow[]> {
  const rows = await prisma.graphNode.findMany({
    ...args,
    select: NODE_SELECT,
  });
  return rows as unknown as GraphNodeRow[];
}

async function findEdges(args: { where: object }): Promise<GraphEdgeRow[]> {
  const rows = await prisma.graphEdge.findMany({
    ...args,
    select: EDGE_SELECT,
  });
  return rows as unknown as GraphEdgeRow[];
}

function addEdgeKind(map: Map<string, Set<string>>, nodeId: string, kind: string): void {
  const set = map.get(nodeId);
  if (set) set.add(kind);
  else map.set(nodeId, new Set([kind]));
}

function asRecord(value: Prisma.JsonValue | null): Record<string, string> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  return {};
}
