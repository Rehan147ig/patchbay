import { ImpactStatus, RiskLevel, RiskTag, Severity, type UsageType } from "@patchbay/domain";
import type { NormalizedChangeDraft } from "./types";

/**
 * Deterministic impact scoring for a vendor change against one repository's usage
 * inventory. Produces the values persisted on `ImpactAssessment`:
 * impact score 0-100, confidence 0-100, risk level, status, and a human-readable
 * rationale. Pure and DB-free so it is unit-testable.
 *
 * Scoring model (documented so it stays reviewable):
 * - base 25 when any usage is affected
 * - +20 per distinct changed symbol group that matched (cap +50)
 * - +5 per additional affected usage beyond the first (cap +15)
 * - +10 when a matched normalization is breaking
 * - +10 when any affected usage carries a high-risk tag (PAYMENT/AUTH/PII/INFRASTRUCTURE)
 * - confidence 92 for exact symbol matches, 78 when only prefix matches
 * - risk level: HIGH for AUTH/PAYMENT/PII/INFRASTRUCTURE tags, else MEDIUM when
 *   breaking or WEBHOOK-tagged, else LOW
 */

export interface ImpactScoringUsage {
  id: string;
  symbol: string;
  usageType: UsageType;
  riskTags: RiskTag[];
}

export interface ImpactScoringInput {
  vendorSlug: string;
  repositoryName: string;
  severity: Severity;
  normalizations: NormalizedChangeDraft[];
  usages: ImpactScoringUsage[];
}

export interface ImpactDraft {
  status: ImpactStatus;
  score: number;
  confidence: number;
  riskLevel: RiskLevel;
  rationale: string;
  affectedUsageIds: string[];
  /** Symbols from the change that matched at least one usage. */
  matchedSymbols: string[];
}

const HIGH_RISK_TAGS: readonly RiskTag[] = [
  RiskTag.PAYMENT,
  RiskTag.AUTH,
  RiskTag.PII,
  RiskTag.INFRASTRUCTURE,
];

function matchKind(symbol: string, affectedSymbols: string[]): "exact" | "prefix" | "none" {
  for (const affected of affectedSymbols) {
    if (symbol === affected) return "exact";
    if (symbol.startsWith(`${affected}.`)) return "prefix";
  }
  return "none";
}

export function assessImpact(input: ImpactScoringInput): ImpactDraft {
  const { vendorSlug, repositoryName, severity, normalizations, usages } = input;

  if (usages.length === 0) {
    return {
      status: ImpactStatus.NOT_AFFECTED,
      score: 0,
      confidence: 100,
      riskLevel: RiskLevel.LOW,
      rationale: `No tracked usages of ${vendorSlug} in ${repositoryName}.`,
      affectedUsageIds: [],
      matchedSymbols: [],
    };
  }

  const affectedSymbols = [
    ...new Set(normalizations.flatMap((normalization) => normalization.affectedSymbols)),
  ].filter((symbol) => symbol.length > 0);

  const affectedUsageIds: string[] = [];
  const matchedSymbols = new Set<string>();
  let prefixOnlyCount = 0;
  const matchedNormalizations: NormalizedChangeDraft[] = [];

  for (const usage of usages) {
    const kind = matchKind(usage.symbol, affectedSymbols);
    if (kind === "none") continue;
    affectedUsageIds.push(usage.id);
    const matched = affectedSymbols.filter((symbol) => usage.symbol.startsWith(symbol));
    for (const symbol of matched) matchedSymbols.add(symbol);
    if (kind === "prefix") {
      prefixOnlyCount += 1;
    }
  }

  if (affectedUsageIds.length === 0) {
    return {
      status: ImpactStatus.NOT_AFFECTED,
      score: 0,
      confidence: 100,
      riskLevel: RiskLevel.LOW,
      rationale: `${usages.length} tracked usage(s) of ${vendorSlug} in ${repositoryName}; none reference the changed methods.`,
      affectedUsageIds: [],
      matchedSymbols: [],
    };
  }

  for (const normalization of normalizations) {
    if (
      normalization.affectedSymbols.some((symbol) =>
        [...matchedSymbols].some((matched) => matched.startsWith(symbol)),
      )
    ) {
      matchedNormalizations.push(normalization);
    }
  }

  const affectedUsages = usages.filter((usage) => affectedUsageIds.includes(usage.id));
  const affectedTags = new Set(affectedUsages.flatMap((usage) => usage.riskTags));

  let score = 25;
  score += Math.min(50, matchedSymbols.size * 20);
  score += Math.min(15, Math.max(0, affectedUsageIds.length - 1) * 5);
  if (matchedNormalizations.some((normalization) => normalization.breaking)) score += 10;
  if ([...affectedTags].some((tag) => HIGH_RISK_TAGS.includes(tag))) score += 10;
  score = Math.min(100, score);

  const exactOnly = prefixOnlyCount === 0;
  const status = exactOnly ? ImpactStatus.AFFECTED : ImpactStatus.POSSIBLY_AFFECTED;
  const confidence = exactOnly ? 92 : 78;

  const hasHighRisk = [...affectedTags].some((tag) => HIGH_RISK_TAGS.includes(tag));
  const riskLevel = hasHighRisk
    ? RiskLevel.HIGH
    : matchedNormalizations.some((normalization) => normalization.breaking) ||
        affectedTags.has(RiskTag.WEBHOOK)
      ? RiskLevel.MEDIUM
      : RiskLevel.LOW;

  const symbolList = [...matchedSymbols].sort().join(", ");
  const parts = [
    `${affectedUsageIds.length} of ${usages.length} usage(s) of ${vendorSlug} in ${repositoryName} affected (${symbolList}).`,
  ];
  const breakingNote = matchedNormalizations.filter(
    (normalization) => normalization.breaking && normalization.affectedSymbols.length > 0,
  );
  if (breakingNote.length > 0) {
    parts.push("Includes breaking change(s).");
  }
  if (affectedTags.size > 0) {
    parts.push(`Affected usages carry risk: ${[...affectedTags].sort().join(", ")}.`);
  }
  if (severity === Severity.HIGH || severity === Severity.CRITICAL) {
    parts.push("Change event severity is high.");
  }

  return {
    status,
    score,
    confidence,
    riskLevel,
    rationale: parts.join(" "),
    affectedUsageIds,
    matchedSymbols: [...matchedSymbols],
  };
}
