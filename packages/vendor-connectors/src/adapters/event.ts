import type { ReleaseSource } from "@patchbay/domain";
import type { WatchtowerAdapter, AdapterCursor, WatchtowerEvidence } from "../watchtower";

/**
 * EVENT plane skeleton: Kafka / MQTT / AMQP / NATS / Pub/Sub.
 * Each topic namespace is an eventual Watchtower source (like npm/OpenAPI).
 * Today these are pluggable stubs — fetch returns empty until a broker URL
 * and credentials are configured. Shape matches npm/openapi adapters so
 * adding a real broker is a fetch() implementation swap, not a contract change.
 */

function stubAdapter(slug: string, source: ReleaseSource): WatchtowerAdapter {
  return {
    slug,
    source,
    supports: () => false,
    normalize: () => {
      throw new Error(`${slug} normalize not implemented — stub`);
    },
    async fetch(
      _cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      return { evidence: [], cursor: {} };
    },
  };
}

export function createKafkaAdapter(topic?: string): WatchtowerAdapter {
  return stubAdapter(`event:kafka:${topic ?? "default"}`, "CHANGELOG" as ReleaseSource);
}
export function createMqttAdapter(topic?: string): WatchtowerAdapter {
  return stubAdapter(`event:mqtt:${topic ?? "default"}`, "CHANGELOG" as ReleaseSource);
}
export function createAmqpAdapter(queue?: string): WatchtowerAdapter {
  return stubAdapter(`event:amqp:${queue ?? "default"}`, "CHANGELOG" as ReleaseSource);
}
export function createNatsAdapter(subject?: string): WatchtowerAdapter {
  return stubAdapter(`event:nats:${subject ?? "default"}`, "CHANGELOG" as ReleaseSource);
}
export function createPubSubAdapter(topic?: string): WatchtowerAdapter {
  return stubAdapter(`event:pubsub:${topic ?? "default"}`, "CHANGELOG" as ReleaseSource);
}

export function createAllEventAdapters(): WatchtowerAdapter[] {
  // No default broker — callers pass explicit topic URLs when enabled.
  return [];
}
