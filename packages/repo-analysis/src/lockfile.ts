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
  "packages.lock.json",
  "go.mod",
  "Gemfile.lock",
  "packages.config",
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
  if (lockfileName === "packages.lock.json" || lockfileName === "packages.config") return "nuget";
  if (lockfileName === "go.mod") return "go";
  if (lockfileName === "Gemfile.lock") return "rubygems";
  return "unknown";
}

/**
 * Linear-time extractor for <dependency>…</dependency> blocks.
 *
 * Replaces the previous lazy-dot-all regex whose worst case was quadratic on
 * inputs with many openers and no closers (~30s stall per MB in the worker).
 * Each indexOf advances monotonically; an unclosed opener terminates the scan
 * after ONE failed closer lookup instead of rescanning per position.
 */
export function extractDependencyBlocks(source: string): string[] {
  if (!source.includes("<dependency>") || !source.includes("</dependency>")) return [];
  const OPEN = "<dependency>";
  const CLOSE = "</dependency>";
  const blocks: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = source.indexOf(OPEN, cursor);
    if (start === -1) break;
    const contentStart = start + OPEN.length;
    const end = source.indexOf(CLOSE, contentStart);
    if (end === -1) break;
    blocks.push(source.slice(contentStart, end));
    cursor = end + CLOSE.length;
  }
  return blocks;
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
    const tagValue = (block: string, tag: string): string | null => {
      const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block);
      return match?.[1]?.trim() ?? null;
    };
    for (const block of extractDependencyBlocks(raw)) {
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
  } else if (lockfileName === "packages.lock.json") {
    // NuGet lock file v2: { dependencies: { "<tfm>": { "<package>": { resolved: "1.2.3", ... }}}}
    try {
      const parsed = JSON.parse(raw) as {
        dependencies?: Record<string, Record<string, { resolved?: string; requested?: string }>>;
      };
      const deps = parsed.dependencies ?? {};
      for (const tfm of Object.values(deps)) {
        for (const [pkg, meta] of Object.entries(tfm)) {
          const ver = meta.resolved ?? meta.requested;
          if (!ver) continue;
          // requested may be "[1.2.3, )" — strip brackets
          const clean = ver.replace(/^\[|\]|\(|\)|,.*$/g, "").trim();
          if (clean) versions[pkg.toLowerCase()] = clean;
        }
      }
    } catch {
      // fallthrough empty
    }
  } else if (lockfileName === "go.mod") {
    // go.mod: `require` block or single lines `require foo/bar v1.2.3`
    // Handles `retract`, `replace` ignored, only `require` and bare `foo/bar v1.2.3` inside block.
    const lines = raw.split("\n");
    let inRequireBlock = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("//") || line.length === 0) continue;
      if (line.startsWith("require (")) {
        inRequireBlock = true;
        continue;
      }
      if (inRequireBlock && line === ")") {
        inRequireBlock = false;
        continue;
      }
      const target = inRequireBlock
        ? line
        : line.startsWith("require ")
          ? line.slice(8).trim()
          : null;
      if (!target && !inRequireBlock) continue;
      const candidate = target ?? (inRequireBlock ? line : null);
      if (!candidate) continue;
      // candidate like `github.com/foo/bar v1.2.3 // indirect` or `github.com/foo/bar v1.2.3`
      const m = /^(\S+)\s+v?(\S+)/.exec(candidate);
      if (!m) continue;
      const mod = m[1] ?? "";
      const ver = (m[2] ?? "").split(/[ \t]/)[0]?.replace(/^v/, "") ?? "";
      if (!mod || !ver || ver === "0.0.0") continue;
      versions[mod] = ver;
    }
  } else if (lockfileName === "Gemfile.lock") {
    // Gemfile.lock: `GEM` section then `specs:` lines `gemName (version)`
    const gemSection = raw.split("GEM")[1]?.split("\n") ?? [];
    let inSpecs = false;
    for (const line of gemSection) {
      if (line.trim() === "specs:") {
        inSpecs = true;
        continue;
      }
      if (inSpecs) {
        if (line.trim().length === 0 || !line.startsWith(" ")) break;
        const m = /^\s{4}(\S+)\s+\(([^)]+)\)/.exec(line);
        if (!m) continue;
        const gem = m[1] ?? "";
        const ver = m[2] ?? "";
        if (gem && ver) versions[gem] = ver;
      }
    }
  } else if (lockfileName === "packages.config") {
    // Legacy NuGet packages.config XML: <package id="Foo" version="1.2.3" />
    const re = /<package\s+[^>]*id="([^"]+)"\s+[^>]*version="([^"]+)"/gi;
    for (const m of raw.matchAll(re)) {
      const id = m[1] ?? "";
      const ver = m[2] ?? "";
      if (id && ver) versions[id.toLowerCase()] = ver;
    }
  }

  return { packageManager, versions };
}
