export { unifiedDiff, sha256Hex } from "./diff";
export {
  applyPythonClientBootstrap,
  generatePlan,
  reparseCheck,
  validatePatchSyntax,
} from "./engine";
export {
  runSemanticGate,
  semanticCheck,
  readProjectFile,
} from "./semantic-gate";
export type {
  SemanticError,
  SemanticGateResult,
  SemanticGateInput,
} from "./semantic-gate";
export { scanPatchSafety, scanPatches } from "./patch-safety";
export type { PatchSafetyFinding, PatchSafetyVerdict } from "./patch-safety";
export type { PatchDraft, PlanDraft, PlanInput, PlanUsage } from "./types";
