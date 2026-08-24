import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageManager } from "./types";

export const LOCKFILE_ORDER = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
] as const;

/** Returns the name of the lockfile/manifest present in rootDir, or null. */
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
  if (lockfileName === "pom.xml") return "maven";
  if (lockfileName === "build.gradle" || lockfileName === "build.gradle.kts") return "gradle";
  return "unknown";
}

/**
 * Resolves installed package versions from a lockfile or build manifest.
 * Deterministic, no network. Formats:
 * - pnpm: regex over the `packages:` section keys (e.g. `stripe@16.12.0:`).
 * - npm: JSON `packages["node_modules/<name>"].version`.
 * - yarn: not parsed (returns empty map).
 * - maven (pom.xml): `<dependency>` blocks -> `groupId:artifactId` -> version.
 * - gradle (build.gradle[.kts]): `implementation "g:a:v"` / `"g:a:v"` strings.
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
  } else if (lockfileName === "pom.xml") {
    // <dependency><groupId>g</groupId><artifactId>a</artifactId><version>v</version></dependency>
    const dependencyBlock = /<dependency>([\s\S]*?)<\/dependency>/g;
    const tagValue = (block: string, tag: string): string | null => {
      const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block);
      return match?.[1]?.trim() ?? null;
    };
    for (const blockMatch of raw.matchAll(dependencyBlock)) {
      const block = blockMatch[1] ?? "";
      const groupId = tagValue(block, "groupId");
      const artifactId = tagValue(block, "artifactId");
      const version = tagValue(block, "version");
      if (!groupId || !artifactId || !version) continue;
      if (version.startsWith("${") || version.includes("$PROJECT")) continue;
      versions[`${groupId}:${artifactId}`] = version;
    }
  } else if (lockfileName === "build.gradle" || lockfileName === "build.gradle.kts") {
    // implementation|api|compile "group:artifact:version" (single or double quotes).
    const depLine =
      /(?:implementation|api|compile|runtimeOnly)\s+\(?["']([^"':\s]+):([^"':\s]+):([^"'\s+]+)["']/g;
    for (const match of raw.matchAll(depLine)) {
      const groupId = match[1];
      const artifactId = match[2];
      const version = match[3];
      if (!groupId || !artifactId || !version) continue;
      versions[`${groupId}:${artifactId}`] = version;
    }
  }

  return { packageManager, versions };
}
