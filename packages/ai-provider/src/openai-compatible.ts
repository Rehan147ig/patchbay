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

/** Inline fallback so the provider stays functional even if the file is absent. */
const FALLBACK_SYSTEM_PROMPT = `You are Patchbay, an API-change remediation advisor. Given a vendor API change and affected code usages, produce a remediation plan draft. Respond with strict JSON only. The plan is advisory: it must not contain shell commands, and every suggestion must be grounded in the provided change details.`;

export function loadPlanDraftTemplate(): string {
  try {
    return readFileSync(OPENAI_COMPATIBLE_TEMPLATE_PATH(), "utf8");
  } catch {
    return FALLBACK_SYSTEM_PROMPT;
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly systemPrompt: string;

  constructor(config: OpenAiCompatibleConfig) {
    if (!config.apiKey || config.apiKey.length === 0) {
      throw new Error("OpenAiCompatibleProvider requires an apiKey");
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.systemPrompt = loadPlanDraftTemplate();
  }

  async draftRemediationPlan(input: AiPlanDraftInput): Promise<AiPlanDraft> {
    const userPrompt = buildUserPrompt(input);
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
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: userPrompt },
        ],
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

    let content: unknown;
    try {
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      content = body.choices?.[0]?.message?.content;
    } catch {
      throw new Error("AI provider returned a non-JSON response");
    }

    let parsed: unknown;
    if (typeof content === "string") {
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error("AI provider returned invalid JSON in message content");
      }
    } else {
      parsed = content;
    }

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
