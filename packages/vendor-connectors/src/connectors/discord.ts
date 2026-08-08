import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Discord connector.
 *
 * Discord is one of the most unstable public APIs:
 * - Gateway intents: `MESSAGE_CONTENT_INTENT`, `GUILD_MEMBERS_INTENT` etc.
 *   became privileged; missing them drops events silently.
 * - Message fields moved/changed (components, embeds, attachments).
 * - `discord.js` major versions rename client methods and structures
 *   (Message.attachments, Interaction types).
 */
export const discordConnector = defineConnector({
  slug: "discord",
  identifiers: ["discord", "discord.js", "@discordjs/*"],
  rules: [
    {
      changeType: "OTHER",
      oldValue: "gateway intents",
      description:
        "Gateway intents became privileged (MESSAGE_CONTENT, GUILD_MEMBERS); missing intents drop events silently.",
      affectedSymbols: ["Client", "Intents", "GatewayIntentBits"],
      breaking: true,
      evidence: { sdk: "discord", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "message.attachments",
      description:
        "Message structure changed across discord.js majors (attachments collection, embeds, components).",
      affectedSymbols: ["message", "Message"],
      breaking: true,
      evidence: { sdk: "discord" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "discord.js client methods",
      description: "discord.js majors renamed client/message methods and structures.",
      affectedSymbols: ["client.login", "message.reply", "interaction"],
      breaking: true,
      evidence: { sdk: "discord" },
    },
  ],
  patchSuggestions: {
    Client: {
      replacement: "Client (with intents)",
      description:
        "Declare the required GatewayIntentBits (MessageContent, GuildMembers) when constructing the client.",
      confidence: 82,
    },
  },
});
