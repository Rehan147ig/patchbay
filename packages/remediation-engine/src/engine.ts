import { readFileSync } from "node:fs";
import path from "node:path";
import { GenerationMethod, SCORING } from "@patchbay/domain";
import { evaluatePlanCircuitBreaker, resolvePlanLimits } from "@patchbay/policy-engine";
import { javaSyntaxCheck, pythonSyntaxCheck } from "@patchbay/repo-analysis";
import * as ts from "typescript";
import { sha256Hex, unifiedDiff } from "./diff";
import { attributeSurfaces, type RepairSurface } from "./surface";
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
export function applyPythonClientBootstrap(content: string, eol = "\n"): string {
  if (OPENAI_CLIENT_CONSTRUCTION.test(content)) return content;
  const lines = content.split(/\r?\n/);
  const parts: string[] = [];
  if (!OPENAI_CLIENT_IMPORT.test(content)) parts.push("from openai import OpenAI");
  parts.push("client = OpenAI()");
  const lastImportIndex = lastTopLevelImportLine(lines);
  if (lastImportIndex === -1) {
    return [...parts, "", ...lines].join(eol);
  }
  lines.splice(lastImportIndex + 1, 0, "", ...parts.flatMap((part) => [part, ""]));
  return lines.join(eol);
}

function applyLineRename(
  fileText: string,
  line: number,
  from: string,
  to: string,
  eol = "\n",
): string {
  const lines = fileText.split(/\r?\n/);
  const target = lines[line - 1];
  if (target === undefined) return fileText;
  if (!target.includes(from)) return fileText;
  lines[line - 1] = target.split(from).join(to);
  return lines.join(eol);
}

/** Feature-adoption edit: insert text right after a search string on the usage line. */
function applyLineInsert(
  fileText: string,
  line: number,
  searchText: string,
  insertText: string,
  eol = "\n",
): string {
  const lines = fileText.split(/\r?\n/);
  const target = lines[line - 1];
  if (target === undefined) return fileText;
  if (!target.includes(searchText)) return fileText;
  lines[line - 1] = target.split(searchText).join(`${searchText}${insertText}`);
  return lines.join(eol);
}

/** Model-retirement edit: swap one quoted model id for another on the usage line. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyModelUpdate(
  fileText: string,
  line: number,
  update: { from: string; to: string },
  eol = "\n",
): string {
  const lines = fileText.split(/\r?\n/);
  const target = lines[line - 1];
  if (target === undefined) return fileText;
  const quoted = new RegExp(`(['"])${escapeRegExp(update.from)}\\1`);
  if (!quoted.test(target)) return fileText;
  lines[line - 1] = target.replace(
    quoted,
    (_match, quote: string) => `${quote}${update.to}${quote}`,
  );
  return lines.join(eol);
}

function applyResponseUnwrap(fileText: string, symbol: string, _eol = "\n"): string {
  const match = RESPONSE_UNWRAP_PATTERN.exec(symbol);
  if (!match) return fileText;
  const chain = match[1];
  // Only unwrap the validated chain, not arbitrary globals. Runs after renames.
  if (!fileText.includes(`${chain}.data`)) return fileText;
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

const LANE_LABEL: Record<RepairSurface, string> = {
  sdk: "SDK",
  api: "API",
  webhook: "webhook",
  unclassified: "unclassified",
};

const LANE_ORDER: readonly RepairSurface[] = ["sdk", "api", "webhook", "unclassified"];

/**
 * Per-surface outcome report for the strategy string — the four disclosure
 * categories: repaired, affected-but-not-safely-repairable (webhook lane),
 * analyzed-and-unaffected (surface in the change, no consumers), and not in
 * this change (surfaces the change never touched). Explicit non-actions are
 * the point: the reviewer sees what was checked and left alone, not just
 * what was edited.
 */
function describeLaneOutcomes(args: {
  activeSurfaces: RepairSurface[];
  repairedFilesByLane: Map<RepairSurface, number>;
  involvedCountByLane: Map<RepairSurface, number>;
  webhookUnrepairable: Array<{ filePath: string; symbol: string }>;
}): string {
  const parts: string[] = [];
  const repaired = LANE_ORDER.filter((lane) => (args.repairedFilesByLane.get(lane) ?? 0) > 0).map(
    (lane) => `${LANE_LABEL[lane]} ${args.repairedFilesByLane.get(lane)} file(s)`,
  );
  if (repaired.length > 0) parts.push(`Repaired: ${repaired.join(", ")}.`);
  if (args.webhookUnrepairable.length > 0) {
    const shown = args.webhookUnrepairable
      .slice(0, 5)
      .map((u) => `${u.filePath}:${u.symbol}`)
      .join(", ");
    const extra =
      args.webhookUnrepairable.length > 5 ? ` (+${args.webhookUnrepairable.length - 5} more)` : "";
    parts.push(
      `Webhook: ${args.webhookUnrepairable.length} handler(s) affected but no safe rule — human review (${shown}${extra}).`,
    );
  }
  const unaffected = args.activeSurfaces.filter(
    (surface) => surface !== "unclassified" && (args.involvedCountByLane.get(surface) ?? 0) === 0,
  );
  if (unaffected.length > 0) {
    parts.push(
      `Analyzed and unaffected: ${unaffected.map((surface) => LANE_LABEL[surface]).join(", ")} (change present, no affected consumers).`,
    );
  }
  const notInChange = (["sdk", "api", "webhook"] as const).filter(
    (surface) => !args.activeSurfaces.includes(surface),
  );
  if (notInChange.length > 0 && notInChange.length < 3) {
    parts.push(
      `Not in this change: ${notInChange.map((surface) => LANE_LABEL[surface]).join(", ")}.`,
    );
  }
  return parts.join(" ");
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

  // Surface-routed repair lanes: detection stays interconnected (one usage
  // graph, one pipeline), but each edit family runs only for its surface. The
  // response unwrap is an API-surface rewrite, so it applies exclusively to
  // files with API-lane membership — symbol linkage, usage-type hint, or API
  // symbol text in the file. A file with none of those is genuinely outside
  // the API break and must not gain `.data` rewrites. Symbol-targeted
  // suggestions stay precise by construction (exact symbol match) and apply
  // wherever used; their lane attribution feeds the outcome report below.
  const attribution = attributeSurfaces({
    usages,
    patchSuggestions,
    normalizations,
    // File text for the API text match (surface.ts): a failed read yields
    // null and simply disables text matching for that file — the patch loop
    // below skips unreadable files the same way.
    readFile: (filePath) => {
      try {
        return readFileSync(path.join(fixtureDir, filePath), "utf8");
      } catch {
        return null;
      }
    },
  });
  const apiLaneFiles = attribution.filesByLane.get("api") ?? new Set<string>();

  // Webhook lane has no deterministic text rules yet: affected handlers and
  // validators without a suggestion are reported (never silently dropped) and
  // force human review — the "affected but not safely auto-repaired" outcome.
  // Certified connectors never emit WEBHOOK_CHANGE today, so this gate cannot
  // flip existing certified plans; it activates for webhook-carrying changes.
  const webhookUnrepairable: Array<{ filePath: string; symbol: string }> = [];
  usages.forEach((usage, index) => {
    if (attribution.usageLanes.get(index)?.has("webhook") && !renameBySymbol.has(usage.symbol)) {
      webhookUnrepairable.push({ filePath: usage.filePath, symbol: usage.symbol });
    }
  });

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
    // API-lane scope: only files participating in the API surface claim the
    // unwrap. SDK-only files must not gain API rewrite descriptions (or the
    // 90-confidence edits behind them) merely because an API normalization
    // exists elsewhere in the same change.
    if (!apiLaneFiles.has(filePath)) continue;
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
  const repairedFilesByLane = new Map<RepairSurface, number>();
  const involvedCountByLane = attribution.involvedCountByLane;

  for (const [filePath, edits] of editsByFile) {
    const absolutePath = path.join(fixtureDir, filePath);
    let original: string;
    try {
      original = readFileSync(absolutePath, "utf8");
    } catch {
      skippedFiles.push(filePath);
      continue;
    }

    // TOCTOU guard: per-file expected hash (reuses PatchPlanEdit.expectedSourceHash / sha256Hex).
    // If caller supplied expectedFileHashes (captured at analysis time), fail-closed per file on mismatch.
    if (input.expectedFileHashes) {
      const expected =
        input.expectedFileHashes instanceof Map
          ? input.expectedFileHashes.get(filePath)
          : (input.expectedFileHashes as Record<string, string>)[filePath];
      if (expected !== undefined) {
        const actualHash = sha256Hex(original);
        if (actualHash !== expected) {
          skippedFiles.push(filePath);
          continue;
        }
      }
    }

    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    let patched = original;
    let bootstrapped = false;
    // Lanes that actually altered this file's text (honest repair
    // attribution for the outcome report — a matched-but-no-op edit claims
    // no lane).
    const repairedLanes = new Set<RepairSurface>();
    const laneOf = (symbol: string, usageIndex: number): Set<RepairSurface> => {
      // Union of the rule's lane (via the linked normalization) and the
      // usage's lane (via symbol linkage or usage-type hint): an edit applied
      // to a webhook handler file repairs the webhook lane even when the
      // rule itself came through the legacy unclassified path.
      const lanes = new Set<RepairSurface>(
        attribution.suggestionLanes.get(symbol) ?? ["unclassified"],
      );
      for (const lane of attribution.usageLanes.get(usageIndex) ?? []) lanes.add(lane);
      return lanes;
    };
    // 1. Stable line renames on original coordinates (no drift during loop).
    for (const [usageIndex, usage] of usages.entries()) {
      if (usage.filePath !== filePath) continue;
      const suggestion = renameBySymbol.get(usage.symbol);
      if (!suggestion) continue;
      const lanes = laneOf(usage.symbol, usageIndex);
      const applyInLane = (next: string): void => {
        if (next !== patched) {
          patched = next;
          for (const lane of lanes) repairedLanes.add(lane);
        }
      };
      applyInLane(
        applyLineRename(patched, usage.line, suggestion.symbol, suggestion.replacement, eol),
      );
      if (suggestion.insert) {
        applyInLane(
          applyLineInsert(
            patched,
            usage.line,
            suggestion.insert.searchText,
            suggestion.insert.insertText,
            eol,
          ),
        );
      }
      if (suggestion.modelUpdate) {
        applyInLane(applyModelUpdate(patched, usage.line, suggestion.modelUpdate, eol));
      }
    }
    // 2. Post-rename bootstrap (zero shifting during renames).
    {
      const triggering = [...usages.entries()].filter(
        ([, u]) =>
          u.filePath === filePath &&
          isPythonClientRename(renameBySymbol.get(u.symbol)?.replacement ?? ""),
      );
      if (triggering.length > 0 && PYTHON_FILE.test(filePath)) {
        const withBootstrap = applyPythonClientBootstrap(patched, eol);
        if (withBootstrap !== patched) {
          patched = withBootstrap;
          bootstrapped = true;
          for (const [usageIndex, u] of triggering)
            for (const lane of laneOf(u.symbol, usageIndex)) repairedLanes.add(lane);
        }
      }
    }
    // API-lane scope (see attribution block above): the unwrap rewrite runs
    // only on files participating in the API surface.
    if (apiLaneFiles.has(filePath)) {
      for (const symbol of unwrapSymbols) {
        const before = patched;
        patched = applyResponseUnwrap(patched, symbol, eol);
        if (patched !== before) repairedLanes.add("api");
      }
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
    for (const lane of repairedLanes) {
      repairedFilesByLane.set(lane, (repairedFilesByLane.get(lane) ?? 0) + 1);
    }
    for (const edit of edits) {
      proposedChanges.push({ description: edit.description, filePath });
    }
  }

  const laneReport = describeLaneOutcomes({
    activeSurfaces: attribution.activeSurfaces,
    repairedFilesByLane,
    involvedCountByLane,
    webhookUnrepairable,
  });

  if (patches.length === 0) {
    return {
      strategy: `No deterministic rule matched usages of ${repositoryName}. Plan-only; an AI-assisted draft can propose next steps, but no patch is generated without a verified rule.${laneReport ? ` ${laneReport}` : ""}`,
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
      const rejected = tsPatches.filter((p) => badFiles.has(p.filePath));
      for (const p of rejected) {
        skippedFiles.push(p.filePath);
      }
      const kept = patches.filter((p) => !badFiles.has(p.filePath));
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

  // Circuit breaker: check plan file count, max edits per file, and patch byte size
  const maxEditsInAnyFile = Math.max(0, ...Array.from(editsByFile.values()).map((e) => e.length));
  const maxPatchBytesInAnyFile = Math.max(
    0,
    ...patches.map((p) => Buffer.byteLength(p.patched, "utf8")),
  );
  const planCircuit = evaluatePlanCircuitBreaker(
    {
      fileCount: patches.length,
      maxEditsInAnyFile,
      maxPatchBytesInAnyFile,
    },
    // WP6: when the caller supplies the certified rule pack, its edit budget
    // tightens the global breaker caps (min per field — packs only tighten).
    // Absent pack = global defaults, identical to pre-WP6 behavior.
    resolvePlanLimits(input.rulePack),
  );

  // Safe stopping: webhook handlers the lanes could match but no rule can
  // rewrite always require a human, even when other lanes patched cleanly.
  const requiresHumanReview =
    planConfidence < SCORING.CONFIDENCE_MIN_PATCH ||
    !planCircuit.ok ||
    webhookUnrepairable.length > 0;

  const circuitBreakerNote = !planCircuit.ok
    ? ` [Circuit breaker throttled: ${planCircuit.reasons.join("; ")}]`
    : "";

  return {
    strategy: `Rule-based migration for ${repositoryName}: ${appliedConfidences.length} file(s) patched with deterministic rules, each re-parsed successfully. ${laneReport}${circuitBreakerNote}`,
    proposedChanges,
    confidence: planConfidence,
    requiresHumanReview,
    patches,
    skippedFiles,
  };
}
