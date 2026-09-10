import { adyenConnector } from "./connectors/adyen";
import { autonomousGenericConnector } from "./connectors/autonomous-generic";
import { algoliaConnector } from "./connectors/algolia";
import { anthropicConnector } from "./connectors/anthropic";
import { auth0Connector } from "./connectors/auth0";
import { awsSdkConnector } from "./connectors/aws-sdk";
import { axiosConnector } from "./connectors/axios";
import { azureOpenAiConnector } from "./connectors/azure-openai";
import { azureSdkConnector } from "./connectors/azure-sdk";
import { clerkConnector } from "./connectors/clerk";
import { cloudflareConnector } from "./connectors/cloudflare";
import { cohereConnector } from "./connectors/cohere";
import { deepseekConnector } from "./connectors/deepseek";
import { digitaloceanConnector } from "./connectors/digitalocean";
import { discordConnector } from "./connectors/discord";
import { drizzleConnector } from "./connectors/drizzle";
import { elasticsearchConnector } from "./connectors/elasticsearch";
import { expressConnector } from "./connectors/express";
import { firebaseConnector } from "./connectors/firebase";
import { geminiConnector } from "./connectors/gemini";
import { genericOpenapiConnector } from "./connectors/generic-openapi";
import { googleCloudConnector } from "./connectors/google-cloud";
import { groqConnector } from "./connectors/groq";
import { hubspotConnector } from "./connectors/hubspot";
import { huggingfaceConnector } from "./connectors/huggingface";
import { keycloakConnector } from "./connectors/keycloak";
import { kubernetesConnector } from "./connectors/kubernetes";
import { langchainConnector } from "./connectors/langchain";
import { lemonSqueezyConnector } from "./connectors/lemon-squeezy";
import { mistralConnector } from "./connectors/mistral";
import { mongodbConnector } from "./connectors/mongodb";
import { mongooseConnector } from "./connectors/mongoose";
import { nextAuthConnector } from "./connectors/next-auth";
import { nextConnector } from "./connectors/next";
import { oktaConnector } from "./connectors/okta";
import { openaiConnector } from "./connectors/openai";
import { openaiPythonConnector } from "./connectors/openai-python";
import { passportConnector } from "./connectors/passport";
import { paypalConnector } from "./connectors/paypal";
import { plaidConnector } from "./connectors/plaid";
import { prismaConnector } from "./connectors/prisma";
import { postgresqlConnector } from "./connectors/postgresql";
import { reactConnector } from "./connectors/react";
import { redisConnector } from "./connectors/redis";
import { replicateConnector } from "./connectors/replicate";
import { salesforceConnector } from "./connectors/salesforce";
import { sendgridConnector } from "./connectors/sendgrid";
import { sentryConnector } from "./connectors/sentry";
import { sequelizeConnector } from "./connectors/sequelize";
import { shopifyConnector } from "./connectors/shopify";
import { slackConnector } from "./connectors/slack";
import { socketIoConnector } from "./connectors/socket-io";
import { squareConnector } from "./connectors/square";
import { stripeConnector } from "./connectors/stripe";
import { supabaseConnector } from "./connectors/supabase";
import { telegramConnector } from "./connectors/telegram";
import { terraformConnector } from "./connectors/terraform";
import { trpcConnector } from "./connectors/trpc";
import { twilioConnector } from "./connectors/twilio";
import { typeormConnector } from "./connectors/typeorm";
import { vercelAiConnector } from "./connectors/vercel-ai-sdk";
import { vercelConnector } from "./connectors/vercel";
import { vueConnector } from "./connectors/vue";
import type { VendorConnector } from "./types";
import type { RulePack } from "@patchbay/domain";

/** Registered connectors, keyed by vendor slug. */
export const connectors: readonly VendorConnector[] = [
  // Core (original)
  openaiConnector,
  openaiPythonConnector,
  stripeConnector,
  auth0Connector,
  twilioConnector,
  genericOpenapiConnector,
  // Autonomous universal track (no per-vendor rule pack needed)
  autonomousGenericConnector,
  // AI / LLM
  anthropicConnector,
  geminiConnector,
  mistralConnector,
  deepseekConnector,
  cohereConnector,
  groqConnector,
  replicateConnector,
  langchainConnector,
  huggingfaceConnector,
  vercelAiConnector,
  azureOpenAiConnector,
  // HTTP clients & integration SDKs
  axiosConnector,
  firebaseConnector,
  mongooseConnector,
  passportConnector,
  supabaseConnector,
  // Cloud & infra
  awsSdkConnector,
  googleCloudConnector,
  azureSdkConnector,
  vercelConnector,
  cloudflareConnector,
  terraformConnector,
  kubernetesConnector,
  digitaloceanConnector,
  // Payments & fintech
  paypalConnector,
  squareConnector,
  plaidConnector,
  adyenConnector,
  lemonSqueezyConnector,
  shopifyConnector,
  // Auth & identity
  clerkConnector,
  oktaConnector,
  keycloakConnector,
  nextAuthConnector,
  // Messaging & comms
  slackConnector,
  sendgridConnector,
  discordConnector,
  telegramConnector,
  socketIoConnector,
  // Data & DB
  prismaConnector,
  drizzleConnector,
  typeormConnector,
  sequelizeConnector,
  mongodbConnector,
  redisConnector,
  postgresqlConnector,
  // Web frameworks
  expressConnector,
  reactConnector,
  nextConnector,
  vueConnector,
  trpcConnector,
  // Search & observability
  elasticsearchConnector,
  algoliaConnector,
  sentryConnector,
  // CRM & product
  salesforceConnector,
  hubspotConnector,
];

export function getConnector(slug: string): VendorConnector | null {
  return connectors.find((connector) => connector.slug === slug) ?? null;
}

/** All registered connector slugs (for catalog surfaces / vendor seeding). */
export function listConnectorSlugs(): string[] {
  return connectors.map((connector) => connector.slug);
}

/**
 * WP6: returns the connector's declared rule pack, failing loudly when a
 * certified connector has none. Uncertified connectors legitimately omit
 * packs (their work is assess/plan-only); callers gate on certification
 * first (requireCertified) and call this only for DRAFT_PR work.
 */
export function requireRulePack(slug: string): RulePack {
  const connector = getConnector(slug);
  if (!connector) throw new Error(`no connector registered for vendor "${slug}"`);
  if (!connector.rulePack) {
    throw new Error(
      `connector "${slug}" declares no rule pack; cannot run pack-budgeted remediation`,
    );
  }
  return connector.rulePack;
}
