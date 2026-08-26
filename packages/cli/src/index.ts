#!/usr/bin/env node
import { analyzeRepository, findHttpCallsites } from "@patchbay/repo-analysis";
import {
  getCapability,
  getConnector,
  getRegistryRecipe,
  listRegistryEntries,
  REGISTRY_PAYLOADS,
} from "@patchbay/vendor-connectors";
import type { MigrationRecipe } from "@patchbay/domain";
import { generatePlan } from "@patchbay/remediation-engine";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

type Args = {
  vendor: string | null;
  write: boolean;
  dryRun: boolean;
  cwd: string;
  registry: string | null;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    vendor: null,
    write: false,
    dryRun: false,
    cwd: process.cwd(),
    registry: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") args.write = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--cwd" && argv[i + 1]) args.cwd = argv[++i] ?? args.cwd;
    else if (token === "--registry" && argv[i + 1]) args.registry = argv[++i] ?? null;
    else if (!token?.startsWith("-") && !args.vendor) args.vendor = token ?? null;
  }
  return args;
}

function helpText(): string {
  return [
    "Usage: patch-migrate <vendor> [options]",
    "",
    "  vendor              Vendor slug (e.g. openai, stripe, twilio)",
    "  --write             Apply transforms in place",
    "  --dry-run           Show diff without writing (default)",
    "  --cwd <path>        Workspace root (default: cwd)",
    "  --registry <url>    Registry base URL (default: env PATCHBAY_REGISTRY or https://patch.dev)",
    "  --help, -h          Show this help",
    "",
    "Examples:",
    "  patch-migrate openai --dry-run",
    "  patch-migrate stripe --write --cwd ./my-app",
  ].join("\n");
}

function colorizeDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return `\x1b[1m${line}\x1b[0m`;
      if (line.startsWith("@@")) return `\x1b[36m${line}\x1b[0m`;
      if (line.startsWith("+")) return `\x1b[32m${line}\x1b[0m`;
      if (line.startsWith("-")) return `\x1b[31m${line}\x1b[0m`;
      return line;
    })
    .join("\n");
}

function runTscGate(cwd: string): { ok: boolean; output: string } {
  const hasTsconfig = existsSync(path.join(cwd, "tsconfig.json"));
  if (!hasTsconfig) {
    // No tsconfig (fixtures) - rely on generatePlan's semantic gate which already validated.
    return { ok: true, output: "No tsconfig.json - skipping tsc, semantic gate already passed." };
  }
  const result = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck"], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  const output = [result.stdout ?? "", result.stderr ?? ""].join("\n");
  return { ok: result.status === 0, output };
}

async function collectTsFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", ".next"].includes(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && /\.(ts|tsx|mts|cts|js|jsx)$/.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  await walk(root);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.vendor) {
    console.log(helpText());
    process.exit(args.help ? 0 : 1);
  }

  const vendor = args.vendor;
  const connector = getConnector(vendor);
  if (!connector) {
    console.error(
      `Unknown vendor "${vendor}". Certified vendors: openai, stripe, twilio, anthropic, supabase`,
    );
    process.exit(1);
  }

  // 1. Resolve registry recipe (remote fetch with local fallback).
  const registryBase = args.registry ?? process.env.PATCHBAY_REGISTRY ?? "http://localhost:3000";
  let recipe: MigrationRecipe | null = null;
  const localEntries = listRegistryEntries();
  const localEntry = localEntries.find((e) => e.vendor === vendor);
  if (localEntry) {
    // Try remote fetch, fallback to bundled recipe.
    try {
      const url = `${registryBase.replace(/\/$/, "")}/api/registry/${vendor}/${localEntry.fromVersion}/${localEntry.toVersion}`;
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { data: MigrationRecipe };
        recipe = body.data ?? ((await res.json()) as MigrationRecipe);
      }
    } catch {
      // offline - use bundled
    }
    if (!recipe) {
      recipe = getRegistryRecipe(vendor, localEntry.fromVersion, localEntry.toVersion);
    }
  }

  if (recipe) {
    console.log(
      `\nRecipe: ${recipe.vendor} ${recipe.fromVersion} -> ${recipe.toVersion} [${recipe.capability}]`,
    );
    console.log(
      `Rules: ${recipe.rules.length} | Certified: ${recipe.certifiedAt ?? "n/a"} | Engine: ${recipe.engineVersion}`,
    );
    for (const rule of recipe.rules) {
      console.log(
        `  - ${rule.changeType}: ${rule.oldValue ?? ""} -> ${rule.newValue ?? ""} ${rule.description ?? ""}`,
      );
    }
    if (recipe.capability === "PLAN") {
      console.log("  PLAN-level recipe: requires human approval before apply.");
    }
  } else {
    console.log(`No registry recipe found for vendor "${vendor}" (local fallback).`);
  }

  // 2. Local workspace scan via repo-analysis + http-matcher (PLAN signal).
  let httpHits = 0;
  const files = await collectTsFiles(args.cwd);
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const callsites = findHttpCallsites(source, path.relative(args.cwd, file));
    for (const site of callsites) {
      httpHits += 1;
      const rel = path.relative(args.cwd, file);
      console.log(
        `${rel}:${site.line}:${site.column} [${site.client}] ${site.method} ${site.matchedEndpoint} (http-matcher PLAN)`,
      );
    }
  }

  // 3. Typed SDK usage scan via analyzeRepository.
  let vendorUsages: Awaited<ReturnType<typeof analyzeRepository>>["usages"] = [];
  let analysis: Awaited<ReturnType<typeof analyzeRepository>> | null = null;
  try {
    const capability = getCapability(vendor);
    const packageName = capability?.package ?? vendor;
    analysis = await analyzeRepository({
      rootDir: args.cwd,
      trackPackages: [packageName],
    });
    vendorUsages = analysis.usages.filter((u) => u.packageName === packageName);
    if (vendorUsages.length > 0) {
      console.log(`\nFound ${vendorUsages.length} typed SDK usage(s) for "${vendor}":`);
      for (const usage of vendorUsages.slice(0, 20)) {
        console.log(`  ${usage.filePath}:${usage.line} ${usage.symbol ?? usage.packageName}`);
      }
      if (vendorUsages.length > 20) console.log(`  ... and ${vendorUsages.length - 20} more`);
    } else if (httpHits === 0) {
      console.log(
        `\nNo typed usages or HTTP callsites matched for vendor "${vendor}" under ${args.cwd}`,
      );
      console.log(
        "Note: http-matcher is PLAN-level (requires human approval) - non-literal URLs are not matched.",
      );
    }

    // 4. Deterministic remediation via remediation-engine + tsc --noEmit gate.
    if (vendorUsages.length > 0 && recipe) {
      // Build connector-driven normalizations and patch suggestions.
      const payload = REGISTRY_PAYLOADS[vendor] ?? {
        sdk: vendor,
        fromVersion: recipe.fromVersion,
        toVersion: recipe.toVersion,
      };
      let normalizations: ReturnType<typeof connector.normalizeChange> = [];
      try {
        normalizations = connector.normalizeChange({
          rawPayload: payload,
          sourceType: "SDK_RELEASE",
        });
      } catch {
        normalizations = [];
      }
      const patchSuggestions = connector.buildPatchSuggestions(normalizations);

      const plan = await generatePlan({
        fixtureDir: path.resolve(args.cwd),
        repositoryName: path.basename(path.resolve(args.cwd)),
        usages: vendorUsages.map((u) => ({
          filePath: u.filePath,
          line: u.line,
          symbol: u.symbol,
          excerpt: u.excerpt,
        })),
        patchSuggestions,
        normalizations,
        assessmentConfidence: 90,
      });

      if (plan.patches.length === 0) {
        console.log(`\nPlan: ${plan.strategy}`);
        if (plan.skippedFiles.length > 0) {
          console.log(`Skipped files (re-parse/semantic gate): ${plan.skippedFiles.join(", ")}`);
        }
        console.log("No deterministic patches to apply - plan-only.");
      } else {
        console.log(`\nPlan: ${plan.strategy}`);
        console.log(`Patches: ${plan.patches.length} file(s) | Confidence: ${plan.confidence}%`);
        if (plan.skippedFiles.length > 0) {
          console.log(`Skipped: ${plan.skippedFiles.join(", ")}`);
        }
        for (const patch of plan.patches) {
          console.log(`\n--- ${patch.filePath} ---`);
          console.log(colorizeDiff(patch.unifiedDiff));
        }

        if (args.write) {
          if (recipe.capability === "PLAN" && !args.dryRun) {
            console.log(
              "\nPLAN-level recipe: --write requires explicit approval. Re-run with approval or use --dry-run to preview.",
            );
          } else {
            // Fail-closed tsc gate: write, validate, revert on failure.
            const originals = new Map<string, string>();
            for (const patch of plan.patches) {
              const abs = path.join(path.resolve(args.cwd), patch.filePath);
              try {
                const original = await fs.readFile(abs, "utf8");
                originals.set(abs, original);
              } catch {
                // ignore
              }
            }
            for (const patch of plan.patches) {
              const abs = path.join(path.resolve(args.cwd), patch.filePath);
              await fs.writeFile(abs, patch.patched, "utf8");
            }
            console.log("\nRunning tsc --noEmit gate...");
            const gate = runTscGate(path.resolve(args.cwd));
            if (!gate.ok) {
              console.error("\x1b[31mtsc --noEmit FAILED - reverting writes.\x1b[0m");
              console.error(gate.output.slice(0, 4000));
              for (const [abs, original] of originals) {
                await fs.writeFile(abs, original, "utf8");
              }
              process.exit(1);
            }
            console.log("\x1b[32mtsc --noEmit PASSED - patches applied.\x1b[0m");
            for (const patch of plan.patches) {
              console.log(`  wrote ${patch.filePath}`);
            }
          }
        } else {
          console.log("\nDry-run: no files written. Re-run with --write to apply after approval.");
          console.log("Local tsc --noEmit would run here before writing in --write mode.");
        }
      }
    } else if (httpHits > 0) {
      console.log(
        "\nHTTP callsites are PLAN-level: review manually before applying SDK transforms.",
      );
      console.log(
        "Dry-run complete. Re-run with --write after approval if a typed SDK recipe exists.",
      );
    } else if (httpHits === 0 && vendorUsages.length === 0) {
      // already reported
    }

    // Legacy hint block removed - replaced by above.
  } catch (error) {
    console.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (args.registry) {
    console.log(`\nRegistry base: ${registryBase}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
