import { createHash } from "node:crypto";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  WatchtowerAdapter,
  AdapterCursor,
  WatchtowerEvidence,
  NormalizedRelease,
} from "../watchtower";
import { fetchWithTrust } from "../safe-fetch";
import { EVENT_TRUST_PROFILE } from "../trust";

/**
 * EVENT plane: Kafka / MQTT / AMQP / NATS / Pub/Sub.
 * Each topic is a Watchtower source. Adapters are HTTP over the broker's
 * REST proxy (conditional ETag) so the poll is cheap and trust-profile
 * governed. Without a broker URL they return empty (no evidence) — configure
 * KAFKA_REST_URL / MQTT_BROKER_URL etc. to activate.
 */

interface EventCursor extends AdapterCursor {
  etag: string | null;
  lastContentHash: string | null;
}

function normalizeCursor(cursor?: AdapterCursor): EventCursor {
  const c = (cursor ?? {}) as Partial<EventCursor>;
  return {
    etag: typeof c.etag === "string" ? c.etag : null,
    lastContentHash: typeof c.lastContentHash === "string" ? c.lastContentHash : null,
  };
}

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

function createEventHttpAdapter(
  slug: string,
  brokerUrl: string | undefined,
  vendorSlug: string,
  packageName: string,
): WatchtowerAdapter {
  const effectiveUrl = brokerUrl?.trim() ?? "";
  return {
    slug,
    source: "CHANGELOG" as ReleaseSource,
    supports(input: unknown): boolean {
      if (typeof input !== "object" || input === null) return false;
      const obj = input as Record<string, unknown>;
      return obj.vendorSlug === vendorSlug;
    },
    normalize(input: unknown): NormalizedRelease {
      const obj = input as Record<string, unknown>;
      return {
        vendorSlug,
        packageName,
        version: String(obj.version ?? "0.0.0"),
        source: "CHANGELOG" as ReleaseSource,
        canonicalUrl: effectiveUrl,
        contentHash: String(obj.contentHash ?? ""),
        publishedAt: obj.publishedAt ? new Date(obj.publishedAt as string) : new Date(),
      };
    },
    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = normalizeCursor(cursor);
      if (!effectiveUrl) return { evidence: [], cursor: prev };
      const headers: Record<string, string> = { Accept: "application/json" };
      if (prev.etag) headers["If-None-Match"] = prev.etag;
      const res = await fetchWithTrust(effectiveUrl, EVENT_TRUST_PROFILE, { headers });
      if (res.status === 304) return { evidence: [], cursor: prev };
      const etag = res.headers.get("etag");
      const body = res.text;
      const contentHash = createHash("sha256").update(body).digest("hex");
      if (contentHash === prev.lastContentHash && prev.lastContentHash !== null) {
        return { evidence: [], cursor: { etag, lastContentHash: contentHash } };
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        parsed = { raw: body.slice(0, 1000) };
      }
      const version = String(parsed.version ?? parsed.tag ?? contentHash.slice(0, 8));
      const evidence: WatchtowerEvidence = {
        externalId: `${slug}@${version}@${contentHash.slice(0, 12)}`,
        vendorSlug,
        packageName,
        version,
        source: "CHANGELOG" as ReleaseSource,
        canonicalUrl: effectiveUrl,
        contentHash,
        rawPayload: body,
        publishedAt: parsed.publishedAt ? new Date(String(parsed.publishedAt)) : new Date(),
        metadata: { brokerUrl: effectiveUrl, topic: slug },
      };
      return { evidence: [evidence], cursor: { etag, lastContentHash: contentHash } };
    },
  };
}

export function createKafkaAdapter(topic?: string, brokerUrl?: string): WatchtowerAdapter {
  const url = brokerUrl ?? process.env.KAFKA_REST_URL;
  const slug = `event:kafka:${topic ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createEventHttpAdapter(slug, url, topic ?? "kafka-topic", topic ?? "kafka-topic");
}
export function createMqttAdapter(topic?: string, brokerUrl?: string): WatchtowerAdapter {
  const url = brokerUrl ?? process.env.MQTT_BROKER_URL;
  const slug = `event:mqtt:${topic ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createEventHttpAdapter(slug, url, topic ?? "mqtt-topic", topic ?? "mqtt-topic");
}
export function createAmqpAdapter(queue?: string, brokerUrl?: string): WatchtowerAdapter {
  const url = brokerUrl ?? process.env.AMQP_BROKER_URL;
  const slug = `event:amqp:${queue ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createEventHttpAdapter(slug, url, queue ?? "amqp-queue", queue ?? "amqp-queue");
}
export function createNatsAdapter(subject?: string, brokerUrl?: string): WatchtowerAdapter {
  const url = brokerUrl ?? process.env.NATS_URL;
  const slug = `event:nats:${subject ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createEventHttpAdapter(slug, url, subject ?? "nats-subject", subject ?? "nats-subject");
}
export function createPubSubAdapter(topic?: string, brokerUrl?: string): WatchtowerAdapter {
  const url = brokerUrl ?? process.env.PUBSUB_URL;
  const slug = `event:pubsub:${topic ?? "default"}`;
  if (!url) return stubAdapter(slug, "CHANGELOG" as ReleaseSource);
  return createEventHttpAdapter(slug, url, topic ?? "pubsub-topic", topic ?? "pubsub-topic");
}

export function createAllEventAdapters(): WatchtowerAdapter[] {
  const adapters: WatchtowerAdapter[] = [];
  if (process.env.KAFKA_REST_URL)
    adapters.push(createKafkaAdapter(process.env.KAFKA_TOPIC ?? "orders"));
  if (process.env.MQTT_BROKER_URL)
    adapters.push(createMqttAdapter(process.env.MQTT_TOPIC ?? "sensors"));
  if (process.env.AMQP_BROKER_URL)
    adapters.push(createAmqpAdapter(process.env.AMQP_QUEUE ?? "jobs"));
  if (process.env.NATS_URL) adapters.push(createNatsAdapter(process.env.NATS_SUBJECT ?? "events"));
  if (process.env.PUBSUB_URL)
    adapters.push(createPubSubAdapter(process.env.PUBSUB_TOPIC ?? "notifications"));
  return adapters;
}
