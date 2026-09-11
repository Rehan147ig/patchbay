import type { JobType } from "./index";

/**
 * Priority lanes for the shared remediation queue (BullMQ v5 semantics:
 * priority 0 means no explicit priority and runs first; among prioritized
 * jobs lower numbers win; prioritized jobs pay a small scheduling cost).
 *
 * Fleet rationale: a breaking major fans out into a burst of heavy
 * background work (graph-index, scans, polls). Latency-sensitive pipeline
 * jobs (validate, create-pr, analyze, plan, match) keep the default 0 so the
 * burst cannot head-of-line-block the remediation path. Heavy/deferrable
 * jobs take BACKGROUND_JOB_PRIORITY. An explicit caller-supplied priority
 * always wins over this default.
 */
export const BACKGROUND_JOB_PRIORITY = 10;

// String literals (not JobType.X references) so this side-effect-free module
// never creates a runtime import cycle with ./index, which imports it back.
// The JobType annotation still rejects typos and renames at compile time.
const DEPRIORITIZED_JOBS: ReadonlySet<JobType> = new Set([
  "scan-repository",
  "graph-index",
  "poll-npm-registry",
  "update-task-parameter",
  "evaluate-capability-health",
  "siem-forward",
]);

/** Default BullMQ priority for a job type, or undefined to keep default 0. */
export function priorityForJobType(jobType: JobType): number | undefined {
  return DEPRIORITIZED_JOBS.has(jobType) ? BACKGROUND_JOB_PRIORITY : undefined;
}
