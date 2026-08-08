import { adyenConnector } from "./connectors/adyen";
import { algoliaConnector } from "./connectors/algolia";
import { anthropicConnector } from "./connectors/anthropic";
import { auth0Connector } from "./connectors/auth0";
import { awsSdkConnector } from "./connectors/aws-sdk";
import { axiosConnector } from "./connectors/axios";
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
import { passportConnector } from "./connectors/passport";
import { paypalConnector } from "./connectors/paypal";
import { plaidConnector } from "./connectors/plaid";
import { prismaConnector } from "./connectors/prisma";
import { reactConnector } from "./connectors/react";
import { redisConnector } from "./connectors/redis";
import { replicateConnector } from "./connectors/replicate";
import { salesforceConnector } from "./connectors/salesforce";
import { sendgridConnector } from "./connectors/sendgrid";
import { sentryConnector } from "./connectors/sentry";
import { sequelizeConnector } from "./connectors/sequelize";
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
import { vercelConnector } from "./connectors/vercel";
import { vueConnector } from "./connectors/vue";
import type { VendorConnector } from "./types";

/** Registered connectors, keyed by vendor slug. */
export const connectors: readonly VendorConnector[] = [
  // Core (original)
  openaiConnector,
  stripeConnector,
  auth0Connector,
  twilioConnector,
  genericOpenapiConnector,
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
