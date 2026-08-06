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

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    correlationId: getCorrelationId(),
    msg: message,
    ...(fields ?? {}),
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
