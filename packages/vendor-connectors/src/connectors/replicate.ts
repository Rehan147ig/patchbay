import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Replicate connector.
 *
 * Replicate's API changed across versions:
 * - Predictions: `predictions.create` -> `predictions.create` (stable) but
 *   the webhook payload shape changed (version -> model/version split).
 * - `wait()` / `predict` helper methods changed across SDK majors.
 * - Output types changed from string URLs to arrays/objects depending on
 *   the model.
 */
export const replicateConnector = defineConnector({
  slug: "replicate",
  identifiers: ["replicate", "@replicate/replicate"],
  rules: [
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "prediction.webhook payload",
      description:
        "Webhook payloads changed across versions: the `version` field became `model` + `version`, and status fields were renamed.",
      affectedSymbols: ["replicate.predictions", "predictions.create"],
      breaking: true,
      evidence: { sdk: "replicate", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "prediction.wait()",
      newValue: "predictions.get()",
      description:
        "The convenience wait()/predict helpers were removed or renamed in newer SDK majors; poll predictions.get() explicitly.",
      affectedSymbols: ["prediction.wait", "replicate.predictions.create"],
      breaking: true,
      evidence: { sdk: "replicate" },
    },
  ],
  patchSuggestions: {
    "replicate.predictions.create": {
      replacement: "replicate.predictions.create",
      description:
        "Update webhook handlers to the current payload shape (model/version split) and poll via predictions.get().",
      confidence: 78,
    },
  },
});
