/**
 * Generated capability matrix — single source of truth for connector/source levels.
 * Reads CAPABILITY_REGISTRY and emits docs/capability-matrix.md.
 * Run: pnpm exec tsx scripts/generate-capability-matrix.ts
 * CI: pnpm exec tsx scripts/generate-capability-matrix.ts --check
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outPath = resolve(repoRoot, "docs/capability-matrix.md");

async function main() {
  const { pathToFileURL } = await import("node:url");
  const mod = await import(
    pathToFileURL(resolve(repoRoot, "packages/vendor-connectors/src/capabilities.ts")).href
  );
  const REGISTRY: Array<{
    vendorSlug: string;
    ecosystem: string;
    package: string;
    language: string;
    level: string;
    rulePackVersion: string | null;
    validationProfile: string | null;
    requiredPolicyClass: string;
    certifiedAt: string | null;
  }> = (
    mod as unknown as {
      CAPABILITY_REGISTRY: Array<{
        vendorSlug: string;
        ecosystem: string;
        package: string;
        language: string;
        level: string;
        rulePackVersion: string | null;
        validationProfile: string | null;
        requiredPolicyClass: string;
        certifiedAt: string | null;
      }>;
    }
  ).CAPABILITY_REGISTRY;

  const levelToSpec: Record<string, string> = {
    DETECT: "detect-only",
    ASSESS: "impact-analysis",
    PLAN: "plan-only",
    VALIDATE: "plan-only",
    DRAFT_PR: "draft-PR",
  };

  function specCapability(entry: (typeof REGISTRY)[number]): string {
    if (entry.vendorSlug === "autonomous-generic") return "autonomous";
    if (entry.vendorSlug === "mcp-generic") return "plan-only (MCP)";
    return levelToSpec[entry.level] ?? entry.level;
  }

  const counts: Record<string, number> = {};
  for (const e of REGISTRY) counts[e.level] = (counts[e.level] ?? 0) + 1;
  const total = REGISTRY.length;

  let md = `# Capability Matrix (generated — do not edit by hand)\n\n`;
  md += `> Source: \`packages/vendor-connectors/src/capabilities.ts\` \`CAPABILITY_REGISTRY\`. Run \`pnpm exec tsx scripts/generate-capability-matrix.ts\` to regenerate. Checked in CI.\n\n`;
  md += `**Total connectors: ${total}** — ${Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(
      " · ",
    )} · Spec mapping: DETECT→detect-only, ASSESS→impact-analysis, PLAN/VALIDATE→plan-only, DRAFT_PR→draft-PR, autonomous-generic→autonomous.\n\n`;
  md += `| Vendor slug | Ecosystem | Package / spec | Language | Level | Spec capability | Policy class | Certified | Rule pack | Validation profile |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const e of [...REGISTRY].sort((a, b) => a.vendorSlug.localeCompare(b.vendorSlug))) {
    md += `| \`${e.vendorSlug}\` | ${e.ecosystem} | \`${e.package}\` | ${e.language} | \`${e.level}\` | ${specCapability(e)} | ${e.requiredPolicyClass} | ${e.certifiedAt ?? "—"} | ${e.rulePackVersion ?? "—"} | ${e.validationProfile ?? "—"} |\n`;
  }
  md += `\n*${total} rows — deterministic, regenerates with timestamp at build time only.*\n`;

  if (process.argv.includes("--check")) {
    if (!existsSync(outPath)) {
      console.error(`Missing generated file: ${outPath}`);
      process.exit(1);
    }
    const existing = readFileSync(outPath, "utf8");
    if (existing !== md) {
      console.error(
        "Capability matrix drift — run: pnpm exec tsx scripts/generate-capability-matrix.ts",
      );
      process.exit(1);
    }
    console.log("Capability matrix check: OK");
  } else {
    writeFileSync(outPath, md, "utf8");
    console.log(`Wrote ${outPath} (${total} connectors)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
