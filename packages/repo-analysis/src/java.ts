import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { UsageType } from "@patchbay/domain";
import { extractDependencyBlocks } from "./lockfile";
import type { AnalyzedUsage } from "./types";

/**
 * Java L1 analysis: syntax-level usage detection via tree-sitter WASM.
 *
 * Mirrors python.ts: parses a source file, records imports of tracked
 * packages, constructor initializations, and method-call chains rooted at a
 * tracked import or a variable assigned from one.
 *
 * Track matching heuristic (deterministic, documented): a tracked name T (e.g.
 * "stripe") matches an import when ANY dot-segment of the imported package
 * equals T — so tracked "stripe" matches `com.stripe.Stripe` and
 * `com.stripe.model.PaymentIntent`, while java.util/java.lang never match.
 * L1 means syntax only: no type resolution, no classpath. Certified Java
 * remediation kits build on this in later milestones.
 */

const require = createRequire(import.meta.url);

interface JavaParser {
  parse(source: string): { rootNode: TsNode };
}

interface TsNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  /** True when this node or a descendant contains an ERROR/MISSING construct. */
  hasError?: boolean;
  childForFieldName(name: string): TsNode | null;
  namedChildren: TsNode[];
}

let parserPromise: Promise<JavaParser> | null = null;

function loadParser(): Promise<JavaParser> {
  if (parserPromise === null) {
    parserPromise = (async () => {
      const { Parser, Language } = await import("web-tree-sitter");
      await Parser.init();
      const wasmPath = require.resolve("tree-sitter-java/tree-sitter-java.wasm");
      const language = await Language.load(await readFile(wasmPath));
      const parser = new Parser();
      parser.setLanguage(language);
      return parser as unknown as JavaParser;
    })();
  }
  return parserPromise;
}

/** True when any dot-segment of `importPath` equals a tracked package name. */
export function matchesTrackSet(importPath: string, trackSet: Set<string>): boolean {
  for (const segment of importPath.split(".")) {
    if (trackSet.has(segment)) return true;
  }
  return false;
}

export interface JavaManifest {
  name: string | null;
  version: string | null;
  dependencies: Record<string, string>;
}

/**
 * Minimal deterministic parser for Java build manifests:
 * - pom.xml: project coordinates + <dependency> groupId:artifactId -> version
 *   (property placeholders like ${project.version} are skipped, never guessed)
 * - build.gradle[.kts]: implementation/api/compile/runtimeOnly "g:a:v" strings
 */
export function parseJavaManifest(
  relPath: string,
  source: string,
): { path: string; format: "maven" | "gradle"; manifest: JavaManifest } {
  const manifest: JavaManifest = { name: null, version: null, dependencies: {} };
  const isPom = relPath.endsWith("pom.xml");

  if (isPom) {
    const artifactId = /<artifactId>([^<]+)<\/artifactId>/.exec(source)?.[1]?.trim() ?? null;
    const rawVersion = /<version>([^<]+)<\/version>/.exec(source)?.[1]?.trim() ?? null;
    manifest.name = artifactId;
    manifest.version = rawVersion !== null && !rawVersion.startsWith("${") ? rawVersion : null;

    for (const block of extractDependencyBlocks(source)) {
      const tag = (tag: string): string | null =>
        new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block)?.[1]?.trim() ?? null;
      const groupId = tag("groupId");
      const depArtifact = tag("artifactId");
      const version = tag("version");
      if (!groupId || !depArtifact || !version) continue;
      if (version.startsWith("${")) continue;
      manifest.dependencies[`${groupId}:${depArtifact}`] = version;
    }
  } else {
    const nameMatch =
      /group\s*=\s*["']([^"']+)["'][^]*?version\s*=\s*["']([^"'$]+)["']|^version\s*=\s*["']([^"'$]+)["']/m.exec(
        source,
      );
    if (nameMatch) {
      manifest.version = (nameMatch[2] ?? nameMatch[3] ?? null)?.trim() || null;
    }
    const depLine =
      /(?:implementation|api|compile|runtimeOnly)\s+\(?["']([^"':\s]+):([^"':\s]+):([^"'\s+]+)["']/g;
    for (const match of source.matchAll(depLine)) {
      const groupId = match[1];
      const artifactId = match[2];
      const version = match[3];
      if (!groupId || !artifactId || !version) continue;
      manifest.dependencies[`${groupId}:${artifactId}`] = version;
    }
  }
  void relPath;
  return { path: relPath, format: isPom ? "maven" : "gradle", manifest };
}

/**
 * Extracts L1 usages from a single Java source file:
 * - IMPORT: `import com.stripe.Stripe;`
 * - INITIALIZATION: `StripeClient client = new StripeClient(key);`
 * - METHOD_CALL: chains rooted at a tracked alias (`client.customers.list()`)
 *   or at the imported class's static surface (`Stripe.apiKey = ...`) when the
 *   root segment itself is a tracked name.
 */
export async function extractJavaUsages(
  source: string,
  relPath: string,
  trackSet: Set<string>,
): Promise<AnalyzedUsage[]> {
  if (trackSet.size === 0) return [];
  const parser = await loadParser();
  const tree = parser.parse(source);
  const usages: AnalyzedUsage[] = [];

  // Local variables bound to tracked constructors -> package name.
  const bindings = new Map<string, string>();
  // Split lines once per file (excerptAt is called per usage; re-splitting the
  // whole source each time is O(n²) on large files).
  const sourceLines = source.split("\n");

  const excerptAt = (node: TsNode): string => {
    const line = sourceLines[node.startPosition.row] ?? "";
    return line.trim().slice(0, 120);
  };

  const addUsage = (
    packageName: string,
    usageType: AnalyzedUsage["usageType"],
    symbol: string,
    node: TsNode,
  ) => {
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

  /** Root identifier text of an attribute/method chain or type name, or null. */
  const rootIdentifierOf = (node: TsNode): string | null => {
    let cursor = node;
    while (true) {
      if (cursor.type === "identifier" || cursor.type === "type_identifier") return cursor.text;
      if (cursor.type === "method_invocation" || cursor.type === "field_access") {
        const obj = cursor.childForFieldName("object");
        if (obj === null) return null;
        cursor = obj;
        continue;
      }
      return null;
    }
  };

  function walk(node: TsNode): void {
    if (node.type === "import_declaration") {
      // text like: import com.stripe.Stripe;  |  import com.stripe.model.*;\nimport static x.Y;
      const match = /(?:^|\s)import\s+(?:static\s+)?([\w.]+)\s*;/.exec(node.text);
      const importPath = match?.[1];
      if (importPath && matchesTrackSet(importPath, trackSet)) {
        const pkg = importPath.split(".").find((segment) => trackSet.has(segment));
        if (pkg) {
          addUsage(pkg, UsageType.IMPORT, importPath, node);
          // Bind the simple class name so `new Stripe(...)` resolves.
          const simpleName = importPath.split(".").pop();
          if (simpleName && /^[A-Z]/.test(simpleName)) bindings.set(simpleName, pkg);
        }
      }
    } else if (node.type === "object_creation_expression") {
      const ctor = node.childForFieldName("type");
      const root = ctor !== null ? rootIdentifierOf(ctor) : null;
      const pkg = root !== null ? bindings.get(root) : undefined;
      if (root !== null && pkg) {
        addUsage(pkg, UsageType.INITIALIZATION, root, node);
      }
      // Variable binding is handled by the variable_declarator branch below.
    } else if (node.type === "variable_declarator") {
      const nameNode = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      if (nameNode !== null && value !== null && value.type === "object_creation_expression") {
        const typeNode = value.childForFieldName("type");
        const typeName = typeNode !== null ? rootIdentifierOf(typeNode) : null;
        const pkg = typeName !== null ? bindings.get(typeName) : undefined;
        if (pkg) bindings.set(nameNode.text, pkg);
      }
    } else if (node.type === "assignment_expression") {
      // Static config writes on a tracked root: Stripe.apiKey = "...";
      const left = node.childForFieldName("left");
      if (left !== null && left.type === "field_access") {
        const root = rootIdentifierOf(left);
        if (root !== null) {
          const pkg = bindings.get(root);
          if (pkg) {
            addUsage(
              pkg,
              UsageType.METHOD_CALL,
              left.text.split("=")[0]?.trim() ?? left.text,
              node,
            );
          } else if (trackSet.has(root)) {
            addUsage(
              root,
              UsageType.METHOD_CALL,
              left.text.split("=")[0]?.trim() ?? left.text,
              node,
            );
          }
        }
      }
      // Local variable bound to a tracked constructor: Gson gson = new Gson();
      const nameNode = node.childForFieldName("name") ?? left;
      const value = node.childForFieldName("right");
      if (
        nameNode !== null &&
        nameNode.type === "identifier" &&
        value !== null &&
        value.type === "object_creation_expression"
      ) {
        const typeNode = value.childForFieldName("type");
        const typeName = typeNode !== null ? rootIdentifierOf(typeNode) : null;
        const pkg = typeName !== null ? bindings.get(typeName) : undefined;
        if (pkg) bindings.set(nameNode.text, pkg);
      }
    } else if (node.type === "method_invocation") {
      const root = rootIdentifierOf(node);
      if (root !== null) {
        const pkg = bindings.get(root);
        if (pkg) {
          // Full chain text up to '(' gives client.chat.completions.create-style symbols.
          const chainText = node.text.split("(")[0] ?? node.text;
          addUsage(pkg, UsageType.METHOD_CALL, chainText, node);
        } else if (trackSet.has(root)) {
          // Static call on the tracked top-level name itself (e.g. Stripe.apiKey).
          const chainText = node.text.split("(")[0] ?? node.text;
          addUsage(root, UsageType.METHOD_CALL, chainText, node);
        }
      }
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(tree.rootNode);
  usages.sort((a, b) => a.line - b.line || a.column - b.column);

  // De-duplicate nested method invocations: keep the outermost (longest-chain)
  // usage per line via a single map pass — no O(n²) findIndex rescan.
  const methodByLine = new Map<number, AnalyzedUsage>();
  const deduped: AnalyzedUsage[] = [];
  for (const usage of usages) {
    if (usage.usageType === UsageType.METHOD_CALL) {
      const existing = methodByLine.get(usage.line);
      if (existing === undefined || usage.symbol.length > existing.symbol.length) {
        methodByLine.set(usage.line, usage);
      }
      continue;
    }
    deduped.push(usage);
  }
  const methodCalls = [...methodByLine.values()].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  return [...deduped, ...methodCalls];
}

/**
 * Syntax-level validity check for patched Java content: true only when the
 * source parses without ERROR/MISSING nodes. The remediation engine uses this
 * as the Java counterpart of the TypeScript re-parse check.
 */
export async function javaSyntaxCheck(source: string): Promise<boolean> {
  const parser = await loadParser();
  const rootNode = parser.parse(source).rootNode;
  return rootNode.hasError !== true;
}
