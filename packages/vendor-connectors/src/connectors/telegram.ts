import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Telegram Bot API connector.
 *
 * Telegram Bot API versioning:
 * - `parse_mode` handling changed (HTML/MarkdownV2), and unknown parse
 *   modes return errors.
 * - Webhook updates changed (message, edited_message, callback_query
 *   shapes; `is_bot` field added on user).
 * - The Bot API version header / method changes (sendMessage still
 *   stable but reply_markup structure changed).
 */
export const telegramConnector = defineConnector({
  slug: "telegram",
  identifiers: ["telegram", "telegraf", "node-telegram-bot-api", "grammy"],
  rules: [
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "update payload shape",
      description:
        "Telegram update payloads changed across Bot API versions (user.is_bot, message/edited_message shapes).",
      affectedSymbols: ["update", "message", "callback_query"],
      breaking: true,
      evidence: { sdk: "telegram", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "parse_mode",
      description:
        "parse_mode handling tightened; invalid modes now error and Markdown was renamed MarkdownV2.",
      affectedSymbols: ["sendMessage", "editMessageText"],
      breaking: false,
      evidence: { sdk: "telegram" },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "deprecated methods",
      description:
        "Bot API removes deprecated methods across versions (e.g. sendVideoNote changes, answerCallbackQuery).",
      affectedSymbols: ["telegram", "bot"],
      breaking: true,
      evidence: { sdk: "telegram" },
    },
  ],
  patchSuggestions: {
    sendMessage: {
      replacement: "sendMessage",
      description:
        "Update reply_markup/parse_mode usage to current Bot API versions (MarkdownV2, keyboard shapes).",
      confidence: 75,
    },
  },
});
