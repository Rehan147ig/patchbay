import type { ContractKind } from "@patchbay/domain";
import { GraphNodeKind } from "@patchbay/domain";
import type { GraphExtraction } from "./graph";

/**
 * Contract-consumer mapping (WP3): derives ContractConsumer descriptors from
 * graph facts. Pure and DB-free — WP4 orchestration resolves contractSourceId,
 * organizationId, repositoryId, and graphSnapshotId at write time.
 *
 * One descriptor per graph node (node keys are unique per extraction), bound
 * to the pinned commit SHA, source region hashes, and extractor identity
 * carried by the node's own evidence (spec §6.1).
 */

export interface ConsumerEvidence {
  commitSha: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  sourceHash: string;
  extractor: string;
  extractorVersion: string;
}

export interface ContractConsumerDescriptor {
  contractKind: ContractKind;
  /** Stable within the repo: package name, MCP server name, or "METHOD /path". */
  identifier: string;
  /** Declared range or pinned version; null when statically unknown. */
  versionRange: string | null;
  /** 0-100; resolution-pinned evidence scores higher than syntactic evidence. */
  confidence: number;
  evidenceJson: ConsumerEvidence;
}

export interface ConsumerMappingInput {
  extraction: GraphExtraction;
  /**
   * Package name -> contract kind for SDK dependencies. Only packages listed
   * here become consumers: a bare DEPENDENCY node (express, pino) is not a
   * contract by itself — the caller (registry-aware orchestration) decides
   * which packages are contracts.
   */
  sdkKinds: Map<string, ContractKind>;
}

export function contractConsumersFromExtraction(
  input: ConsumerMappingInput,
): ContractConsumerDescriptor[] {
  const { extraction, sdkKinds } = input;
  const consumers: ContractConsumerDescriptor[] = [];

  const evidenceOf = (
    filePath: string | null,
    startLine: number | null,
    endLine: number | null,
    sourceHash: string,
    extractor: string,
    extractorVersion: string,
  ): ConsumerEvidence => ({
    commitSha: extraction.commitSha,
    filePath,
    startLine,
    endLine,
    sourceHash,
    extractor,
    extractorVersion,
  });

  for (const node of extraction.nodeFacts) {
    const primary = node.evidence[0];
    const base = evidenceOf(
      node.filePath,
      node.startLine,
      node.endLine,
      primary?.sourceHash ?? "",
      primary?.extractor ?? "graph-extractor",
      primary?.extractorVersion ?? "1",
    );
    if (node.kind === GraphNodeKind.DEPENDENCY) {
      const kind = sdkKinds.get(node.displayName);
      if (!kind) continue;
      consumers.push({
        contractKind: kind,
        identifier: node.displayName,
        versionRange: node.properties["resolvedVersion"] || null,
        confidence: node.properties["resolvedVersion"] ? 95 : 70,
        evidenceJson: base,
      });
    } else if (node.kind === GraphNodeKind.MCP_SERVER) {
      consumers.push({
        contractKind: "MCP",
        identifier: node.displayName,
        versionRange: null,
        confidence: 90,
        evidenceJson: base,
      });
    } else if (node.kind === GraphNodeKind.EVENT_HANDLER) {
      consumers.push({
        contractKind: "WEBHOOK",
        identifier: node.displayName,
        versionRange: null,
        confidence: 80,
        evidenceJson: base,
      });
    }
  }

  return consumers.sort((a, b) =>
    `${a.contractKind}:${a.identifier}`.localeCompare(`${b.contractKind}:${b.identifier}`),
  );
}
