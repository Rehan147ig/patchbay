export { unifiedDiff, sha256Hex } from "./diff";
export { generatePlan } from "./engine";
export { scanPatchSafety, scanPatches } from "./patch-safety";
export type { PatchSafetyFinding, PatchSafetyVerdict } from "./patch-safety";
export type { PatchDraft, PlanDraft, PlanInput, PlanUsage } from "./types";
