/**
 * Worker OTel — mirrors web/lib/otel.ts. Wraps BullMQ job handlers.
 * Usage: await trace(`job:${job.name}`, async (span) => { ... })
 */
type Span = {
  end: () => void;
  setAttribute: (k: string, v: string) => void;
  recordException: (e: unknown) => void;
};
function noopSpan(): Span {
  return { end: () => {}, setAttribute: () => {}, recordException: () => {} };
}
export function trace<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T> | T {
  const enabled = process.env.OTEL_ENABLED === "1";
  const span = noopSpan();
  const start = Date.now();
  try {
    const result = fn(span);
    if (result instanceof Promise) {
      return result
        .then((v) => {
          if (enabled) console.log(`[otel] ${name} ${Date.now() - start}ms`);
          span.end();
          return v;
        })
        .catch((e) => {
          span.recordException(e);
          span.end();
          throw e;
        });
    }
    if (enabled) console.log(`[otel] ${name} ${Date.now() - start}ms`);
    span.end();
    return result;
  } catch (e) {
    span.recordException(e);
    span.end();
    throw e;
  }
}
export const otel = { trace };
