import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Minimal structured JSON logger. Correlation ids are threaded through AsyncLocalStorage so
 * every log line from a request or job shares the same correlationId.
 */

const context = new AsyncLocalStorage<{ correlationId: string }>();

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return context.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

/** Credential formats that must never reach aggregated logs (kept in sync with packages/audit/src/redact.ts). */
const SECRET_VALUE_PATTERN =
  /(sk-[a-zA-Z0-9_-]{12,}|sk_live_[a-zA-Z0-9]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|npm_[a-zA-Z0-9]{30,}|whsec_[a-zA-Z0-9_]{16,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----|(Basic|Digest)\s+[A-Za-z0-9+/=]{8,}|Bearer\s+[a-zA-Z0-9._-]{10,}|\/\/[^@/\s:]+:[^@/\s]+@)/g;

/** Redacts credential material from strings inside log fields (URL userinfo included). */
function redactLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  }
  if (depth >= 4) return value;
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      out[key] =
        /(secret|token|password|authorization|private[_-]?key|credential|api[_-]?key)/i.test(key)
          ? "[REDACTED]"
          : redactLogValue(field, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    correlationId: getCorrelationId(),
    msg: message,
    ...(fields ? (redactLogValue(fields) as LogFields) : {}),
  });
  if (level === "error" || level === "warn") {
    // Intentional console transport for the JSON logger.
    console.error(line);
  } else {
    // Intentional console transport for the JSON logger.
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => write("debug", message, fields),
  info: (message: string, fields?: LogFields): void => write("info", message, fields),
  warn: (message: string, fields?: LogFields): void => write("warn", message, fields),
  error: (message: string, fields?: LogFields): void => write("error", message, fields),
};
