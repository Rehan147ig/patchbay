/**
 * Redis connection and job-size guards for the queue package. Pure helpers —
 * no side effects — so they are unit-testable without a live Redis.
 */

const MAX_REDIS_URL_LENGTH = 500;
export const MAX_JOB_PAYLOAD_BYTES = 256 * 1024;

export interface ParsedRedisUrl {
  scheme: "redis" | "rediss";
  host: string;
  port: number;
  hasPassword: boolean;
}

/**
 * Validates a REDIS_URL at boot so misconfiguration fails fast and loudly.
 * Only redis:// and rediss:// (TLS) are accepted.
 */
export function parseRedisUrl(raw: string): ParsedRedisUrl {
  if (raw.length > MAX_REDIS_URL_LENGTH) {
    throw new Error(`REDIS_URL exceeds ${MAX_REDIS_URL_LENGTH} characters`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`REDIS_URL is not a valid URL (${redactRedisUrl(raw)})`);
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`REDIS_URL must use redis:// or rediss://, got ${url.protocol}//`);
  }
  if (url.hostname === "") {
    throw new Error("REDIS_URL must include a host");
  }
  const port = url.port === "" ? 6379 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`REDIS_URL has an invalid port: ${url.port}`);
  }
  return {
    scheme: url.protocol === "rediss:" ? "rediss" : "redis",
    host: url.hostname,
    port,
    hasPassword: url.password !== "",
  };
}

/** Masks the password so connection strings can be logged safely. */
export function redactRedisUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password !== "") url.password = "[REDACTED]";
    // URL.toString() percent-encodes the brackets; un-encode for readability.
    return url.toString().replaceAll("%5BREDACTED%5D", "[REDACTED]");
  } catch {
    return "[invalid redis url]";
  }
}

/**
 * Rejects job payloads that would exceed the Redis/BullMQ comfort envelope.
 * Fails at enqueue time with a clear error instead of surfacing as an
 * oversized-message Redis failure mid-flight.
 */
export function assertJobPayloadSize(data: unknown): void {
  let size: number;
  try {
    size = JSON.stringify(data)?.length ?? 0;
  } catch {
    throw new Error("Job payload is not JSON-serializable; refusing to enqueue");
  }
  if (size > MAX_JOB_PAYLOAD_BYTES) {
    throw new Error(
      `Job payload of ${size} bytes exceeds the ${MAX_JOB_PAYLOAD_BYTES} byte limit; refusing to enqueue`,
    );
  }
}
