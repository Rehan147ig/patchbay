import { describe, expect, it } from "vitest";
import { adyenConnector } from "./adyen";
import { algoliaConnector } from "./algolia";
import { anthropicConnector } from "./anthropic";
import { azureSdkConnector } from "./azure-sdk";
import { clerkConnector } from "./clerk";
import { cloudflareConnector } from "./cloudflare";
import { cohereConnector } from "./cohere";
import { deepseekConnector } from "./deepseek";
import { digitaloceanConnector } from "./digitalocean";
import { discordConnector } from "./discord";
import { drizzleConnector } from "./drizzle";
import { elasticsearchConnector } from "./elasticsearch";
import { geminiConnector } from "./gemini";
import { googleCloudConnector } from "./google-cloud";
import { groqConnector } from "./groq";
import { hubspotConnector } from "./hubspot";
import { huggingfaceConnector } from "./huggingface";
import { keycloakConnector } from "./keycloak";
import { kubernetesConnector } from "./kubernetes";
import { langchainConnector } from "./langchain";
import { lemonSqueezyConnector } from "./lemon-squeezy";
import { mistralConnector } from "./mistral";
import { mongodbConnector } from "./mongodb";
import { nextAuthConnector } from "./next-auth";
import { oktaConnector } from "./okta";
import { paypalConnector } from "./paypal";
import { plaidConnector } from "./plaid";
import { prismaConnector } from "./prisma";
import { redisConnector } from "./redis";
import { replicateConnector } from "./replicate";
import { salesforceConnector } from "./salesforce";
import { sendgridConnector } from "./sendgrid";
import { sentryConnector } from "./sentry";
import { sequelizeConnector } from "./sequelize";
import { slackConnector } from "./slack";
import { socketIoConnector } from "./socket-io";
import { squareConnector } from "./square";
import { telegramConnector } from "./telegram";
import { terraformConnector } from "./terraform";
import { trpcConnector } from "./trpc";
import { typeormConnector } from "./typeorm";
import { vercelConnector } from "./vercel";
import { vueConnector } from "./vue";
import { getConnector, listConnectorSlugs } from "../registry";

describe("connector catalog", () => {
  it("registers 50+ connectors", () => {
    const slugs = listConnectorSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(50);
    // spot-check the new ones
    for (const slug of [
      "anthropic",
      "aws-sdk",
      "azure-sdk",
      "vercel",
      "cloudflare",
      "terraform",
      "kubernetes",
      "paypal",
      "square",
      "plaid",
      "adyen",
      "lemon-squeezy",
      "clerk",
      "okta",
      "keycloak",
      "next-auth",
      "slack",
      "sendgrid",
      "discord",
      "telegram",
      "socket.io",
      "prisma",
      "drizzle",
      "typeorm",
      "sequelize",
      "mongodb",
      "redis",
      "vue",
      "trpc",
      "elasticsearch",
      "algolia",
      "sentry",
      "salesforce",
      "hubspot",
    ]) {
      expect(getConnector(slug), slug).toBeDefined();
    }
  });

  it("each connector supports its own identifier", () => {
    const specs: Array<[VendorConnectorLike, unknown]> = [
      [anthropicConnector, { sdk: "anthropic" }],
      [geminiConnector, { sdk: "@google/generative-ai" }],
      [mistralConnector, { sdk: "@mistralai/mistralai" }],
      [deepseekConnector, { sdk: "deepseek" }],
      [cohereConnector, { sdk: "cohere-ai" }],
      [groqConnector, { sdk: "groq-sdk" }],
      [replicateConnector, { sdk: "@replicate/replicate" }],
      [langchainConnector, { sdk: "langchain" }],
      [huggingfaceConnector, { sdk: "@huggingface/inference" }],
      [googleCloudConnector, { sdk: "@google-cloud/storage" }],
      [azureSdkConnector, { sdk: "@azure/identity" }],
      [vercelConnector, { sdk: "vercel" }],
      [cloudflareConnector, { sdk: "wrangler" }],
      [terraformConnector, { sdk: "terraform" }],
      [kubernetesConnector, { sdk: "@kubernetes/client-node" }],
      [digitaloceanConnector, { sdk: "digitalocean" }],
      [paypalConnector, { sdk: "@paypal/checkout-server-sdk" }],
      [squareConnector, { sdk: "square" }],
      [plaidConnector, { sdk: "plaid" }],
      [adyenConnector, { sdk: "adyen" }],
      [lemonSqueezyConnector, { sdk: "lemon-squeezy" }],
      [clerkConnector, { sdk: "@clerk/nextjs" }],
      [oktaConnector, { sdk: "@okta/okta-auth-js" }],
      [keycloakConnector, { sdk: "keycloak-js" }],
      [nextAuthConnector, { sdk: "next-auth" }],
      [slackConnector, { sdk: "@slack/web-api" }],
      [sendgridConnector, { sdk: "@sendgrid/mail" }],
      [discordConnector, { sdk: "discord.js" }],
      [telegramConnector, { sdk: "telegraf" }],
      [socketIoConnector, { sdk: "socket.io" }],
      [prismaConnector, { sdk: "@prisma/client" }],
      [drizzleConnector, { sdk: "drizzle-orm" }],
      [typeormConnector, { sdk: "typeorm" }],
      [sequelizeConnector, { sdk: "sequelize" }],
      [mongodbConnector, { sdk: "mongodb" }],
      [redisConnector, { sdk: "ioredis" }],
      [vueConnector, { sdk: "vue" }],
      [trpcConnector, { sdk: "@trpc/server" }],
      [elasticsearchConnector, { sdk: "@elastic/elasticsearch" }],
      [algoliaConnector, { sdk: "algoliasearch" }],
      [sentryConnector, { sdk: "@sentry/nextjs" }],
      [salesforceConnector, { sdk: "jsforce" }],
      [hubspotConnector, { sdk: "@hubspot/api-client" }],
    ];
    for (const [connector, payload] of specs) {
      expect(connector.supports(payload), connector.slug).toBe(true);
      const normalizations = connector.normalizeChange({
        rawPayload: payload,
        sourceType: "SDK_RELEASE",
      });
      expect(normalizations.length, connector.slug).toBeGreaterThan(0);
    }
  });

  it("patch suggestions resolve to known symbols per group", () => {
    const checks: Array<[VendorConnectorLike, string, string]> = [
      [anthropicConnector, "anthropic.completions.create", "anthropic.messages.create"],
      [mistralConnector, "client.chat.completions.create", "client.chat.complete"],
      [typeormConnector, "createConnection", "AppDataSource.initialize()"],
      [nextAuthConnector, "getServerSession", "auth()"],
      [algoliaConnector, "index.addObject", "index.saveObjects"],
      [slackConnector, "files.upload", "filesUploadV2"],
      [sendgridConnector, "sendgrid.send", "sgMail.send"],
      [mongodbConnector, "MongoClient", "MongoClient"],
    ];
    for (const [connector, symbol, replacement] of checks) {
      const payload = { sdk: connector.slug };
      const normalizations = connector.normalizeChange({
        rawPayload: payload,
        sourceType: "SDK_RELEASE",
      });
      const patches = connector.buildPatchSuggestions(normalizations);
      const match = patches.find((p) => p.symbol === symbol);
      expect(match, `${connector.slug}:${symbol}`).toBeDefined();
      expect(match?.replacement, `${connector.slug}:${symbol}`).toBe(replacement);
    }
  });
});

type VendorConnectorLike = {
  slug: string;
  supports(raw: unknown): boolean;
  normalizeChange(input: { rawPayload: unknown; sourceType: string }): unknown[];
  buildPatchSuggestions(normalizations: unknown[]): Array<{ symbol: string; replacement: string }>;
};
