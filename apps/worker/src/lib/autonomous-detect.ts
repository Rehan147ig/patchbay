import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@patchbay/db";
import { classifySemverBump, compareVersions, logger } from "@patchbay/domain";
import { buildSemverBumpPatch } from "@patchbay/remediation-engine";
import {
  AUTONOMOUS_GENERIC_SLUG,
  createOsvAdapter,
  fetchNpmLatestVersion,
} from "@patchbay/vendor-connectors";
import { evaluateCasePolicies, upsertRemediationCase } from "./case-ops";
import type { FunnelEvidence } from "./case-funnel";

/**
 * Phase 2b ignition (the switch that wakes the autonomous track).
 *
 * Runs inside the scan job while the repository source is still checked out:
 * every NON-catalog npm direct dependency is diffed against the registry
 * (latest) and OSV (vuln fixes). Patch/minor moves whose manifest edit proves
 * cleanly on the real manifest bytes become POLICY_ELIGIBLE cases through the
 * standard funnel + upsert path — the same cases, events, and audit trail as
 * the certified track.
 *
 * Best-effort by contract: per-dependency failures skip the dependency, and
 * any unexpected failure skips the whole ignition without failing the scan.
 * Draft PRs still require a VALIDATED plan + human approval + the autonomy
 * policy (enforced at both PR vectors).
 */

export interface AutonomousManifest {
  path: string;
  packages: Set<string>;
}

export interface AutonomousDepInput {
  packageName: string;
  installedVersion: string;
}

export interface AutonomousLatestInfo {
  version: string;
  publishedAt: Date | null;
}

export interface AutonomousFetchers {
  fetchLatest(packageName: string): Promise<AutonomousLatestInfo | null>;
  fetchOsvFix(packageName: string, installedVersion: string): Promise<string | null>;
}

export interface AutonomousBumpPlan {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  updateType: "patch" | "minor";
  isVulnFix: boolean;
  publishedAt: Date | null;
  manifestPath: string;
}

export const AUTONOMOUS_MAX_DEPS_PER_SCAN = 50;
export const AUTONOMOUS_MAX_NEW_CASES_PER_SCAN = 10;
const FETCH_CONCURRENCY = 5;

export const realAutonomousFetchers: AutonomousFetchers = {
  fetchLatest: (packageName) => fetchNpmLatestVersion(packageName),
  fetchOsvFix: async (packageName, installedVersion) => {
    const adapter = createOsvAdapter({ ecosystem: "npm", packageName, installedVersion });
    const result = await adapter.fetch();
    let best: string | null = null;
    for (const evidence of result.evidence) {
      const fixed = evidence.metadata?.fixedVersion;
      if (typeof fixed !== "string") continue;
      if (compareVersions(installedVersion, fixed) === null) continue;
      if (best === null || (compareVersions(fixed, best) ?? 0) < 0) {
        best = fixed;
      }
    }
    return best;
  },
};

/**
 * Pure bump planner: picks the target (OSV fix wins over latest), classifies,
 * and proves the manifest edit on real bytes. Returns null for anything that
 * is not a provable patch/minor — majors, unknowns, and unprovable manifests
 * stay PLAN-only, never guessed.
 */
export function planAutonomousBump(
  dep: AutonomousDepInput,
  latest: AutonomousLatestInfo | null,
  osvFixVersion: string | null,
  manifestText: string,
  manifestPath: string,
): AutonomousBumpPlan | null {
  const toVersion = osvFixVersion ?? latest?.version ?? null;
  if (!toVersion) return null;
  const kind = classifySemverBump(dep.installedVersion, toVersion);
  if (kind !== "patch" && kind !== "minor") return null;
  const patch = buildSemverBumpPatch({
    manifestText,
    manifestPath,
    packageName: dep.packageName,
    fromVersion: dep.installedVersion,
    toVersion,
  });
  if (!patch) return null;
  return {
    packageName: dep.packageName,
    fromVersion: dep.installedVersion,
    toVersion,
    updateType: kind,
    isVulnFix: osvFixVersion !== null,
    publishedAt: latest?.publishedAt ?? null,
    manifestPath,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = await Promise.all(items.slice(i, i + concurrency).map(fn));
    results.push(...chunk);
  }
  return results;
}

/**
 * Network phase: latest + OSV fix per dependency, planned against manifest
 * bytes. Deterministic output order (sorted by package name), capped.
 * Per-dependency failures skip the dependency — never throw.
 */
export async function detectAutonomousBumps(
  deps: AutonomousDepInput[],
  manifestTexts: Map<string, string>,
  manifestForPackage: Map<string, string>,
  fetchers: AutonomousFetchers,
  maxPlans: number = AUTONOMOUS_MAX_NEW_CASES_PER_SCAN,
): Promise<AutonomousBumpPlan[]> {
  const ordered = [...deps].sort((a, b) => a.packageName.localeCompare(b.packageName));
  const planned = await mapWithConcurrency(ordered, FETCH_CONCURRENCY, async (dep) => {
    try {
      const manifestPath = manifestForPackage.get(dep.packageName);
      const manifestText = manifestPath ? manifestTexts.get(manifestPath) : undefined;
      if (!manifestPath || manifestText === undefined) return null;
      const [latest, osvFix] = await Promise.all([
        fetchers.fetchLatest(dep.packageName).catch(() => null),
        fetchers.fetchOsvFix(dep.packageName, dep.installedVersion).catch(() => null),
      ]);
      return planAutonomousBump(dep, latest, osvFix, manifestText, manifestPath);
    } catch {
      return null;
    }
  });
  return planned.filter((p): p is AutonomousBumpPlan => p !== null).slice(0, maxPlans);
}

export interface AutonomousIgnitionInput {
  rootDir: string;
  manifests: Array<{
    path: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  }>;
  lockfileVersions: Record<string, string>;
  packageManager: string;
  /** True for catalog-tracked packages (handled by the certified track). */
  isCatalogPackage: (packageName: string) => boolean;
  organizationId: string;
  repositoryId: string;
  commitSha: string;
  correlationId: string;
  fetchers?: AutonomousFetchers;
  maxDeps?: number;
  maxNewCases?: number;
}

export interface AutonomousIgnitionResult {
  considered: number;
  planned: number;
  casesUpserted: number;
}

function readManifestTexts(rootDir: string, paths: string[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const manifestPath of paths) {
    if (!manifestPath.endsWith("package.json")) continue;
    try {
      texts.set(manifestPath, readFileSync(join(rootDir, manifestPath), "utf8"));
    } catch {
      // Unreadable manifest: its packages simply get no plans this scan.
    }
  }
  return texts;
}

/**
 * Full ignition: detect plans, then persist vendor/product/release/match/case
 * rows through the standard case pipeline. Best-effort — returns counts and
 * never throws (the scan must not fail because the ignition did).
 */
export async function runAutonomousIgnition(
  input: AutonomousIgnitionInput,
): Promise<AutonomousIgnitionResult> {
  const zeros = { considered: 0, planned: 0, casesUpserted: 0 };
  try {
    if (!["pnpm", "npm", "yarn"].includes(input.packageManager)) return zeros;

    const manifestForPackage = new Map<string, string>();
    for (const manifest of input.manifests ?? []) {
      if (typeof manifest?.path !== "string" || !manifest.path.endsWith("package.json")) continue;
      for (const pkg of [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]) {
        if (!manifestForPackage.has(pkg)) manifestForPackage.set(pkg, manifest.path);
      }
    }

    const deps: AutonomousDepInput[] = [];
    for (const packageName of manifestForPackage.keys()) {
      if (input.isCatalogPackage(packageName)) continue;
      const installedVersion = input.lockfileVersions[packageName];
      if (!installedVersion) continue;
      deps.push({ packageName, installedVersion });
    }
    const considered = deps.slice(0, input.maxDeps ?? AUTONOMOUS_MAX_DEPS_PER_SCAN);
    if (considered.length === 0) return zeros;

    const manifestTexts = readManifestTexts(input.rootDir, [
      ...new Set(input.manifests.map((m) => m.path)),
    ]);
    const plans = await detectAutonomousBumps(
      considered,
      manifestTexts,
      manifestForPackage,
      input.fetchers ?? realAutonomousFetchers,
      input.maxNewCases ?? AUTONOMOUS_MAX_NEW_CASES_PER_SCAN,
    );
    if (plans.length === 0) return { considered: considered.length, planned: 0, casesUpserted: 0 };

    const vendor = await prisma.vendor.upsert({
      where: { slug: AUTONOMOUS_GENERIC_SLUG },
      update: {},
      create: {
        slug: AUTONOMOUS_GENERIC_SLUG,
        name: "Autonomous Generic",
        category: "Platform",
        organizationId: null,
        enabled: true,
      },
    });

    const policies = await prisma.policy.findMany({
      where: { organizationId: input.organizationId, enabled: true },
    });
    const policyEvaluation = evaluateCasePolicies(
      policies.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        definitionJson: (p.definitionJson ?? {}) as {
          when?: { riskTags?: string[]; vendor?: string; validationStatus?: string };
          then?: string;
          reason?: string;
        },
      })),
      { riskTags: [], vendor: AUTONOMOUS_GENERIC_SLUG, validationStatus: "QUEUED" },
    );

    let casesUpserted = 0;
    for (const plan of plans) {
      try {
        const product = await prisma.vendorProduct.upsert({
          where: {
            vendorId_ecosystem_packageName: {
              vendorId: vendor.id,
              ecosystem: "npm",
              packageName: plan.packageName,
            },
          },
          update: {},
          create: { vendorId: vendor.id, ecosystem: "npm", packageName: plan.packageName },
        });
        const contentHash = createHash("sha256")
          .update(`autonomous-npm:${plan.packageName}:${plan.fromVersion}:${plan.toVersion}`)
          .digest("hex");
        let release = await prisma.releaseRecord.findFirst({
          where: {
            source: "NPM",
            productId: product.id,
            version: plan.toVersion,
            contentHash,
          },
        });
        if (!release) {
          release = await prisma.releaseRecord.create({
            data: {
              productId: product.id,
              source: "NPM",
              version: plan.toVersion,
              previousVersion: plan.fromVersion,
              // Detection-time fallback is fail-safe young: unknown publish
              // dates wait out the minimum-age gate; CVE fixes bypass via
              // vulnBypassStability at PR time.
              publishedAt: plan.publishedAt ?? new Date(),
              canonicalUrl: `https://www.npmjs.com/package/${plan.packageName}/v/${plan.toVersion}`,
              contentHash,
              authenticity: "SOURCE_TRUSTED",
              status: "OBSERVED",
            },
          });
        }
        const dependency = await prisma.repositoryDependency.findUnique({
          where: {
            repositoryId_packageName_commitSha: {
              repositoryId: input.repositoryId,
              packageName: plan.packageName,
              commitSha: input.commitSha,
            },
          },
        });
        if (!dependency) continue;
        const match = await prisma.releaseRepositoryMatch.upsert({
          where: {
            releaseRecordId_repositoryId_dependencyId: {
              releaseRecordId: release.id,
              repositoryId: input.repositoryId,
              dependencyId: dependency.id,
            },
          },
          update: {},
          create: {
            releaseRecordId: release.id,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            dependencyId: dependency.id,
            matchReason: plan.isVulnFix ? "autonomous-bump:osv-fix" : "autonomous-bump:semver",
            affectedVersionRange: dependency.declaredRange,
            status: "CANDIDATE",
          },
        });
        const evidence: FunnelEvidence = {
          hasClassification: false,
          breaking: false,
          affectedUsageCount: 0,
          ownerCount: 0,
          riskTags: [],
          hasSnapshot: false,
          declaredRange: dependency.declaredRange,
          releaseVersion: plan.toVersion,
          autonomousBump: { updateType: plan.updateType, sandboxValidated: true },
        };
        await upsertRemediationCase(
          {
            organizationId: input.organizationId,
            releaseId: release.id,
            repositoryId: input.repositoryId,
            dependencyId: dependency.id,
            matchId: match.id,
            snapshotId: null,
            vendorSlug: AUTONOMOUS_GENERIC_SLUG,
            correlationId: input.correlationId,
          },
          evidence,
          true,
          policyEvaluation,
          input.correlationId,
        );
        casesUpserted += 1;
      } catch (error) {
        logger.warn("autonomous ignition skipped a package", {
          packageName: plan.packageName,
          error: String(error),
        });
      }
    }
    return { considered: considered.length, planned: plans.length, casesUpserted };
  } catch (error) {
    logger.warn("autonomous ignition failed without failing the scan", {
      error: String(error),
    });
    return zeros;
  }
}
