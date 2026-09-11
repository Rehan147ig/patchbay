import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CI safety invariants (P0-2 DeepSec hardening).
 *
 * Guards the repository's security-gate topology as text: DeepSec must stay
 * explicitly gated on provisioning (a missing `deepsec` tool must surface as
 * Skipped, never green-success and never red-failure), and the REQUIRED
 * gates (Gitleaks, dependency audit, Semgrep) must keep existing — nobody
 * may "fix" CI by deleting a required gate or by un-gating DeepSec.
 */
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

function readWorkflow(name: string): string {
  const path = resolve(repoRoot, ".github/workflows", name);
  if (!existsSync(path)) throw new Error(`workflow file missing: ${path}`);
  return readFileSync(path, "utf8");
}

describe("deepsec.yml stays explicitly gated on provisioning", () => {
  const workflow = readWorkflow("deepsec.yml");

  it("declares itself informational/non-required while unprovisioned", () => {
    expect(workflow).toMatch(/INFORMATIONAL \/ NON-REQUIRED/);
  });

  it("gates the analyze job on the provision job's ready output", () => {
    expect(workflow).toMatch(/needs:\s*\[provision\]/);
    expect(workflow).toMatch(/needs\.provision\.outputs\.ready == 'true'/);
  });

  it("reports provisioning status explicitly instead of failing silently", () => {
    expect(workflow).toMatch(/Report DeepSec provisioning status/);
    expect(workflow).toMatch(/\$GITHUB_STEP_SUMMARY/);
    expect(workflow).toMatch(/::notice title=DeepSec provisioning/);
  });

  it("documents the three provisioning requirements", () => {
    expect(workflow).toContain("NIM_API_KEY");
    expect(workflow).toContain(".deepsec/");
    expect(workflow).toMatch(/devDependencies/);
  });

  it("keeps the failure comment path scoped to real analysis failures", () => {
    expect(workflow).toMatch(/needs\.analyze\.result == 'failure'/);
  });
});

describe("required security gates keep existing", () => {
  const workflow = readWorkflow("security.yml");

  it("still runs dependency audit (pnpm + OSV)", () => {
    expect(workflow).toContain("Dependency audit (pnpm + OSV)");
    expect(workflow).toContain("osv-scanner-action");
  });

  it("still runs the gitleaks secret scan", () => {
    expect(workflow).toContain("Secret scan (gitleaks)");
    expect(workflow).toContain("gitleaks-action");
  });

  it("still runs Semgrep OWASP analysis", () => {
    expect(workflow).toContain("Static analysis (semgrep OWASP)");
    expect(workflow).toContain("semgrep-action");
  });
});
