import type { WatchtowerAdapter } from "../watchtower";
import { createAllNpmAdapters } from "../adapters/npm";
import { createAllGitHubReleasesAdapters } from "../adapters/github-releases";
import { createOpenAPIAdapters } from "../adapters/openapi";
import { createAllEventAdapters } from "../adapters/event";
import { createAllDataAdapters } from "../adapters/data";
import { createAllSoapAdapters, createAllWebSocketAdapters } from "../adapters/soap";

let cachedAdapters: WatchtowerAdapter[] | null = null;

/**
 * Primary sources (CHANGE INTELLIGENCE): npm + OpenAPI diff are the
 * deterministic contract planes. GitHub Releases is fallback/secondary.
 * Ordering here defines poll priority; detect-releases iterates in this order.
 * OpenAPI adapter already emits diffOpenApiSpecs Facts (added/removed/changed)
 * so contract breaks are explainable without LLM.
 */
export function getWatchtowerAdapters(): WatchtowerAdapter[] {
  if (cachedAdapters) return cachedAdapters;
  cachedAdapters = [
    ...createAllNpmAdapters(), // primary: npm packument (ETag, conditional, batch 10)
    ...createOpenAPIAdapters(), // primary: OpenAPI spec diff (apiDiff breaking facts)
    ...createAllEventAdapters(), // event plane (Kafka/MQTT/AMQP/NATS/PubSub) — env-gated
    ...createAllDataAdapters(), // data plane (Schema Registry/SQL/Mongo) — env-gated
    ...createAllSoapAdapters(),
    ...createAllWebSocketAdapters(),
    ...createAllGitHubReleasesAdapters(), // secondary fallback
  ];
  return cachedAdapters;
}

export function getWatchtowerAdapter(slug: string): WatchtowerAdapter | undefined {
  return getWatchtowerAdapters().find((a) => a.slug === slug);
}

export function getAdaptersBySource(source: string): WatchtowerAdapter[] {
  return getWatchtowerAdapters().filter((a) => a.source === source);
}

export function resetWatchtowerAdapterCache(): void {
  cachedAdapters = null;
}
