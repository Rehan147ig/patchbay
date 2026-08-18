/**
 * @patchbay/operations — outcome learning and enterprise operations (WP10).
 * Deterministic DB rollups shared by web route handlers, dashboard pages,
 * and worker jobs. No AI, no network.
 */
export {
  enforceCapabilityHealth,
  evaluateCapabilityHealth,
  setCapabilityGate,
  FALSE_POSITIVE_CLASSIFICATIONS,
} from "./capability-health";
export type {
  CapabilityHealthInput,
  CapabilityHealthVerdict,
  CapabilityGateResult,
  CapabilityGateWrite,
  PrismaLike,
} from "./capability-health";
export { computeOrganizationMetrics } from "./metrics";
export type { ComputeMetricsInput, OrganizationMetrics, MetricsPrisma } from "./metrics";
export { purgeExpiredAgentRuns } from "./retention";
export type { PurgeInput, PurgeResult, RetentionPrisma } from "./retention";
