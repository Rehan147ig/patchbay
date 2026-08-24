import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Resolves the repository-root fixture dir (fixtures/repositories/<name>).
 * Used by tests and the worker; works regardless of process.cwd().
 *
 * Fixture names originate from tenant-writable repository metadata, so they are
 * treated as untrusted: the name must be a bare path segment (no separators,
 * no traversal) and the resolved directory must stay inside the fixtures root.
 */
const FIXTURE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function resolveFixtureDir(name: string): string {
  if (!FIXTURE_NAME_PATTERN.test(name)) {
    throw new Error(`invalid fixture name: ${JSON.stringify(name.slice(0, 64))}`);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturesRoot = path.resolve(here, "../../../fixtures/repositories");
  const resolved = path.resolve(fixturesRoot, name);
  if (resolved !== fixturesRoot && !resolved.startsWith(fixturesRoot + path.sep)) {
    throw new Error(`fixture path escapes the fixtures root: ${name}`);
  }
  return resolved;
}

/** Walks up from `startDir` until a pnpm-workspace.yaml is found. */
export function resolvePatchbayRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`patchbay root not found above ${startDir}`);
}
