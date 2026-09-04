/**
 * Provider-facade registry for unified multi-provider SDKs (Vercel AI SDK).
 *
 * Modern codebases rarely import `openai` directly; they import a provider
 * factory from `@ai-sdk/openai` and pass `openai('gpt-4o')` as the `model`
 * to `generateText`/`streamText` from `ai`. Without this registry those calls
 * are invisible to vendor tracking (the `ai` probe found 10,207 facade
 * usages vs 33 raw `openai` usages on vercel/ai itself).
 *
 * Matching is string-based and deterministic: provider package specifier ->
 * canonical vendor slug. A facade binding only engages when its vendorSlug is
 * tracked, so untracked vendors never leak into another vendor's inventory.
 */

export interface FacadeProviderEntry {
  vendorSlug: string;
  /** Factory/callable names exported by the provider package. */
  factories: string[];
}

export const AI_FACADE_PROVIDERS: Record<string, FacadeProviderEntry> = {
  "@ai-sdk/openai": { vendorSlug: "openai", factories: ["openai", "createOpenAI"] },
  "@ai-sdk/anthropic": { vendorSlug: "anthropic", factories: ["anthropic", "createAnthropic"] },
  "@ai-sdk/google": { vendorSlug: "google", factories: ["google", "createGoogleGenerativeAI"] },
  "@ai-sdk/azure": {
    vendorSlug: "azure-openai",
    factories: ["azure", "createAzure"],
  },
  "@ai-sdk/mistral": { vendorSlug: "mistral", factories: ["mistral", "createMistral"] },
};

/** `ai` entry-point calls that accept a `{ model }` produced by a provider. */
export const FACADE_MODEL_CALLS: readonly string[] = [
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
  "embed",
  "embedMany",
];

/** Normalizes `@ai-sdk/openai/sub` -> `@ai-sdk/openai` (scope + name). */
export function normalizeFacadeSpecifier(specifier: string): string | null {
  if (specifier.startsWith("@")) {
    const segments = specifier.split("/");
    if (segments.length < 2 || !segments[0] || !segments[1]) return null;
    return `${segments[0]}/${segments[1]}`;
  }
  return null;
}

/** Provider registry entry for an import specifier, or null when not a facade. */
export function facadeProviderOf(
  specifier: string,
): { providerPackage: string; entry: FacadeProviderEntry } | null {
  const normalized = normalizeFacadeSpecifier(specifier);
  if (!normalized) return null;
  const entry = AI_FACADE_PROVIDERS[normalized];
  return entry ? { providerPackage: normalized, entry } : null;
}
