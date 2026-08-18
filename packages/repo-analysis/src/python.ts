import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { UsageType } from "@patchbay/domain";
import type { AnalyzedUsage, PythonManifest } from "./types";

/**
 * Python L1 analysis: syntax-level usage detection via tree-sitter WASM.
 * - Parses pyproject.toml and requirements*.txt into PythonManifest entries.
 * - Walks the parse tree for imports of tracked packages and calls made
 *   through those imported modules (aliases included).
 *
 * L1 means syntax only: no type resolution, no dependency graph beyond the
 * manifest. Certified Python connectors (stripe, openai, twilio) build
 * migration rules on top of this in later milestones.
 */

const require = createRequire(import.meta.url);

interface PythonParser {
  parse(source: string): { rootNode: TsNode };
}

interface TsNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  childForFieldName(name: string): TsNode | null;
  namedChildren: TsNode[];
}

let parserPromise: Promise<PythonParser> | null = null;

function loadParser(): Promise<PythonParser> {
  if (parserPromise === null) {
    parserPromise = (async () => {
      const { Parser, Language } = await import("web-tree-sitter");
      await Parser.init();
      const languagePkg = "tree-sitter-" + "python";
      const wasmPath = require.resolve(`${languagePkg}/${languagePkg}.wasm`);
      const language = await Language.load(await readFile(wasmPath));
      const parser = new Parser();
      parser.setLanguage(language);
      return parser as unknown as PythonParser;
    })();
  }
  return parserPromise;
}

/** Strips extras (`pkg[extra]`) and environment markers (`; marker`). */
function stripSpecifier(raw: string): string {
  const withoutMarker = raw.split(";")[0] ?? raw;
  const withoutExtras = withoutMarker.replace(/\[[^\]]*\]/, "");
  return withoutExtras.trim();
}

function requirementName(line: string): string | null {
  const trimmed = line.split("#")[0]?.trim() ?? "";
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("-")) return null;
  const name = stripSpecifier(trimmed).split(/[=<>!~;\s]+/)[0] ?? "";
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return null;
  return name;
}

/**
 * Minimal deterministic parser for the manifest fields Patchbay needs.
 * Handles `[project]` + `[project.optional-dependencies]` (PEP 621) and
 * `[tool.poetry.dependencies]` + `[tool.poetry.group.<name>.dependencies]`.
 * No TOML runtime dependency; unknown constructs are ignored.
 */
export function parsePyProjectToml(source: string): Omit<PythonManifest, "path"> {
  const manifest: Omit<PythonManifest, "path"> = {
    name: null,
    version: null,
    dependencies: {},
    devDependencies: {},
  };
  let section = "";
  const lines = source.split("\n");
  let pendingArray: { entries: string[]; into: "dependencies" | "devDependencies" } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    if (pendingArray !== null) {
      pendingArray.entries.push(line);
      const accumulated = pendingArray.entries.join(" ");
      const opens = (accumulated.match(/\[/g) ?? []).length;
      const closes = (accumulated.match(/\]/g) ?? []).length;
      if (closes >= opens) {
        for (const entry of splitArray(accumulated)) {
          const name = requirementName(entry);
          if (name) manifest[pendingArray.into][name] = entry;
        }
        pendingArray = null;
      }
      continue;
    }

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1] ?? "";
      continue;
    }

    if (section === "project") {
      const nameMatch = /^name\s*=\s*"([^"]+)"/.exec(line);
      if (nameMatch) {
        manifest.name = nameMatch[1] ?? null;
        continue;
      }
      const versionMatch = /^version\s*=\s*"([^"]+)"/.exec(line);
      if (versionMatch) {
        manifest.version = versionMatch[1] ?? null;
        continue;
      }
      if (line.startsWith("dependencies")) {
        const value = line.slice(line.indexOf("=") + 1).trim();
        if (value.startsWith("[")) {
          if (value.includes("]")) {
            for (const entry of splitArray(value)) {
              const name = requirementName(entry);
              if (name) manifest.dependencies[name] = entry;
            }
          } else {
            pendingArray = { entries: [value], into: "dependencies" };
          }
        }
        continue;
      }
    }

    if (section === "project.optional-dependencies" || section.endsWith(".dependencies")) {
      const keyMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
      if (!keyMatch) continue;
      const key = keyMatch[1] ?? "";
      const value = (keyMatch[2] ?? "").trim();
      if (key === "python") continue;
      if (value.startsWith("[")) {
        if (value.includes("]")) {
          for (const entry of splitArray(value)) {
            const name = requirementName(entry);
            if (name) manifest.devDependencies[name] = entry;
          }
        } else {
          pendingArray = { entries: [value], into: "devDependencies" };
        }
      } else {
        const name = requirementName(`${key} ${value}`);
        if (name && name === key) {
          const into = section === "tool.poetry.dependencies" ? "dependencies" : "devDependencies";
          manifest[into][key] = value.replace(/^"|"$/g, "");
        }
      }
    }
  }
  return manifest;
}

function splitArray(value: string): string[] {
  const inner = value.slice(1, value.lastIndexOf("]"));
  const entries: string[] = [];
  let current = "";
  let inQuote = false;
  for (const char of inner) {
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
    } else if (char === "," && !inQuote) {
      entries.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) entries.push(current.trim());
  return entries.map((entry) => entry.replace(/^"|"$/g, "").trim());
}

/** Parses requirements.txt style files (one PEP 508 requirement per line). */
export function parseRequirementsTxt(source: string): Omit<PythonManifest, "path"> {
  const manifest: Omit<PythonManifest, "path"> = {
    name: null,
    version: null,
    dependencies: {},
    devDependencies: {},
  };
  for (const rawLine of source.split("\n")) {
    const name = requirementName(rawLine);
    if (name) manifest.dependencies[name] = rawLine.split("#")[0]?.trim() ?? name;
  }
  return manifest;
}

export function parsePythonManifest(relPath: string, source: string): Omit<PythonManifest, "path"> {
  if (relPath.endsWith("pyproject.toml")) return parsePyProjectToml(source);
  return parseRequirementsTxt(source);
}

/**
 * Extracts L1 usages from a single Python source file. Imports of tracked
 * packages are recorded as IMPORT usages; attribute/call chains rooted at an
 * imported module name are recorded as METHOD_CALL usages.
 */
export async function extractPythonUsages(
  source: string,
  relPath: string,
  trackSet: Set<string>,
): Promise<AnalyzedUsage[]> {
  if (trackSet.size === 0) return [];
  const parser = await loadParser();
  const tree = parser.parse(source);
  const usages: AnalyzedUsage[] = [];
  const aliases = new Map<string, string>();

  const excerptAt = (node: TsNode): string => {
    const line = source.split("\n")[node.startPosition.row] ?? "";
    return line.trim().slice(0, 120);
  };

  const addUsage = (packageName: string, usageType: UsageType, symbol: string, node: TsNode) => {
    usages.push({
      packageName,
      filePath: relPath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      symbol,
      usageType,
      excerpt: excerptAt(node),
      riskTags: [],
    });
  };

  const firstSegment = (node: TsNode): string => {
    const text = node.text;
    const dot = text.indexOf(".");
    return dot === -1 ? text : text.slice(0, dot);
  };

  const aliasName = (node: TsNode): string | null => {
    const text = node.text;
    const asIndex = text.lastIndexOf(" as ");
    return asIndex === -1 ? firstSegment(node) : text.slice(asIndex + 4).trim();
  };

  function walk(node: TsNode): void {
    if (node.type === "import_statement") {
      let moduleNode: TsNode | null = null;
      let alias: string | null = null;
      for (const child of node.namedChildren) {
        if (child.type === "dotted_name") {
          if (moduleNode === null) moduleNode = child;
        } else if (child.type === "aliased_import") {
          const kids = child.namedChildren;
          moduleNode = kids[0] ?? null;
          alias = kids[1]?.text ?? null;
        }
      }
      if (moduleNode !== null) {
        const pkg = firstSegment(moduleNode);
        if (trackSet.has(pkg)) {
          const bound = alias ?? aliasName(moduleNode);
          if (bound !== null) aliases.set(bound, pkg);
          addUsage(pkg, UsageType.IMPORT, moduleNode.text, node);
        }
      }
    } else if (node.type === "import_from_statement") {
      let moduleNode: TsNode | null = null;
      const imported: TsNode[] = [];
      for (const child of node.namedChildren) {
        if (child.type === "dotted_name") {
          if (moduleNode === null) moduleNode = child;
          else imported.push(child);
        } else if (child.type === "aliased_import" || child.type === "identifier") {
          imported.push(child);
        }
      }
      if (moduleNode !== null && trackSet.has(firstSegment(moduleNode))) {
        const pkg = firstSegment(moduleNode);
        for (const imp of imported) {
          const bound = aliasName(imp);
          if (bound) aliases.set(bound, pkg);
        }
        addUsage(pkg, UsageType.IMPORT, moduleNode.text, node);
      }
    } else if (node.type === "call") {
      const fn = node.childForFieldName("function");
      if (fn !== null && (fn.type === "attribute" || fn.type === "identifier")) {
        let cursor: TsNode = fn;
        while (cursor.type === "attribute") {
          const obj = cursor.childForFieldName("object");
          if (obj === null) break;
          cursor = obj;
        }
        if (cursor.type === "identifier") {
          const pkg = aliases.get(cursor.text);
          if (pkg)
            addUsage(
              pkg,
              UsageType.METHOD_CALL,
              fn.type === "identifier" ? node.text : fn.text,
              node,
            );
        }
      }
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(tree.rootNode);
  usages.sort((a, b) => a.line - b.line || a.column - b.column);
  return usages;
}
