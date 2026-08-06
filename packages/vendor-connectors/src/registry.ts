import { auth0Connector } from "./connectors/auth0";
import { genericOpenapiConnector } from "./connectors/generic-openapi";
import { openaiConnector } from "./connectors/openai";
import { stripeConnector } from "./connectors/stripe";
import { twilioConnector } from "./connectors/twilio";
import type { VendorConnector } from "./types";

/** Registered connectors, keyed by vendor slug. */
export const connectors: readonly VendorConnector[] = [
  openaiConnector,
  stripeConnector,
  auth0Connector,
  twilioConnector,
  genericOpenapiConnector,
];

export function getConnector(slug: string): VendorConnector | null {
  return connectors.find((connector) => connector.slug === slug) ?? null;
}
