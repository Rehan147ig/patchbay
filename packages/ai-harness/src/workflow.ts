import { createHash } from "node:crypto";

/**
 * Mastra-contract workflow adapter (roadmap Phase H4).
 *
 * Implements the Mastra workflow shape — typed steps, per-step tool
 * allowlists, explicit transitions, parallel execution of independent
 * branches, failure mapping, manual replay, evaluation gates — without the
 * Mastra dependency. BullMQ/Postgres stay the durable workflow authority;
 * this adapter sequences the judgment inside one job and reports typed
 * failures for BullMQ's retry/backoff. A real @mastra/core flow can replace
 * this behind the same step contract later.
 *
 * Deterministic by construction: no timestamps or randomness affect results,
 * and replay verifies each carried step's input digest before re-executing
 * from a failure boundary.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type WorkflowStepStatus = "COMPLETED" | "FAILED" | "SKIPPED";

export interface ToolCallRecord {
  toolName: string;
  inputDigest: string;
  outputDigest: string;
}

export type WorkflowFailureKind =
  "BUDGET_EXCEEDED" | "SCHEMA_VIOLATION" | "TOOL_FAILURE" | "ABORTED" | "UNKNOWN";

export interface WorkflowFailure {
  stepId: string;
  kind: WorkflowFailureKind;
  message: string;
}

export type FailureClassifier = (error: unknown, stepId: string) => WorkflowFailure;

export interface StepRecord {
  stepId: string;
  status: WorkflowStepStatus;
  startedAt: number;
  completedAt: number | null;
  latencyMs: number | null;
  inputDigest: string | null;
  outputJson: JsonValue | null;
  toolCalls: ToolCallRecord[];
  failure: WorkflowFailure | null;
  transitionedTo: string | null;
}

export interface StepContext {
  input: JsonObject;
  state: JsonObject;
  stepId: string;
  signal?: AbortSignal;
  callTool: (toolName: string, payload: JsonValue) => Promise<JsonValue>;
}

export interface WorkflowStep {
  stepId: string;
  description: string;
  toolAllowlist: readonly string[];
  dependsOn?: readonly string[];
  transitions?: {
    success?: string | "end";
    failure?: string | "end";
  };
  run: (ctx: StepContext) => Promise<JsonValue>;
}

export interface GateCheckInput {
  input: JsonObject;
  state: JsonObject;
  steps: StepRecord[];
}

export interface WorkflowGate {
  gateId: string;
  description: string;
  check: (ctx: GateCheckInput) => { passed: boolean; detail: string };
}

export interface GateResult {
  gateId: string;
  description: string;
  passed: boolean;
  detail: string;
}

export interface WorkflowDefinition {
  workflowId: string;
  description: string;
  steps: WorkflowStep[];
  gates?: WorkflowGate[];
  classifier?: FailureClassifier;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: "SUCCEEDED" | "FAILED";
  steps: StepRecord[];
  gates: GateResult[];
  output: JsonObject | null;
  failure: WorkflowFailure | null;
  replayedFromStepId: string | null;
}

export interface WorkflowRunOptions {
  signal?: AbortSignal;
  tools?: Record<string, (payload: JsonValue) => Promise<JsonValue>>;
}

export interface ReplayPlan {
  fromStepId: string;
  hydratedStepIds: string[];
  resumeStepIds: string[];
}

export class WorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

export class WorkflowAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowAbortedError";
  }
}

export class WorkflowToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowToolError";
  }
}

/** sha256 of the canonical JSON of a value: replay identity for tools and steps. */
export function digestJson(value: JsonValue): string {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Maps step errors to typed workflow failures. Matches the harness's named
 * errors by name so this module stays dependency-free; unknown errors map to
 * UNKNOWN and are never covertly retried by callers.
 */
export function defaultFailureClassifier(error: unknown, stepId: string): WorkflowFailure {
  if (error instanceof WorkflowAbortedError) {
    return { stepId, kind: "ABORTED", message: error.message };
  }
  if (error instanceof WorkflowToolError || isNamedError(error, "WorkflowToolError")) {
    return { stepId, kind: "TOOL_FAILURE", message: messageOf(error) };
  }
  if (isNamedError(error, "BudgetExceededError")) {
    return { stepId, kind: "BUDGET_EXCEEDED", message: messageOf(error) };
  }
  if (isNamedError(error, "PlanSchemaError")) {
    return { stepId, kind: "SCHEMA_VIOLATION", message: messageOf(error) };
  }
  return { stepId, kind: "UNKNOWN", message: messageOf(error) };
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertValidDefinition(def: WorkflowDefinition): void {
  const ids = def.steps.map((step) => step.stepId);
  if (new Set(ids).size !== ids.length) {
    throw new WorkflowDefinitionError(`workflow '${def.workflowId}' has duplicate step ids`);
  }
  const position = new Map(ids.map((id, index) => [id, index]));
  const targets = new Set<string>([...ids, "end"]);
  for (const step of def.steps) {
    for (const dep of step.dependsOn ?? []) {
      const depPos = position.get(dep);
      if (depPos === undefined) {
        throw new WorkflowDefinitionError(`step '${step.stepId}' depends on unknown step '${dep}'`);
      }
      if (depPos >= position.get(step.stepId)!) {
        throw new WorkflowDefinitionError(
          `step '${step.stepId}' depends on non-antecedent step '${dep}'`,
        );
      }
    }
    for (const target of [step.transitions?.success, step.transitions?.failure]) {
      if (typeof target === "string" && !targets.has(target)) {
        throw new WorkflowDefinitionError(
          `step '${step.stepId}' transitions to unknown step '${target}'`,
        );
      }
    }
  }
  const gateIds = (def.gates ?? []).map((gate) => gate.gateId);
  if (new Set(gateIds).size !== gateIds.length) {
    throw new WorkflowDefinitionError(`workflow '${def.workflowId}' has duplicate gate ids`);
  }
}

/** Which steps a replay re-executes and which it carries from prior records. */
export function planReplay(priorSteps: StepRecord[], fromStepId: string): ReplayPlan {
  const byId = new Map(priorSteps.map((record) => [record.stepId, record]));
  const from = byId.get(fromStepId);
  if (!from) {
    throw new WorkflowDefinitionError(`cannot replay from unknown step '${fromStepId}'`);
  }
  if (from.status === "COMPLETED") {
    throw new WorkflowDefinitionError(`cannot replay from already completed step '${fromStepId}'`);
  }
  const completedIds = priorSteps
    .filter((record) => record.status === "COMPLETED")
    .map((record) => record.stepId);
  const resumeStepIds = priorSteps
    .filter((record) => record.status !== "COMPLETED")
    .map((record) => record.stepId);
  return { fromStepId, hydratedStepIds: completedIds, resumeStepIds };
}

export interface WorkflowHandle {
  run: (input: JsonObject, options?: WorkflowRunOptions) => Promise<WorkflowRunResult>;
  /**
   * Manual replay: carries every COMPLETED record forward (verified by input
   * digest), re-executes from the first non-completed step with the same
   * definition and input.
   */
  replay: (
    priorSteps: StepRecord[],
    fromStepId: string,
    input: JsonObject,
    options?: WorkflowRunOptions,
  ) => Promise<WorkflowRunResult>;
}

export function defineWorkflow(def: WorkflowDefinition): WorkflowHandle {
  assertValidDefinition(def);
  const classifier = def.classifier ?? defaultFailureClassifier;

  return {
    run: (input, options) => execute(def, classifier, input, null, [], options ?? {}),
    replay: (priorSteps, fromStepId, input, options) =>
      execute(def, classifier, input, fromStepId, priorSteps, options ?? {}),
  };
}

async function execute(
  def: WorkflowDefinition,
  classifier: FailureClassifier,
  input: JsonObject,
  fromStepId: string | null,
  priorSteps: StepRecord[],
  options: WorkflowRunOptions,
): Promise<WorkflowRunResult> {
  const hydrated = fromStepId === null ? [] : hydrateFor(def, priorSteps, fromStepId, input);

  const steps: StepRecord[] = [...hydrated];
  const state: JsonObject = {};
  for (const record of hydrated) {
    if (record.status === "COMPLETED" && record.outputJson !== null) {
      state[record.stepId] = record.outputJson;
    }
  }

  const completed = new Set(hydrated.map((record) => record.stepId));
  const pending = new Set(def.steps.map((step) => step.stepId).filter((id) => !completed.has(id)));
  const position = new Map(def.steps.map((step, index) => [step.stepId, index]));

  let failure: WorkflowFailure | null = null;

  if (options.signal?.aborted) {
    skipSteps(def, pending, steps, position, () => true);
    failure = { stepId: "workflow", kind: "ABORTED", message: "workflow aborted before execution" };
  }

  while (pending.size > 0 && failure === null) {
    const wave = def.steps
      .filter((step) => pending.has(step.stepId))
      .filter((step) => (step.dependsOn ?? []).every((dep) => completed.has(dep)))
      .map((step) => step.stepId);
    if (wave.length === 0) {
      throw new WorkflowDefinitionError(
        `workflow '${def.workflowId}' steps are not satisfiable: ${[...pending].join(", ")} pending`,
      );
    }

    const waveResults = await Promise.all(
      wave.map((stepId) =>
        runStep(def, classifier, stepId, input, state, options).then((record) => ({
          stepId,
          record,
        })),
      ),
    );

    for (const { stepId, record } of waveResults) {
      steps.push(record);
      pending.delete(stepId);
      if (record.status === "COMPLETED" && record.outputJson !== null) {
        completed.add(stepId);
        state[stepId] = record.outputJson;
      }
    }

    const failed = waveResults.find(({ record }) => record.status === "FAILED");
    if (failed) {
      failure = failed.record.failure!;
      const target = stepOf(def, failed.stepId).transitions?.failure ?? "end";
      if (target === "end") {
        skipSteps(def, pending, steps, position, () => true);
        break;
      }
      skipTo(def, pending, steps, position, target);
      continue;
    }

    const transitioned = waveResults.find(
      ({ record, stepId }) =>
        record.status === "COMPLETED" &&
        typeof stepOf(def, stepId).transitions?.success === "string",
    );
    if (transitioned) {
      const target = stepOf(def, transitioned.stepId).transitions!.success! as string;
      if (target === "end") {
        skipSteps(def, pending, steps, position, () => true);
        break;
      }
      skipTo(def, pending, steps, position, target);
      continue;
    }
  }

  const gates = (def.gates ?? []).map((gate) => {
    const result = gate.check({ input, state, steps });
    return { gateId: gate.gateId, description: gate.description, ...result };
  });

  const output: JsonObject = {};
  for (const step of def.steps) {
    const record = steps.find((candidate) => candidate.stepId === step.stepId);
    if (record?.status === "COMPLETED" && record.outputJson !== null) {
      output[step.stepId] = record.outputJson;
    }
  }

  return {
    workflowId: def.workflowId,
    status: failure === null ? "SUCCEEDED" : "FAILED",
    steps,
    gates,
    output: Object.keys(output).length > 0 ? output : null,
    failure,
    replayedFromStepId: fromStepId,
  };
}

function hydrateFor(
  def: WorkflowDefinition,
  priorSteps: StepRecord[],
  fromStepId: string,
  input: JsonObject,
): StepRecord[] {
  const byId = new Map(priorSteps.map((record) => [record.stepId, record]));
  const from = byId.get(fromStepId);
  if (!from) {
    throw new WorkflowDefinitionError(`cannot replay from unknown step '${fromStepId}'`);
  }
  if (from.status === "COMPLETED") {
    throw new WorkflowDefinitionError(`cannot replay from already completed step '${fromStepId}'`);
  }
  const position = new Map(def.steps.map((step, index) => [step.stepId, index]));
  const hydrated: StepRecord[] = [];
  const hydratedState: JsonObject = {};
  for (const step of def.steps) {
    const record = byId.get(step.stepId);
    if (
      record &&
      record.status === "COMPLETED" &&
      position.get(step.stepId)! < position.get(fromStepId)!
    ) {
      if (record.outputJson !== null) {
        hydratedState[step.stepId] = record.outputJson;
      }
      hydrated.push(record);
    }
  }
  for (const record of hydrated) {
    const defStep = stepOf(def, record.stepId);
    const expected = stepInputDigest(input, defStep, hydratedState);
    if (record.inputDigest !== expected) {
      throw new WorkflowDefinitionError(
        `replay input mismatch at hydrated step '${record.stepId}': stored ${record.inputDigest ?? "null"} != recomputed ${expected}`,
      );
    }
  }
  return hydrated;
}

function stepInputDigest(input: JsonObject, step: WorkflowStep, state: JsonObject): string {
  const deps: JsonObject = {};
  for (const dep of step.dependsOn ?? []) {
    const value = state[dep];
    if (value !== undefined) deps[dep] = value;
  }
  return digestJson({ input, deps });
}

/**
 * Marks steps SKIPPED, excluding the transition target. A skipped step's own
 * dependents are skipped transitively, since their input would be stale;
 * SKIPPED/FAILED deps never satisfy a wave.
 */
function skipSteps(
  def: WorkflowDefinition,
  pending: Set<string>,
  steps: StepRecord[],
  position: Map<string, number>,
  shouldSkip: (step: WorkflowStep) => boolean,
  keepStepIds: ReadonlySet<string> = new Set(),
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of def.steps) {
      if (!pending.has(step.stepId) || keepStepIds.has(step.stepId)) continue;
      const dependsOnSkipped = (step.dependsOn ?? []).some(
        (dep) => !steps.some((record) => record.stepId === dep && record.status === "COMPLETED"),
      );
      if (shouldSkip(step) || dependsOnSkipped) {
        pending.delete(step.stepId);
        steps.push(skippedRecord(step.stepId));
        changed = true;
      }
    }
  }
}

function skipTo(
  def: WorkflowDefinition,
  pending: Set<string>,
  steps: StepRecord[],
  position: Map<string, number>,
  target: string,
): void {
  const targetPos = position.get(target);
  if (targetPos === undefined) {
    throw new WorkflowDefinitionError(`transition target '${target}' is not a defined step`);
  }
  skipSteps(
    def,
    pending,
    steps,
    position,
    (step) => position.get(step.stepId)! < targetPos,
    new Set([target]),
  );
}

function skippedRecord(stepId: string): StepRecord {
  return {
    stepId,
    status: "SKIPPED",
    startedAt: 0,
    completedAt: 0,
    latencyMs: null,
    inputDigest: null,
    outputJson: null,
    toolCalls: [],
    failure: null,
    transitionedTo: null,
  };
}

function stepOf(def: WorkflowDefinition, stepId: string): WorkflowStep {
  const step = def.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) throw new WorkflowDefinitionError(`unknown step '${stepId}'`);
  return step;
}

async function runStep(
  def: WorkflowDefinition,
  classifier: FailureClassifier,
  stepId: string,
  input: JsonObject,
  state: JsonObject,
  options: WorkflowRunOptions,
): Promise<StepRecord> {
  const step = stepOf(def, stepId);
  const record: StepRecord = {
    stepId,
    status: "FAILED",
    startedAt: Date.now(),
    completedAt: null,
    latencyMs: null,
    inputDigest: null,
    outputJson: null,
    toolCalls: [],
    failure: null,
    transitionedTo: null,
  };
  try {
    if (options.signal?.aborted) {
      throw new WorkflowAbortedError(`step '${stepId}' aborted before execution`);
    }
    record.inputDigest = stepInputDigest(input, step, state);
    const started = Date.now();
    const toolCalls: ToolCallRecord[] = [];
    const output = await step.run({
      input,
      state,
      stepId,
      signal: options.signal,
      callTool: async (toolName, payload) => {
        if (!step.toolAllowlist.includes(toolName)) {
          throw new WorkflowToolError(
            `step '${stepId}' called tool '${toolName}' outside its allowlist [${step.toolAllowlist.join(", ")}]`,
          );
        }
        const impl = options.tools?.[toolName];
        if (!impl) {
          throw new WorkflowToolError(`no tool implementation registered for '${toolName}'`);
        }
        const result = await impl(payload);
        toolCalls.push({
          toolName,
          inputDigest: digestJson(payload),
          outputDigest: digestJson(result),
        });
        return result;
      },
    });
    record.status = "COMPLETED";
    record.completedAt = Date.now();
    record.latencyMs = record.completedAt - started;
    record.outputJson = output;
    record.toolCalls = toolCalls;
    const transition = step.transitions?.success;
    record.transitionedTo = transition ?? null;
    return record;
  } catch (error) {
    record.status = "FAILED";
    record.completedAt = Date.now();
    record.latencyMs = record.completedAt - record.startedAt;
    record.failure = classifier(error, stepId);
    record.transitionedTo = step.transitions?.failure ?? "end";
    return record;
  }
}
