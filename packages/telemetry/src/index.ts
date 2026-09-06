import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Span,
} from "@opentelemetry/api";

/**
 * OpenTelemetry instrumentation (WP10, spec §10).
 *
 * Everything here goes through the OTEL *API* (global tracer/meter): with no
 * SDK registered the calls are safe no-ops, and the moment an operator
 * registers a NodeSDK (OTLP exporter via OTEL_EXPORTER_OTLP_ENDPOINT) the
 * recorded spans and metrics start flowing with zero code changes. That is
 * the entire deployment contract — no Patchbay code reads OTEL env vars.
 *
 * Alongside the OTEL recordings this package keeps a tiny in-process mirror
 * (job counters + last-outcome table) that powers /api/operations/queues
 * without requiring a metrics backend. The mirror is observability of the
 * process, not a substitute for the OTEL pipeline.
 */

const tracer = trace.getTracer("patchbay", "1.0.0");
const meter = metrics.getMeter("patchbay", "1.0.0");

let jobsCompleted: Counter | undefined;
let jobsFailed: Counter | undefined;
let jobDuration: Histogram | undefined;
let httpDuration: Histogram | undefined;

function counters(): {
  completed: Counter;
  failed: Counter;
  duration: Histogram;
  http: Histogram;
} {
  // Lazily created so unit tests (and processes that fork before first use)
  // never pay for instruments they never record — and so a duplicate-meter
  // registration throws once, loudly, instead of per call.
  jobsCompleted ??= meter.createCounter("patchbay.jobs.completed", {
    description: "Background jobs completed by type",
  });
  jobsFailed ??= meter.createCounter("patchbay.jobs.failed", {
    description: "Background jobs failed by type",
  });
  jobDuration ??= meter.createHistogram("patchbay.job.duration", {
    description: "Background job wall-clock duration in milliseconds",
    unit: "ms",
  });
  httpDuration ??= meter.createHistogram("patchbay.http.duration", {
    description: "Instrumented web route duration in milliseconds",
    unit: "ms",
  });
  return {
    completed: jobsCompleted,
    failed: jobsFailed,
    duration: jobDuration,
    http: httpDuration,
  };
}

export type JobOutcome = "completed" | "failed";

/** In-process mirror of job outcomes (queue endpoint reads this, not OTEL). */
const jobMirror = new Map<string, { completed: number; failed: number; lastOutcomeAt: string }>();

function mirrorRecord(jobType: string, outcome: JobOutcome): void {
  const entry = jobMirror.get(jobType) ?? { completed: 0, failed: 0, lastOutcomeAt: "" };
  if (outcome === "completed") entry.completed += 1;
  else entry.failed += 1;
  entry.lastOutcomeAt = new Date().toISOString();
  jobMirror.set(jobType, entry);
}

/** Snapshot of the in-process job mirror (defensive copy). */
export function getJobMirrorSnapshot(): Record<
  string,
  { completed: number; failed: number; lastOutcomeAt: string }
> {
  return Object.fromEntries(jobMirror.entries());
}

/** Test hook: reset the in-process mirror (OTEL instruments are untouched). */
export function resetJobMirror(): void {
  jobMirror.clear();
}

/**
 * Record a terminal job transition: OTEL counter + duration histogram with
 * low-cardinality attributes (job type + outcome only — never org or repo),
 * plus the in-process mirror.
 */
export function recordJobOutcome(jobType: string, outcome: JobOutcome, durationMs: number): void {
  const { completed, failed, duration } = counters();
  const attributes: Attributes = { "job.type": jobType, "job.outcome": outcome };
  if (outcome === "completed") completed.add(1, attributes);
  else failed.add(1, attributes);
  duration.record(Math.max(0, Math.round(durationMs)), { "job.type": jobType });
  mirrorRecord(jobType, outcome);
}

/** Record an instrumented web route duration (route template, never raw ids). */
export function recordHttpDuration(route: string, method: string, durationMs: number): void {
  counters().http.record(Math.max(0, Math.round(durationMs)), {
    "http.route": route,
    "http.method": method,
  });
}

/**
 * Run fn inside an OTEL span. The span records exceptions with ERROR status
 * and always ends; the return value (or throw) passes through untouched.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Wrap a BullMQ processor: one span per job (`job.<type>`) carrying the job
 * id, attempt count, and correlation id, with the terminal outcome + duration
 * recorded to OTEL metrics and the mirror on the way out.
 */
export function instrumentProcessor<
  TJob extends { id?: string; data: unknown; attemptsMade?: number },
  TResult,
>(jobType: string, processor: (job: TJob) => Promise<TResult>): (job: TJob) => Promise<TResult> {
  return async (job) => {
    const data = (job.data ?? {}) as Record<string, unknown>;
    const correlationId = typeof data.correlationId === "string" ? data.correlationId : undefined;
    const started = Date.now();
    return withSpan(
      `job.${jobType}`,
      {
        "job.type": jobType,
        ...(job.id ? { "job.id": job.id } : {}),
        ...(typeof job.attemptsMade === "number" ? { "job.attempts": job.attemptsMade } : {}),
        ...(correlationId ? { "correlation.id": correlationId } : {}),
      },
      async () => {
        try {
          const result = await processor(job);
          recordJobOutcome(jobType, "completed", Date.now() - started);
          return result;
        } catch (error) {
          recordJobOutcome(jobType, "failed", Date.now() - started);
          throw error;
        }
      },
    );
  };
}
