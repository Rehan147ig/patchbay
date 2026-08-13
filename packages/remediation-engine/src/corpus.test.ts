import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getConnector } from "@patchbay/vendor-connectors";
import { analyzeRepository, resolveFixtureDir, type AnalyzedUsage } from "@patchbay/repo-analysis";
import { generatePlan } from "./engine";
import type { PatchSuggestion, VendorConnector } from "@patchbay/vendor-connectors";

/**
 * H2 fixture corpus (roadmap Phase H2 exit criterion): replay every supported
 * vendor's release change against its real fixture repository, from analyzer
 * facts through connector normalization to a deterministic engine patch. Runs
 * in CI whenever connectors, prompts, or matchers change.
 *
 * Metrics:
 *  - recall: every corpus entry must produce patches in its expected files
 *  - precision: the patched file set must equal the expected set (no extra
 *    files were touched by the deterministic matcher)
 */
const OPENAI_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/repositories/openai-node-legacy",
);

interface CorpusEntry {
  vendor: string;
  fixture: string;
  fromVersion: string;
  toVersion: string;
  payload: Record<string, unknown>;
  expectedFiles: string[];
}

const CORPUS: CorpusEntry[] = [
  {
    vendor: "openai",
    fixture: "openai-node-legacy",
    fromVersion: "3.x",
    toVersion: "4.x",
    payload: {
      sdk: "openai",
      fromVersion: "3.x",
      toVersion: "4.x",
      migration: {
        methodRenames: [
          { from: "openai.createChatCompletion", to: "openai.chat.completions.create" },
        ],
        responseChanges: [
          { symbol: "completion.data", description: "v4 returns the body directly." },
        ],
      },
    },
    expectedFiles: ["src/chat/chat-service.ts"],
  },
  {
    vendor: "stripe",
    fixture: "stripe-node-legacy",
    fromVersion: "12.x",
    toVersion: "13.x",
    payload: { sdk: "stripe" },
    expectedFiles: ["src/payments/customers.ts"],
  },
  {
    vendor: "twilio",
    fixture: "twilio-node-legacy",
    fromVersion: "3.x",
    toVersion: "4.x",
    payload: { sdk: "twilio" },
    expectedFiles: ["src/notifications/sms.ts"],
  },
];

const TRACKED = ["stripe", "openai", "twilio", "auth0"];

describe("H2 fixture corpus (replay CI gate)", () => {
  for (const entry of CORPUS) {
    it(`${entry.vendor} ${entry.fromVersion} -> ${entry.toVersion}: analyzer + connector + engine agree on ${entry.expectedFiles.join(", ")}`, async () => {
      const analysis = await analyzeRepository({
        rootDir: resolveFixtureDir(entry.fixture),
        trackPackages: TRACKED,
      });
      expect(analysis.errors).toEqual([]);

      const connector = getConnector(entry.vendor);
      if (!connector) throw new Error(`no connector registered for corpus vendor ${entry.vendor}`);
      const suggestions = suggestionsFor(connector, entry.payload);
      const plan = generatePlan({
        fixtureDir: path.resolve(OPENAI_FIXTURE, "..", entry.fixture),
        repositoryName: entry.fixture,
        usages: analysis.usages as AnalyzedUsage[],
        patchSuggestions: suggestions,
        normalizations: connector.normalizeChange({
          rawPayload: entry.payload,
          sourceType: "SDK_RELEASE",
        }),
        assessmentConfidence: 90,
      });

      const patched = plan.patches.map((patch) => patch.filePath).sort();
      expect(patched).toEqual([...entry.expectedFiles].sort());
      for (const patch of plan.patches) {
        expect(patch.generationMethod).toBe("RULE_BASED");
        expect(patch.originalHash).not.toBe(patch.patchedHash);
        expect(patch.unifiedDiff).toContain(`--- a/${patch.filePath}`);
      }
      if (entry.vendor === "stripe") {
        expect(plan.patches[0]?.patched).toContain('metadata: { source: "patchbay-migration" }');
      }
      expect(plan.skippedFiles).toEqual([]);
    });
  }
});

function suggestionsFor(
  connector: VendorConnector,
  payload: Record<string, unknown>,
): PatchSuggestion[] {
  return connector.buildPatchSuggestions(
    connector.normalizeChange({ rawPayload: payload, sourceType: "SDK_RELEASE" }),
  );
}
