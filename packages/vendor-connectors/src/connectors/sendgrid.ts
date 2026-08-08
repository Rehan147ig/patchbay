import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * SendGrid connector.
 *
 * SendGrid v3 mail API changes:
 * - `sendgrid.send()` with legacy params was replaced by the
 *   `@sendgrid/mail` `sgMail.send(msg)` with a message object.
 * - Template engine v1 -> v2 (dynamic templates): template_id plus
 *   dynamic_template_data replaced substitutions.
 * - Webhook event payload structure changed (category arrays, event names).
 */
export const sendgridConnector = defineConnector({
  slug: "sendgrid",
  identifiers: ["sendgrid", "@sendgrid/mail", "sendgrid-nodejs"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "template substitutions",
      newValue: "dynamic_template_data",
      description:
        "SendGrid moved to dynamic templates (v2); template substitutions were removed in favor of dynamic_template_data.",
      affectedSymbols: ["sgMail.send", "sendgrid.send"],
      breaking: true,
      evidence: { sdk: "sendgrid", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "sendgrid.send()",
      newValue: "sgMail.send(msg)",
      description:
        "The SDK moved to @sendgrid/mail's sgMail.send with a structured message object.",
      affectedSymbols: ["sendgrid.send", "sgMail.send"],
      breaking: true,
      evidence: { sdk: "sendgrid" },
    },
  ],
  patchSuggestions: {
    "sgMail.send": {
      replacement: "sgMail.send (dynamic templates)",
      description:
        "Move template substitutions to dynamic_template_data and template_id (v2 templates).",
      confidence: 85,
    },
    "sendgrid.send": {
      replacement: "sgMail.send",
      description: "Migrate sendgrid.send to the @sendgrid/mail sgMail.send(message) API.",
      confidence: 88,
    },
  },
});
