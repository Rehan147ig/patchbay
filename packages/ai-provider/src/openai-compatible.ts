import { readFileSync } from "node:fs";
import path from "node:path";
import { aiPlanDraftSchema, type AiPlanDraft, type ChangeType } from "@patchbay/domain";
import { sanitizeField, wrapUntrusted } from "./prompt-safety";

/** Redacted, size-bounded context for the AI provider. Never contains secrets. */
export interface AiPlanDraftInput {
  vendorSlug: string;
  changeType: ChangeType;
  oldValue?: string;
  newValue?: string;
  description?: string;
  affectedSymbols: string[];
  /** Bounded excerpts of affected usages (truncated by the caller). */
  usages: Array<{ filePath: string; excerpt: string }>;
}

export interface AiProvider {
  /** Drafts an advisory remediation plan. Output is parsed through aiPlanDraftSchema. */
  draftRemediationPlan(input: AiPlanDraftInput): Promise<AiPlanDraft>;

  /**
   * Agent-harness planner call: emits the raw model output for a typed
   * PatchPlan request. The harness (packages/ai-harness) owns schema
   * conformance, budgeting, and persistence; this method is pure transport.
   * Returns `unknown` JSON — validation happens in the harness.
   */
  generatePatchPlan(input: PatchPlanPromptRequest): Promise<AiProviderResult>;

  /** Independent reviewer call: compares evidence vs plan vs validation evidence. */
  reviewPatchPlan(input: PlanReviewPromptRequest): Promise<AiProviderResult>;
}

/** Usage/cost metadata returned alongside any provider output. */
export interface AiProviderResult {
  output: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    model: string;
  } | null;
}

/** Bounded, sanitized planner request. Must never contain secrets or unbounded repo content. */
export interface PatchPlanPromptRequest {
  templateVersion: string;
  vendorSlug: string;
  packageName: string;
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  resolvedVersion: string | null;
  declaredRange: string | null;
  drafts: Array<{
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    description: string | null;
    breaking: boolean;
    affectedSymbols: string[];
    rule: string | null;
  }>;
  modules: Array<{ filePath: string; edgeKinds: string[]; evidenceCount: number }>;
}

/** Bounded reviewer request: the proposal plus the evidence it must be checked against. */
export interface PlanReviewPromptRequest {
  templateVersion: string;
  packageName: string;
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  plan: {
    rationale: string;
    confidence: number;
    edits: Array<{
      filePath: string;
      operation: string;
      description: string;
    }>;
    addressedSymbols: string[];
  };
  evidence: {
    modules: Array<{ filePath: string; edgeKinds: string[] }>;
  };
}

export interface OpenAiCompatibleConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const OPENAI_COMPATIBLE_TEMPLATE_PATH = () =>
  path.join(process.cwd(), "packages", "ai-provider", "prompts", "plan-draft.md");

export const PLAN_GENERATION_TEMPLATE_PATH = () =>
  path.join(process.cwd(), "packages", "ai-provider", "prompts", "plan-generation.md");

export const PLAN_REVIEW_TEMPLATE_PATH = () =>
  path.join(process.cwd(), "packages", "ai-provider", "prompts", "plan-review.md");

/** Inline fallback so the provider stays functional even if the file is absent. */
const FALLBACK_SYSTEM_PROMPT = `You are Patchbay, an API-change remediation advisor. Given a vendor API change and affected code usages, produce a remediation plan draft. Respond with strict JSON only. The plan is advisory: it must not contain shell commands, and every suggestion must be grounded in the provided change details.`;

const FALLBACK_PLAN_GENERATION_PROMPT = `You are Patchbay's migration planner. Given trusted release facts (deterministic change drafts) and bounded graph evidence of affected modules, produce a strict-JSON PatchPlan: edits are declarative file edits (filePath, operation REPLACE|INSERT_AFTER|DELETE, searchText, replacement, description, confidence), each grounded in the provided drafts. Never invent files, symbols, or content not grounded in the input. The plan is a proposal; it must never contain shell commands or credentials.`;

const FALLBACK_PLAN_REVIEW_PROMPT = `You are Patchbay's independent reviewer. Compare the release evidence (change drafts), the proposed plan edits, and validation evidence. Return strict JSON: { approved, independent: true, confidence, summary, issues: [{severity: error|warning|info, target: plan|evidence|validation, message}] }. Be conservative: approval requires every breaking affected symbol to be addressed by the plan.`;

export function loadPlanDraftTemplate(): string {
  try {
    return readFileSync(OPENAI_COMPATIBLE_TEMPLATE_PATH(), "utf8");
  } catch {
    return FALLBACK_SYSTEM_PROMPT;
  }
}

export function loadPlanGenerationTemplate(): string {
  try {
    return readFileSync(PLAN_GENERATION_TEMPLATE_PATH(), "utf8");
  } catch {
    return FALLBACK_PLAN_GENERATION_PROMPT;
  }
}

export function loadPlanReviewTemplate(): string {
  try {
    return readFileSync(PLAN_REVIEW_TEMPLATE_PATH(), "utf8");
  } catch {
    return FALLBACK_PLAN_REVIEW_PROMPT;
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly systemPrompt: string;
  private readonly planGenerationPrompt: string;
  private readonly planReviewPrompt: string;

  constructor(config: OpenAiCompatibleConfig) {
    if (!config.apiKey || config.apiKey.length === 0) {
      throw new Error("OpenAiCompatibleProvider requires an apiKey");
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.systemPrompt = loadPlanDraftTemplate();
    this.planGenerationPrompt = loadPlanGenerationTemplate();
    this.planReviewPrompt = loadPlanReviewTemplate();
  }

  async draftRemediationPlan(input: AiPlanDraftInput): Promise<AiPlanDraft> {
    const userPrompt = buildUserPrompt(input);
    const response = await this.chatJson(
      [{ role: "system", content: this.systemPrompt }],
      userPrompt,
    );
    const parsed = this.extractJsonContent(response);
    const result = aiPlanDraftSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `AI provider output failed schema validation: ${result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return result.data;
  }

  async generatePatchPlan(input: PatchPlanPromptRequest): Promise<AiProviderResult> {
    const response = await this.chatJson(
      [{ role: "system", content: this.planGenerationPrompt }],
      buildPlanGenerationPrompt(input),
    );
    const output = this.extractJsonContent(response);
    return {
      output,
      usage: {
        inputTokens: response.promptTokens,
        outputTokens: response.completionTokens,
        model: this.model,
      },
    };
  }

  async reviewPatchPlan(input: PlanReviewPromptRequest): Promise<AiProviderResult> {
    const response = await this.chatJson(
      [{ role: "system", content: this.planReviewPrompt }],
      buildPlanReviewPrompt(input),
    );
    const output = this.extractJsonContent(response);
    return {
      output,
      usage: {
        inputTokens: response.promptTokens,
        outputTokens: response.completionTokens,
        model: this.model,
      },
    };
  }

  private async chatJson(
    messages: Array<{ role: "system" | "user"; content: string }>,
    userPrompt: string,
  ): Promise<{ content: unknown; promptTokens?: number; completionTokens?: number }> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [...messages, { role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const statusText = await safeBodyText(response);
      throw new Error(
        `AI provider request failed: ${response.status} ${response.statusText}${
          statusText ? ` - ${statusText}` : ""
        }`,
      );
    }

    let body: {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new Error("AI provider returned a non-JSON response");
    }
    return {
      content: body.choices?.[0]?.message?.content,
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
    };
  }

  private extractJsonContent(response: { content: unknown }): unknown {
    let parsed: unknown;
    if (typeof response.content === "string") {
      try {
        parsed = JSON.parse(response.content);
      } catch {
        throw new Error("AI provider returned invalid JSON in message content");
      }
    } else {
      parsed = response.content;
    }
    return parsed;
  }
}

function buildUserPrompt(input: AiPlanDraftInput): string {
  const usageLines = input.usages
    .map((usage) => `- file: ${sanitizeField(usage.filePath)}\n${wrapUntrusted(usage.excerpt)}`)
    .join("\n");
  return [
    `Vendor: ${sanitizeField(input.vendorSlug)}`,
    `Change type: ${sanitizeField(input.changeType)}`,
    `Old value: ${input.oldValue === undefined ? "n/a" : wrapUntrusted(input.oldValue)}`,
    `New value: ${input.newValue === undefined ? "n/a" : wrapUntrusted(input.newValue)}`,
    `Description: ${sanitizeField(input.description ?? "n/a")}`,
    `Affected symbols: ${input.affectedSymbols.map(sanitizeField).join(", ") || "n/a"}`,
    "Affected usages:",
    usageLines || "- none",
    "",
    "Return a JSON remediation plan draft with fields: rationale, steps, confidence, requiresHumanReview, riskLevel, riskTags, suggestedEdits, applicableChangeTypes.",
  ].join("\n");
}

async function safeBodyText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function buildPlanGenerationPrompt(input: PatchPlanPromptRequest): string {
  const draftLines = input.drafts
    .map(
      (draft) =>
        `- [${draft.changeType}${draft.breaking ? "/breaking" : ""}]` +
        ` ${sanitizeField(draft.description ?? "")}` +
        ` ${draft.oldValue ?? ""} -> ${draft.newValue ?? ""}` +
        ` symbols: ${draft.affectedSymbols.map(sanitizeField).join(", ") || "none"}` +
        ` rule: ${draft.rule ?? "none"}`,
    )
    .join("\n");
  const moduleLines = input.modules
    .map(
      (module) =>
        `- ${sanitizeField(module.filePath)} [${module.edgeKinds.join(", ")}] evidence=${module.evidenceCount}`,
    )
    .join("\n");
  return [
    `Release: ${sanitizeField(input.packageName)} ${input.fromVersion ?? "?"} -> ${input.toVersion}`,
    `Breaking: ${input.breaking}`,
    `Resolved in repository: ${input.resolvedVersion ?? "?"} declared: ${input.declaredRange ?? "?"}`,
    "Deterministic change drafts:",
    draftLines || "- none",
    `Affected modules (graph evidence, ${input.modules.length}):`,
    moduleLines || "- none",
    "Return a strict JSON PatchPlan: { releaseRecordId, repositoryId, rationale, confidence, requiresHumanReview, riskLevel, riskTags: [], edits: [{ filePath, expectedSourceHash (64 hex chars; use a placeholder of 64 zeros if unknown), operation: REPLACE|INSERT_AFTER|DELETE, searchText, replacement, precondition, description, confidence }], validationProfile: [], addressedSymbols: [] }.",
  ].join("\n");
}

function buildPlanReviewPrompt(input: PlanReviewPromptRequest): string {
  const editLines = input.plan.edits
    .map(
      (edit) =>
        `- ${sanitizeField(edit.filePath)} [${edit.operation}] ${sanitizeField(edit.description)}`,
    )
    .join("\n");
  const moduleLines = input.evidence.modules
    .map((module) => `- ${sanitizeField(module.filePath)} [${module.edgeKinds.join(", ")}]`)
    .join("\n");
  return [
    `Release: ${sanitizeField(input.packageName)} ${input.fromVersion ?? "?"} -> ${input.toVersion} (breaking=${input.breaking})`,
    `Addressed symbols: ${input.plan.addressedSymbols.map(sanitizeField).join(", ") || "none"}`,
    "Proposed plan:",
    `- rationale: ${importField(input.plan.rationale)}`,
    `- confidence: ${input.plan.confidence}`,
    editLines || "- no edits",
    "Evidence (affected modules):",
    moduleLines || "- none",
    "Return strict JSON ReviewVerdict: { approved, independent: true, confidence, summary, issues: [{ severity: error|warning|info, target: plan|evidence|validation, message }] }. Approval requires every breaking change draft's affected symbol to be addressed by the plan.",
  ].join("\n");
}

function importField(value: string): string {
  return sanitizeField(value).slice(0, 1000);
}
