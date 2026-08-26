import { readFileSync } from "node:fs";
import path from "node:path";
import { GenerationMethod, SCORING } from "@patchbay/domain";
import { javaSyntaxCheck, pythonSyntaxCheck } from "@patchbay/repo-analysis";
import * as ts from "typescript";
import { sha256Hex, unifiedDiff } from "./diff";
import type { PatchDraft, PlanDraft, PlanInput } from "./types";

/**
 * Deterministic migration-rule engine.
 *
 * Takes an impact assessment's affected usages + the vendor connector's patch
 * suggestions and normalizations, and produces a structured remediation plan:
 * source-text edits applied at indexed usage locations (symbol renames) plus
 * scoped pattern rules (e.g. v4 response unwrap), each file re-parsed with the
 * TypeScript compiler (TS/JS) or tree-sitter (Python) to guarantee the patched
 * file still parses. Python files patched with a client-based rename also get
 * a deterministic `from openai import OpenAI` / `client = OpenAI()` bootstrap.
 * Only then is a unified diff emitted. No rule matched -> plan-only draft.
 */

const RESPONSE_UNWRAP_PATTERN = /^([A-Za-z_$][\w$]*)\.data$/;
const PYTHON_FILE = /\.py$/;
const JAVA_FILE = /\.java$/i;
const OPENAI_CLIENT_IMPORT = /^from\s+openai\s+import\s+/m;
const OPENAI_CLIENT_CONSTRUCTION = /=\s*OpenAI\(/;

/** True when a suggestion rewrites a module call onto the v1 client variable. */
function isPythonClientRename(replacement: string): boolean {
  return replacement.startsWith("client.");
}

function lastTopLevelImportLine(lines: string[]): number {
  const limit = Math.min(lines.length, 60);
  let index = -1;
  for (let i = 0; i < limit; i += 1) {
    if (/^(import\s|from\s)/.test(lines[i] ?? "")) index = i;
  }
  return index;
}

/**
 * Inserts the openai-python v1 client bootstrap (`from openai import OpenAI`,
 * `client = OpenAI()`) after the module's import block — or at the top when no
 * import block exists. Idempotent: no-op when a client construction is already
 * present. The constructor reads OPENAI_API_KEY, which the human reviewer must
 * confirm matches how the legacy code supplied credentials.
 */
export function applyPythonClientBootstrap(content: string): string {
  if (OPENAI_CLIENT_CONSTRUCTION.test(content)) return content;
  const lines = content.split("\n");
  const parts: string[] = [];
  if (!OPENAI_CLIENT_IMPORT.test(content)) parts.push("from openai import OpenAI");
  parts.push("client = OpenAI()");
  const lastImportIndex = lastTopLevelImportLine(lines);
  if (lastImportIndex === -1) {
    return [...parts, "", ...lines].join("\n");
  }
  lines.splice(lastImportIndex + 1, 0, "", ...parts.flatMap((part) => [part, ""]));
  return lines.join("\n");
}

function applyLineRename(fileText: string, line: number, from: string, to: string): string {
  const lines = fileText.split(/\r?\n/);
  const target = lines[line - 1];
  if (target === undefined) return fileText;
  if (!target.includes(from)) return fileText;
  lines[line - 1] = target.split(from).join(to);
  return lines.join("\n");
}

/** Feature-adoption edit: insert text right after a search string on the usage line. */
function applyLineInsert(
  fileText: string,
  line: number,
  searchText: string,
  insertText: string,
): string {
  const lines = fileText.split(/\r?\n/);
  const target = lines[line - 1];
  if (target === undefined) return fileText;
  if (!target.includes(searchText)) return fileText;
  lines[line - 1] = target.split(searchText).join(`${searchText}${insertText}`);
  return lines.join("\n");
}

function applyResponseUnwrap(fileText: string, symbol: string): string {
  const match = RESPONSE_UNWRAP_PATTERN.exec(symbol);
  if (!match) return fileText;
  const chain = match[1];
  return fileText.split(`${chain}.data`).join(chain);
}

/** Re-parses patched content; true only when the file still parses (validation proxy). */
export function reparseCheck(filePath: string, content: string): boolean {
  const result = ts.transpileModule(content, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  const diagnostics = result.diagnostics ?? [];
  return diagnostics.length === 0;
}

/**
 * Language-aware patch validation proxy. Python files re-parse through
 * tree-sitter (syntax only), everything else through the TypeScript compiler.
 */
export async function validatePatchSyntax(filePath: string, content: string): Promise<boolean> {
  if (PYTHON_FILE.test(filePath)) return pythonSyntaxCheck(content);
  if (JAVA_FILE.test(filePath)) return javaSyntaxCheck(content);
  return reparseCheck(filePath, content);
}

export async function generatePlan(input: PlanInput): Promise<PlanDraft> {
  const {
    fixtureDir,
    repositoryName,
    usages,
    patchSuggestions,
    normalizations,
    assessmentConfidence,
  } = input;

  const renameBySymbol = new Map(
    patchSuggestions.map((suggestion) => [suggestion.symbol, suggestion]),
  );

  const unwrapSymbols = normalizations
    .filter(
      (normalization) =>
        normalization.changeType === "RESPONSE_FIELD_REMOVED" &&
        normalization.affectedSymbols.some((symbol) => RESPONSE_UNWRAP_PATTERN.test(symbol)),
    )
    .flatMap((normalization) => normalization.affectedSymbols)
    .filter((symbol) => RESPONSE_UNWRAP_PATTERN.test(symbol));

  interface PlannedEdit {
    filePath: string;
    description: string;
    confidence: number;
  }
  const editsByFile = new Map<string, PlannedEdit[]>();
  const renameFiles = new Set<string>();

  for (const usage of usages) {
    const suggestion = renameBySymbol.get(usage.symbol);
    if (!suggestion) continue;
    renameFiles.add(usage.filePath);
    const list = editsByFile.get(usage.filePath) ?? [];
    list.push({
      filePath: usage.filePath,
      description: suggestion.description,
      confidence: suggestion.confidence,
    });
    editsByFile.set(usage.filePath, list);
  }

  for (const filePath of renameFiles) {
    for (const symbol of unwrapSymbols) {
      const list = editsByFile.get(filePath) ?? [];
      list.push({
        filePath,
        description: `Response unwrap: ${symbol} is gone in v4; use the chain without .data.`,
        confidence: 90,
      });
      editsByFile.set(filePath, list);
    }
  }

  const patches: PatchDraft[] = [];
  const skippedFiles: string[] = [];
  const proposedChanges: Array<{ description: string; filePath: string }> = [];
  const appliedConfidences: number[] = [];

  for (const [filePath, edits] of editsByFile) {
    const absolutePath = path.join(fixtureDir, filePath);
    let original: string;
    try {
      original = readFileSync(absolutePath, "utf8");
    } catch {
      skippedFiles.push(filePath);
      continue;
    }

    let patched = original;
    let bootstrapped = false;
    for (const usage of usages) {
      if (usage.filePath !== filePath) continue;
      const suggestion = renameBySymbol.get(usage.symbol);
      if (!suggestion) continue;
      patched = applyLineRename(patched, usage.line, suggestion.symbol, suggestion.replacement);
      if (suggestion.insert) {
        patched = applyLineInsert(
          patched,
          usage.line,
          suggestion.insert.searchText,
          suggestion.insert.insertText,
        );
      }
      if (
        PYTHON_FILE.test(filePath) &&
        isPythonClientRename(suggestion.replacement) &&
        !bootstrapped
      ) {
        const withBootstrap = applyPythonClientBootstrap(patched);
        if (withBootstrap !== patched) {
          patched = withBootstrap;
          bootstrapped = true;
        }
      }
    }
    for (const symbol of unwrapSymbols) {
      patched = applyResponseUnwrap(patched, symbol);
    }

    if (patched === original) {
      skippedFiles.push(filePath);
      continue;
    }
    if (!(await validatePatchSyntax(filePath, patched))) {
      skippedFiles.push(filePath);
      continue;
    }

    const confidence = Math.min(...edits.map((edit) => edit.confidence));
    const description = (
      edits.map((edit) => edit.description).join(" ") +
      (bootstrapped
        ? " Ensured the openai-python v1 client bootstrap (`client = OpenAI()`); confirm credentials."
        : "")
    ).trim();
    patches.push({
      filePath,
      original,
      patched,
      unifiedDiff: unifiedDiff(original, patched, filePath),
      originalHash: sha256Hex(original),
      patchedHash: sha256Hex(patched),
      generationMethod: GenerationMethod.RULE_BASED,
      confidence,
      description,
    });
    appliedConfidences.push(confidence);
    for (const edit of edits) {
      proposedChanges.push({ description: edit.description, filePath });
    }
  }

  if (patches.length === 0) {
    return {
      strategy: `No deterministic rule matched usages of ${repositoryName}. Plan-only; an AI-assisted draft can propose next steps, but no patch is generated without a verified rule.`,
      proposedChanges: [],
      confidence: Math.min(assessmentConfidence, 60),
      requiresHumanReview: true,
      patches: [],
      skippedFiles,
    };
  }

  // Semantic validation gate: type-check ALL patched files together as an
  // in-memory overlay over the original project. Cross-file errors (missing
  // imports, renamed symbols referenced elsewhere) only surface when the full
  // set is checked together — not file by file. Files whose patches introduce
  // new errors are rejected; pre-existing errors are ignored.
  const tsPatches = patches.filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p.filePath));
  if (tsPatches.length > 0) {
    const { runSemanticGate } = await import("./semantic-gate");
    const overlay = new Map<string, string>();
    for (const p of tsPatches) {
      overlay.set(p.filePath, p.patched);
    }
    const gate = runSemanticGate({
      projectDir: fixtureDir,
      patchedFiles: overlay,
    });

    if (!gate.ok) {
      const badFiles = new Set(gate.newErrors.map((e) => e.filePath));
      const surviving = tsPatches.filter((p) => !badFiles.has(p.filePath));
      const rejected = tsPatches.filter((p) => badFiles.has(p.filePath));
      for (const p of rejected) {
        skippedFiles.push(p.filePath);
      }
      const kept = patches.filter(
        (p) => !badFiles.has(p.filePath),
      );
      const rejectSummary = [...badFiles]
        .map((f) => `${f} (${gate.newErrors.filter((e) => e.filePath === f).length} errors)`)
        .join(", ");
      return {
        strategy: `Rule-based migration for ${repositoryName}: ${kept.length} of ${patches.length} patch(es) passed the semantic gate. Rejected: ${rejectSummary}.`,
        proposedChanges: kept.flatMap((p) =>
          proposedChanges.filter((pc) => pc.filePath === p.filePath),
        ),
        confidence: Math.min(...kept.map((p) => p.confidence)),
        requiresHumanReview: true,
        patches: kept,
        skippedFiles,
      };
    }
  }

  const planConfidence = Math.min(...appliedConfidences);
  return {
    strategy: `Rule-based migration for ${repositoryName}: ${appliedConfidences.length} file(s) patched with deterministic rules (symbol rename, response unwrap, feature adoption), each re-parsed successfully.`,
    proposedChanges,
    confidence: planConfidence,
    requiresHumanReview: planConfidence < SCORING.CONFIDENCE_MIN_PATCH,
    patches,
    skippedFiles,
  };
}
