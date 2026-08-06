import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Resolves the repository-root fixture dir (fixtures/repositories/<name>).
 * Used by tests and the worker; works regardless of process.cwd().
 */
export function resolveFixtureDir(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../fixtures/repositories", name);
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
