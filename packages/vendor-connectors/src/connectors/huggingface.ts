import { defineConnector } from "../sdk";

/**
 * HuggingFace connector.
 *
 * HuggingFace Inference API / SDK changes:
 * - `@huggingface/inference` split into `@huggingface/inference` +
 *   `@huggingface/inference-*` per-task packages.
 * - `HfInference` constructor moved to `new HfInference(accessToken)`
 *   (was `token`), and endpoint functions were renamed
 *   (`textGeneration` -> `textGeneration` params changed, `chatCompletion`
 *   added).
 * - Datasets/Spaces API (`huggingface_hub` python) is out of scope here,
 *   but the JS `@huggingface/hub` renames happen frequently.
 */
export const huggingfaceConnector = defineConnector({
  slug: "huggingface",
  identifiers: ["huggingface", "@huggingface/inference", "@huggingface/hub"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "new HfInference(token)",
      newValue: "new HfInference(accessToken)",
      description:
        "HfInference constructor parameter was renamed from token to accessToken across SDK majors.",
      affectedSymbols: ["HfInference"],
      breaking: true,
      evidence: { sdk: "huggingface" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "textGeneration",
      description:
        "Inference task methods were reorganized; textGeneration params and chatCompletion shapes changed.",
      affectedSymbols: ["textGeneration", "chatCompletion", "featureExtraction"],
      breaking: false,
      evidence: { sdk: "huggingface" },
    },
  ],
  patchSuggestions: {
    HfInference: {
      replacement: "new HfInference(accessToken)",
      description:
        "Rename the constructor argument from token to accessToken (or pass via HF_TOKEN env).",
      confidence: 85,
    },
    textGeneration: {
      replacement: "textGeneration",
      description:
        "Update textGeneration/chatCompletion calls to current params (messages vs inputs).",
      confidence: 75,
    },
  },
});
