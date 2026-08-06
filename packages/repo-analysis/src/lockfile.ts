import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageManager } from "./types";

export const LOCKFILE_ORDER = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"] as const;

/** Returns the name of the lockfile present in rootDir, or null. */
export async function detectLockfile(rootDir: string): Promise<string | null> {
  for (const name of LOCKFILE_ORDER) {
    try {
      await fs.access(path.join(rootDir, name));
      return name;
    } catch {
      // try next
    }
  }
  return null;
}

export function packageManagerFor(lockfileName: string | null): PackageManager {
  if (lockfileName === "pnpm-lock.yaml") return "pnpm";
  if (lockfileName === "package-lock.json") return "npm";
  if (lockfileName === "yarn.lock") return "yarn";
  return "unknown";
}

/**
 * Resolves installed package versions from a lockfile. Deterministic, no network.
 * pnpm: regex over the `packages:` section keys (e.g. `stripe@16.12.0:`).
 * npm: JSON `packages["node_modules/<name>"].version`.
 * yarn: not parsed (returns empty map).
 */
export async function resolveLockfileVersions(rootDir: string): Promise<{
  packageManager: PackageManager;
  versions: Record<string, string>;
}> {
  const lockfileName = await detectLockfile(rootDir);
  const packageManager = packageManagerFor(lockfileName);
  if (!lockfileName) {
    return { packageManager, versions: {} };
  }

  const raw = await fs.readFile(path.join(rootDir, lockfileName), "utf8");
  const versions: Record<string, string> = {};

  if (lockfileName === "pnpm-lock.yaml") {
    const section = raw.split("packages:")[1];
    if (!section) return { packageManager, versions };
    for (const line of section.split("\n")) {
      const match = /^ {2}'?([^'":\s]+)@([^'":\s]+)'?:$/.exec(line.trimEnd());
      if (!match) continue;
      const name = match[1] ?? "";
      const version = match[2] ?? "";
      if (!name || !version || version.includes("^") || version.includes("~")) continue;
      versions[name] = version;
    }
  } else if (lockfileName === "package-lock.json") {
    try {
      const lockfile = JSON.parse(raw) as { packages?: Record<string, { version?: string }> };
      for (const [key, entry] of Object.entries(lockfile.packages ?? {})) {
        if (!entry?.version) continue;
        const name = key.startsWith("node_modules/") ? key.slice("node_modules/".length) : key;
        if (name.includes("/") && !name.startsWith("@")) continue;
        if (key.includes("node_modules/")) {
          const last = name.split("node_modules/").pop();
          if (last) versions[last] = entry.version;
        }
      }
    } catch {
      return { packageManager, versions: {} };
    }
  }

  return { packageManager, versions };
}
