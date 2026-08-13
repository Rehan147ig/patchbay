import { describe, expect, it } from "vitest";
import {
  defineWorkflow,
  digestJson,
  planReplay,
  WorkflowDefinitionError,
  WorkflowToolError,
  type JsonObject,
} from "./workflow";

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const WAIT_MS = 10;

describe("workflow adapter: sequencing", () => {
  it("runs steps in definition order with antecedent state visible to dependents", async () => {
    const calls: string[] = [];
    const workflow = defineWorkflow({
      workflowId: "ordered",
      description: "sequential",
      steps: [
        {
          stepId: "a",
          description: "first",
          toolAllowlist: [],
          run: async (ctx) => {
            calls.push("a");
            return { value: Number(ctx.state["n/a"] ?? 0) + 1 };
          },
        },
        {
          stepId: "b",
          description: "second",
          toolAllowlist: [],
          dependsOn: ["a"],
          run: (ctx) => {
            calls.push("b");
            return Promise.resolve({ value: (ctx.state["a"] as { value: number }).value + 1 });
          },
        },
      ],
    });

    const result = await workflow.run({});

    expect(calls).toEqual(["a", "b"]);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.steps.map((step) => step.stepId)).toEqual(["a", "b"]);
    expect(result.steps.every((step) => step.status === "COMPLETED")).toBe(true);
    expect(result.output).toEqual({ a: { value: 1 }, b: { value: 2 } });
    expect(result.failure).toBeNull();
    expect(result.gates).toEqual([]);
  });

  it("executes independent steps in parallel but respects dependsOn waves", async () => {
    let active = 0;
    let maxActive = 0;
    let finished = 0;
    const workflow = defineWorkflow({
      workflowId: "parallel",
      description: "two independent analysts then dependents",
      steps: [
        {
          stepId: "impact",
          description: "graph query",
          toolAllowlist: [],
          run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
            active -= 1;
            return { modules: 2 };
          },
        },
        {
          stepId: "facts",
          description: "release facts",
          toolAllowlist: [],
          run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
            active -= 1;
            return { breaking: true };
          },
        },
        {
          stepId: "planner",
          description: "depends on both",
          toolAllowlist: [],
          dependsOn: ["impact", "facts"],
          run: async (ctx) => ({
            breaking: (ctx.state["facts"] as { breaking: boolean }).breaking,
            modules: (ctx.state["impact"] as { modules: number }).modules,
            step: ++finished,
          }),
        },
      ],
    });

    const started = Date.now();
    const result = await workflow.run({});
    const elapsed = Date.now() - started;

    expect(maxActive).toBe(2);
    expect(finished).toBe(1);
    expect(result.status).toBe("SUCCEEDED");
    expect(elapsed).toBeLessThan(WAIT_MS * 3);
    expect(result.output).toEqual({
      impact: { modules: 2 },
      facts: { breaking: true },
      planner: { breaking: true, modules: 2, step: 1 },
    });
  });
});

describe("workflow adapter: tool allowlists", () => {
  it("enforces per-step allowlists and records tool call digests", async () => {
    const workflow = defineWorkflow({
      workflowId: "tools",
      description: "allowlist enforcement",
      steps: [
        {
          stepId: "analyst",
          description: "only one tool",
          toolAllowlist: ["graph"],
          run: async (ctx) => {
            const modules = await ctx.callTool("graph", { repositoryId: "r1" });
            return { modules };
          },
        },
        {
          stepId: "planner",
          description: "no tools allowed",
          toolAllowlist: [],
          run: async () => ({ plan: true }),
        },
      ],
    });

    const result = await workflow.run(
      {},
      {
        tools: {
          graph: async (payload) => {
            const { repositoryId } = payload as { repositoryId: string };
            return { count: repositoryId === "r1" ? 3 : 0 };
          },
        },
      },
    );

    expect(result.status).toBe("SUCCEEDED");
    const analyst = result.steps[0]!;
    expect(analyst.toolCalls).toHaveLength(1);
    expect(analyst.toolCalls[0]?.toolName).toBe("graph");
    expect(analyst.toolCalls[0]?.inputDigest).toBe(digestJson({ repositoryId: "r1" }));
    expect(analyst.toolCalls[0]?.outputDigest).toBe(digestJson({ count: 3 }));
    expect(result.output).toEqual({ analyst: { modules: { count: 3 } }, planner: { plan: true } });
  });

  it("fails with TOOL_FAILURE when a step calls outside its allowlist", async () => {
    const workflow = defineWorkflow({
      workflowId: "tools-off",
      description: "forbidden tool",
      steps: [
        {
          stepId: "planner",
          description: "calls graph but only allowed review",
          toolAllowlist: ["review"],
          run: (ctx) => ctx.callTool("graph", {}),
        },
        {
          stepId: "reviewer",
          description: "never reached",
          toolAllowlist: [],
          dependsOn: ["planner"],
          run: async () => ({ verdict: true }),
        },
      ],
    });

    const result = await workflow.run({}, { tools: { graph: async () => ({}) } });

    expect(result.status).toBe("FAILED");
    expect(result.failure?.kind).toBe("TOOL_FAILURE");
    expect(result.failure?.stepId).toBe("planner");
    expect(result.failure?.message).toContain("outside its allowlist");
    const steps = new Map(result.steps.map((step) => [step.stepId, step]));
    expect(steps.get("planner")?.status).toBe("FAILED");
    expect(steps.get("reviewer")?.status).toBe("SKIPPED");
    expect(result.output).toBeNull();
  });

  it("fails with TOOL_FAILURE when no implementation is registered", async () => {
    const workflow = defineWorkflow({
      workflowId: "tools-missing",
      description: "missing implementation",
      steps: [
        {
          stepId: "analyst",
          description: "unregistered tool",
          toolAllowlist: ["graph"],
          run: (ctx) => ctx.callTool("graph", {}),
        },
      ],
    });

    const result = await workflow.run({});

    expect(result.failure?.kind).toBe("TOOL_FAILURE");
    expect(result.failure?.message).toContain("no tool implementation");
  });
});

describe("workflow adapter: transitions", () => {
  it("skips remaining steps when a step transitions to end", async () => {
    const workflow = defineWorkflow({
      workflowId: "transitions",
      description: "early exit",
      steps: [
        {
          stepId: "gate",
          description: "stops the run",
          toolAllowlist: [],
          transitions: { success: "end" },
          run: async () => ({ stop: true }),
        },
        {
          stepId: "never",
          description: "skipped",
          toolAllowlist: [],
          dependsOn: ["gate"],
          run: async () => ({ unreachable: true }),
        },
      ],
    });

    const result = await workflow.run({});

    expect(result.status).toBe("SUCCEEDED");
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["gate", "COMPLETED"],
      ["never", "SKIPPED"],
    ]);
    expect(result.steps[0]?.transitionedTo).toBe("end");
    expect(result.output).toEqual({ gate: { stop: true } });
  });

  it("jumps to a named step on success, skipping steps in between", async () => {
    const ran: string[] = [];
    const workflow = defineWorkflow({
      workflowId: "transitions-jump",
      description: "conditional jump",
      steps: [
        {
          stepId: "planner",
          description: "emits low confidence",
          toolAllowlist: [],
          transitions: { success: "reviewFocus" },
          run: async () => {
            ran.push("planner");
            return { confidence: 40 };
          },
        },
        {
          stepId: "deep-analysis",
          description: "skipped for low confidence",
          toolAllowlist: [],
          dependsOn: ["planner"],
          run: async () => {
            ran.push("deep-analysis");
            return {};
          },
        },
        {
          stepId: "reviewFocus",
          description: "target",
          toolAllowlist: [],
          run: async () => {
            ran.push("reviewFocus");
            return {};
          },
        },
      ],
    });

    const result = await workflow.run({});

    expect(ran).toEqual(["planner", "reviewFocus"]);
    expect(result.steps.find((step) => step.stepId === "deep-analysis")?.status).toBe("SKIPPED");
    expect(result.steps.find((step) => step.stepId === "reviewFocus")?.status).toBe("COMPLETED");
  });

  it("routes failure to a recovery step", async () => {
    const ran: string[] = [];
    const workflow = defineWorkflow({
      workflowId: "transitions-failure",
      description: "failure recovery",
      steps: [
        {
          stepId: "planner",
          description: "throws",
          toolAllowlist: [],
          transitions: { failure: "recovery" },
          run: async () => {
            ran.push("planner");
            throw namedError("PlanSchemaError", "bad plan");
          },
        },
        {
          stepId: "recovery",
          description: "fallback",
          toolAllowlist: [],
          run: async () => {
            ran.push("recovery");
            return { fallback: true };
          },
        },
      ],
    });

    const result = await workflow.run({});

    expect(ran).toEqual(["planner", "recovery"]);
    expect(result.steps[0]?.failure?.kind).toBe("SCHEMA_VIOLATION");
    expect(result.steps[0]?.transitionedTo).toBe("recovery");
    expect(result.steps[1]?.status).toBe("COMPLETED");
    expect(result.status).toBe("FAILED");
  });
});

describe("workflow adapter: failure mapping", () => {
  it("maps harness errors by name to typed failures", async () => {
    const cases: Array<[string, (ctx: { stepId: string }) => Promise<JsonObject>, string]> = [
      [
        "BudgetExceededError",
        async () => {
          throw namedError("BudgetExceededError", "over");
        },
        "BUDGET_EXCEEDED",
      ],
      [
        "PlanSchemaError",
        async () => {
          throw namedError("PlanSchemaError", "invalid");
        },
        "SCHEMA_VIOLATION",
      ],
      [
        "WorkflowToolError",
        async () => {
          throw new WorkflowToolError("tool");
        },
        "TOOL_FAILURE",
      ],
    ];
    for (const [label, run, kind] of cases) {
      const workflow = defineWorkflow({
        workflowId: `map-${label}`,
        description: label,
        steps: [{ stepId: "x", description: label, toolAllowlist: [], run }],
      });
      const result = await workflow.run({}, { tools: {} });
      expect(result.status).toBe("FAILED");
      expect(result.failure?.kind).toBe(kind);
    }
  });

  it("maps unknown errors to UNKNOWN and never to a retryable kind", async () => {
    const workflow = defineWorkflow({
      workflowId: "map-unknown",
      description: "unknown error",
      steps: [
        {
          stepId: "x",
          description: "unfamiliar",
          toolAllowlist: [],
          run: async () => {
            throw new Error("something new");
          },
        },
      ],
    });

    const result = await workflow.run({});

    expect(result.failure?.kind).toBe("UNKNOWN");
    expect(result.failure?.message).toBe("something new");
  });

  it("supports a custom failure classifier", async () => {
    const workflow = defineWorkflow({
      workflowId: "map-custom",
      description: "custom classifier",
      classifier: () => ({ stepId: "x", kind: "TOOL_FAILURE" as const, message: "custom" }),
      steps: [
        {
          stepId: "x",
          description: "throws anything",
          toolAllowlist: [],
          run: async () => {
            throw new Error("anything");
          },
        },
      ],
    });

    const result = await workflow.run({});

    expect(result.failure).toEqual({ stepId: "x", kind: "TOOL_FAILURE", message: "custom" });
  });
});

describe("workflow adapter: evaluation gates", () => {
  it("records gates without failing the workflow when they fail", async () => {
    const workflow = defineWorkflow({
      workflowId: "gates",
      description: "gates recorded",
      steps: [
        {
          stepId: "planner",
          description: "plan",
          toolAllowlist: [],
          run: async () => ({ edits: 0 }),
        },
      ],
      gates: [
        {
          gateId: "plan-gate",
          description: "plan must propose edits for breaking changes",
          check: ({ state }) => {
            const edits = (state["planner"] as { edits: number }).edits;
            return {
              passed: edits > 0,
              detail: edits > 0 ? `${edits} edits proposed` : "no edits proposed",
            };
          },
        },
        {
          gateId: "review-gate",
          description: "independent review must approve",
          check: () => ({ passed: false, detail: "no review" }),
        },
      ],
    });

    const result = await workflow.run({});

    expect(result.status).toBe("SUCCEEDED");
    expect(result.gates).toEqual([
      {
        gateId: "plan-gate",
        description: "plan must propose edits for breaking changes",
        passed: false,
        detail: "no edits proposed",
      },
      {
        gateId: "review-gate",
        description: "independent review must approve",
        passed: false,
        detail: "no review",
      },
    ]);
  });
});

describe("workflow adapter: abort signal", () => {
  it("stops remaining steps when aborted and reports ABORTED", async () => {
    const workflow = defineWorkflow({
      workflowId: "abort",
      description: "abortable",
      steps: [
        {
          stepId: "first",
          description: "completes",
          toolAllowlist: [],
          run: async () => ({ done: true }),
        },
        {
          stepId: "second",
          description: "never runs",
          toolAllowlist: [],
          run: async () => ({ unreachable: true }),
        },
      ],
    });

    const result = await workflow.run({}, { signal: AbortSignal.abort() });

    expect(result.status).toBe("FAILED");
    expect(result.failure?.kind).toBe("ABORTED");
    expect(result.failure?.stepId).toBe("workflow");
    expect(result.failure?.message).toBe("workflow aborted before execution");
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["first", "SKIPPED"],
      ["second", "SKIPPED"],
    ]);
    expect(result.output).toBeNull();
  });
});

describe("workflow adapter: manual replay", () => {
  it("re-executes from the failure boundary and carries completed steps", async () => {
    let plannerCalls = 0;
    let reviewerCalls = 0;
    const workflow = defineWorkflow({
      workflowId: "replay",
      description: "replayable",
      steps: [
        {
          stepId: "analyst",
          description: "runs once",
          toolAllowlist: [],
          run: async () => ({ modules: 2 }),
        },
        {
          stepId: "planner",
          description: "fails first time",
          toolAllowlist: [],
          dependsOn: ["analyst"],
          run: async () => {
            plannerCalls += 1;
            if (plannerCalls === 1) throw namedError("BudgetExceededError", "over budget");
            return { plan: { edits: 1 } };
          },
        },
        {
          stepId: "reviewer",
          description: "never reached first time",
          toolAllowlist: [],
          dependsOn: ["planner"],
          run: async () => {
            reviewerCalls += 1;
            return { approved: true };
          },
        },
      ],
    });

    const first = await workflow.run({});
    expect(first.status).toBe("FAILED");
    expect(first.failure?.kind).toBe("BUDGET_EXCEEDED");
    expect(first.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["analyst", "COMPLETED"],
      ["planner", "FAILED"],
      ["reviewer", "SKIPPED"],
    ]);

    const replayPlan = planReplay(first.steps, "planner");
    expect(replayPlan.hydratedStepIds).toEqual(["analyst"]);
    expect(replayPlan.resumeStepIds).toEqual(["planner", "reviewer"]);

    const second = await workflow.replay(first.steps, "planner", {});
    expect(second.status).toBe("SUCCEEDED");
    expect(plannerCalls).toBe(2);
    expect(reviewerCalls).toBe(1);
    expect(second.replayedFromStepId).toBe("planner");
    expect(second.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["analyst", "COMPLETED"],
      ["planner", "COMPLETED"],
      ["reviewer", "COMPLETED"],
    ]);
    expect(second.output).toEqual({
      analyst: { modules: 2 },
      planner: { plan: { edits: 1 } },
      reviewer: { approved: true },
    });
  });

  it("rejects replay when the workflow input differs from the stored run (digest mismatch)", async () => {
    const workflow = defineWorkflow({
      workflowId: "replay-guard",
      description: "guarded replay",
      steps: [
        {
          stepId: "facts",
          description: "release facts",
          toolAllowlist: [],
          run: async () => ({ breaking: true }),
        },
        {
          stepId: "analyst",
          description: "carried",
          toolAllowlist: [],
          dependsOn: ["facts"],
          run: async (ctx) => ({
            breaking: (ctx.state["facts"] as { breaking: boolean }).breaking,
          }),
        },
        {
          stepId: "planner",
          description: "fails",
          toolAllowlist: [],
          dependsOn: ["analyst"],
          run: async () => {
            throw new Error("boom");
          },
        },
      ],
    });
    const first = await workflow.run({});
    expect(first.status).toBe("FAILED");

    await expect(workflow.replay(first.steps, "planner", { v: "different" })).rejects.toThrow(
      WorkflowDefinitionError,
    );
    await expect(workflow.replay(first.steps, "planner", { v: "different" })).rejects.toThrow(
      /replay input mismatch at hydrated step 'facts'/,
    );
  });

  it("rejects replay from unknown or already-completed steps", async () => {
    const workflow = defineWorkflow({
      workflowId: "replay-guard-2",
      description: "bad boundaries",
      steps: [
        {
          stepId: "a",
          description: "first",
          toolAllowlist: [],
          run: async () => ({ ok: true }),
        },
        {
          stepId: "b",
          description: "second",
          toolAllowlist: [],
          dependsOn: ["a"],
          run: async () => ({ ok: true }),
        },
      ],
    });
    const result = await workflow.run({});

    expect(() => planReplay(result.steps, "nope")).toThrow(/unknown step/);
    expect(() => planReplay(result.steps, "a")).toThrow(/already completed/);
    await expect(workflow.replay(result.steps, "nope", {})).rejects.toThrow(/unknown step 'nope'/);
  });
});

describe("workflow adapter: definition validation", () => {
  function step(stepId: string, options: Partial<{ dependsOn: string[] }> = {}) {
    return {
      stepId,
      description: stepId,
      toolAllowlist: [] as readonly string[],
      ...options,
      run: async () => ({ ok: true }),
    };
  }

  it("rejects duplicate step ids, unknown deps, and non-antecedent deps", () => {
    expect(() =>
      defineWorkflow({ workflowId: "x", description: "x", steps: [step("a"), step("a")] }),
    ).toThrow(/duplicate step ids/);

    expect(() =>
      defineWorkflow({
        workflowId: "x",
        description: "x",
        steps: [step("a", { dependsOn: ["ghost"] })],
      }),
    ).toThrow(/depends on unknown step 'ghost'/);

    expect(() =>
      defineWorkflow({
        workflowId: "x",
        description: "x",
        steps: [step("a", { dependsOn: ["b"] }), step("b")],
      }),
    ).toThrow(/depends on non-antecedent step 'b'/);
  });

  it("rejects transitions to unknown steps and duplicate gate ids", () => {
    expect(() =>
      defineWorkflow({
        workflowId: "x",
        description: "x",
        steps: [{ ...step("a"), transitions: { success: "ghost" } }],
      }),
    ).toThrow(/transitions to unknown step 'ghost'/);

    expect(() =>
      defineWorkflow({
        workflowId: "x",
        description: "x",
        steps: [step("a")],
        gates: [
          { gateId: "g", description: "d", check: () => ({ passed: true, detail: "" }) },
          { gateId: "g", description: "d", check: () => ({ passed: true, detail: "" }) },
        ],
      }),
    ).toThrow(/duplicate gate ids/);
  });
});
