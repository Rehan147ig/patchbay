import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectAutonomousBumps,
  planAutonomousBump,
  runAutonomousIgnition,
  type AutonomousFetchers,
} from "./autonomous-detect";

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { upsert: vi.fn() },
    policy: { findMany: vi.fn() },
    vendorProduct: { upsert: vi.fn() },
    releaseRecord: { findFirst: vi.fn(), create: vi.fn() },
    repositoryDependency: { findUnique: vi.fn() },
    releaseRepositoryMatch: { upsert: vi.fn() },
    remediationCase: { findUnique: vi.fn(), upsert: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  createNotification: vi.fn(),
  NotificationType: { CASE_CREATED: "case.created" },
}));

vi.mock("./audit", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("@patchbay/domain", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/domain")>("@patchbay/domain");
  return { ...actual, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});

import { prisma } from "@patchbay/db";

const MANIFEST = `{
  "name": "acme-web",
  "dependencies": {
    "lodash": "^4.17.20",
    "react": "~18.2.0"
  }
}
`;

const stubFetchers = (
  latest: Record<string, string>,
  osvFix: Record<string, string> = {},
): AutonomousFetchers => ({
  fetchLatest: async (packageName: string) => {
    const version = latest[packageName];
    return version ? { version, publishedAt: new Date("2024-01-15T00:00:00Z") } : null;
  },
  fetchOsvFix: async (packageName: string) => osvFix[packageName] ?? null,
});

describe("planAutonomousBump", () => {
  it("plans provable patch/minor bumps on real manifest bytes", () => {
    const patch = planAutonomousBump(
      { packageName: "lodash", installedVersion: "4.17.20" },
      { version: "4.17.21", publishedAt: null },
      null,
      MANIFEST,
      "package.json",
    );
    expect(patch).toMatchObject({
      packageName: "lodash",
      fromVersion: "4.17.20",
      toVersion: "4.17.21",
      updateType: "patch",
      isVulnFix: false,
    });
  });

  it("prefers the OSV fix version and marks vuln fixes", () => {
    const plan = planAutonomousBump(
      { packageName: "lodash", installedVersion: "4.17.20" },
      { version: "4.18.0", publishedAt: null },
      "4.17.21",
      MANIFEST,
      "package.json",
    );
    expect(plan).toMatchObject({ toVersion: "4.17.21", updateType: "patch", isVulnFix: true });
  });

  it("refuses majors, unknowns, and unprovable manifests", () => {
    expect(
      planAutonomousBump(
        { packageName: "react", installedVersion: "18.2.0" },
        { version: "19.0.0", publishedAt: null },
        null,
        MANIFEST,
        "package.json",
      ),
    ).toBeNull();
    expect(
      planAutonomousBump(
        { packageName: "lodash", installedVersion: "4.17.20" },
        { version: "latest", publishedAt: null },
        null,
        MANIFEST,
        "package.json",
      ),
    ).toBeNull();
    expect(
      planAutonomousBump(
        { packageName: "no-such-pkg", installedVersion: "1.0.0" },
        { version: "1.0.1", publishedAt: null },
        null,
        MANIFEST,
        "package.json",
      ),
    ).toBeNull();
  });
});

describe("detectAutonomousBumps", () => {
  it("detects in deterministic order, skips failures, and caps plans", async () => {
    const fetchers = stubFetchers({ lodash: "4.17.21", react: "19.0.0", "left-pad": "1.3.1" });
    const manifests = new Map([["package.json", MANIFEST]]);
    const forPackage = new Map([
      ["lodash", "package.json"],
      ["react", "package.json"],
      ["left-pad", "package.json"],
    ]);
    const plans = await detectAutonomousBumps(
      [
        { packageName: "react", installedVersion: "18.2.0" },
        { packageName: "lodash", installedVersion: "4.17.20" },
      ],
      manifests,
      forPackage,
      fetchers,
    );
    // react 19 is major (skipped); lodash patch planned.
    expect(plans.map((p) => p.packageName)).toEqual(["lodash"]);

    const throwing: AutonomousFetchers = {
      fetchLatest: async () => {
        throw new Error("registry down");
      },
      fetchOsvFix: async () => {
        throw new Error("osv down");
      },
    };
    const none = await detectAutonomousBumps(
      [{ packageName: "lodash", installedVersion: "4.17.20" }],
      manifests,
      forPackage,
      throwing,
    );
    expect(none).toEqual([]);
  });
});

describe("runAutonomousIgnition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.vendor.upsert).mockResolvedValue({ id: "v-auto" } as never);
    vi.mocked(prisma.policy.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.vendorProduct.upsert).mockResolvedValue({ id: "p-1" } as never);
    vi.mocked(prisma.releaseRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.releaseRecord.create).mockResolvedValue({ id: "r-1" } as never);
    vi.mocked(prisma.repositoryDependency.findUnique).mockResolvedValue({
      id: "d-1",
      declaredRange: "^4.17.20",
    } as never);
    vi.mocked(prisma.releaseRepositoryMatch.upsert).mockResolvedValue({ id: "m-1" } as never);
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.remediationCase.upsert).mockResolvedValue({
      id: "c-1",
      status: "POLICY_ELIGIBLE",
    } as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
  });

  const baseInput = {
    rootDir: "C:/repo",
    manifests: [
      {
        path: "package.json",
        dependencies: { lodash: "^4.17.20", react: "~18.2.0" },
        devDependencies: {},
      },
    ],
    lockfileVersions: { lodash: "4.17.20", react: "18.2.0" },
    packageManager: "pnpm",
    isCatalogPackage: () => false,
    organizationId: "org-1",
    repositoryId: "repo-1",
    commitSha: "sha-1",
    correlationId: "c-1",
  };

  it("returns zeros for non-npm ecosystems", async () => {
    const result = await runAutonomousIgnition({
      ...baseInput,
      packageManager: "maven",
      fetchers: stubFetchers({}),
    });
    expect(result).toEqual({ considered: 0, planned: 0, casesUpserted: 0 });
    expect(prisma.vendor.upsert).not.toHaveBeenCalled();
  });

  it("creates the full case chain for provable bumps and skips catalog packages", async () => {
    // NOTE: kit proof reads rootDir/package.json from disk; point rootDir at
    // the fixture-free inline manifest via a read error → skipped. Instead,
    // stub fetchers plan against manifests we also write? The ignition reads
    // real files, so this test uses a temp dir.
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "patchbay-ignition-"));
    writeFileSync(join(dir, "package.json"), MANIFEST);

    const result = await runAutonomousIgnition({
      ...baseInput,
      rootDir: dir,
      fetchers: stubFetchers({ lodash: "4.17.21", react: "19.0.0" }),
    });
    expect(result.considered).toBe(2);
    expect(result.planned).toBe(1);
    expect(result.casesUpserted).toBe(1);
    expect(prisma.vendor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "autonomous-generic" } }),
    );
    expect(prisma.releaseRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: "4.17.21", previousVersion: "4.17.20" }),
      }),
    );
    expect(prisma.remediationCase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeKey: expect.stringContaining("r-1:repo-1:d-1") },
      }),
    );
  });

  it("never throws — fetcher outages yield zeros", async () => {
    const throwing: AutonomousFetchers = {
      fetchLatest: async () => {
        throw new Error("down");
      },
      fetchOsvFix: async () => {
        throw new Error("down");
      },
    };
    const result = await runAutonomousIgnition({ ...baseInput, fetchers: throwing });
    expect(result).toEqual({ considered: 2, planned: 0, casesUpserted: 0 });
  });
});
