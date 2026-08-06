import { readFileSync } from "node:fs";
import path from "node:path";
import { GenerationMethod, SCORING } from "@patchbay/domain";
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
 * TypeScript compiler to guarantee the patched file still parses. Only then is
 * a unified diff emitted. No rule matched -> plan-only draft.
 */

const RESPONSE_UNWRAP_PATTERN = /^([A-Za-z_$][\w$]*)\.data$/;

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

function reparseCheck(filePath: string, content: string): boolean {
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

export function generatePlan(input: PlanInput): PlanDraft {
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
    }
    for (const symbol of unwrapSymbols) {
      patched = applyResponseUnwrap(patched, symbol);
    }

    if (patched === original) {
      skippedFiles.push(filePath);
      continue;
    }
    if (!reparseCheck(filePath, patched)) {
      skippedFiles.push(filePath);
      continue;
    }

    const confidence = Math.min(...edits.map((edit) => edit.confidence));
    patches.push({
      filePath,
      original,
      patched,
      unifiedDiff: unifiedDiff(original, patched, filePath),
      originalHash: sha256Hex(original),
      patchedHash: sha256Hex(patched),
      generationMethod: GenerationMethod.RULE_BASED,
      confidence,
      description: edits.map((edit) => edit.description).join(" "),
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
