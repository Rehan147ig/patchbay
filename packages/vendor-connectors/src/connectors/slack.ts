import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Slack connector.
 *
 * Slack Web API changes:
 * - Methods are removed as the API evolves
 *   (e.g. `chat.postMessage` stays, but `files.upload` changed to
 *   `filesUploadV2` in the SDK).
 * - Token scopes are enforced: missing scopes now return
 *   `missing_scope` errors instead of silently working.
 * - Message payload fields changed (`attachments` -> `blocks` preferred;
 *   `unfurl_links` behavior).
 */
export const slackConnector = defineConnector({
  slug: "slack",
  identifiers: ["slack", "@slack/web-api", "slack-web"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "files.upload",
      newValue: "filesUploadV2",
      description:
        "Slack SDK renamed files.upload to filesUploadV2 (new multipart shape); the legacy method was removed.",
      affectedSymbols: ["files.upload", "client.files"],
      breaking: true,
      evidence: { sdk: "slack", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "OTHER",
      oldValue: "attachments",
      newValue: "blocks",
      description:
        "Slack prefers blocks over attachments; attachments are deprecated for new apps.",
      affectedSymbols: ["chat.postMessage", "chat.update"],
      breaking: false,
      evidence: { sdk: "slack" },
    },
    {
      changeType: "AUTH_CHANGE",
      oldValue: "missing scopes",
      description:
        "Slack enforces token scopes; calls without the required scope return missing_scope errors.",
      affectedSymbols: ["@slack/web-api", "WebClient"],
      breaking: true,
      evidence: { sdk: "slack", riskTag: RiskTag.AUTH },
    },
  ],
  patchSuggestions: {
    "files.upload": {
      replacement: "filesUploadV2",
      description:
        "Replace files.upload with filesUploadV2 (new SDK shape: channel_id, filename, file).",
      confidence: 88,
    },
  },
});
