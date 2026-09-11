import { describe, expect, it, vi } from "vitest";

const seenAdds: Array<{ name: unknown; data: unknown; options: unknown }> = [];
vi.mock("bullmq", () => ({
  Queue: class {
    add(name: unknown, data: unknown, options: unknown) {
      seenAdds.push({ name, data, options });
      return Promise.resolve({ id: "job-1" });
    }
  },
}));

import { BACKGROUND_JOB_PRIORITY, enqueue, JobType, priorityForJobType } from "./index";

describe("priorityForJobType", () => {
  it("deprioritizes heavy background jobs so bursts cannot block the pipeline", () => {
    for (const jobType of [
      JobType.SCAN_REPOSITORY,
      JobType.GRAPH_INDEX,
      JobType.POLL_NPM_REGISTRY,
      JobType.UPDATE_TASK_PARAMETER,
      JobType.EVALUATE_CAPABILITY_HEALTH,
      JobType.SIEM_FORWARD,
    ] as const) {
      expect(priorityForJobType(jobType)).toBe(BACKGROUND_JOB_PRIORITY);
    }
  });

  it("leaves pipeline jobs at the default so they run first", () => {
    for (const jobType of [
      JobType.ANALYZE_CHANGE,
      JobType.RUN_VALIDATION,
      JobType.CREATE_PR,
      JobType.CLASSIFY_RELEASE,
      JobType.MATCH_RELEASE,
      JobType.AGENT_PLAN,
      JobType.AGENT_REPLAY,
      JobType.DETECT_RELEASES,
    ] as const) {
      expect(priorityForJobType(jobType)).toBeUndefined();
    }
  });
});

describe("enqueue priority lanes", () => {
  it("attaches the background priority to heavy jobs", async () => {
    seenAdds.length = 0;
    await enqueue(JobType.GRAPH_INDEX, { tiny: true });
    expect(seenAdds).toHaveLength(1);
    expect(seenAdds[0]).toMatchObject({
      name: JobType.GRAPH_INDEX,
      options: { priority: BACKGROUND_JOB_PRIORITY },
    });
  });

  it("leaves pipeline jobs without an explicit priority", async () => {
    seenAdds.length = 0;
    await enqueue(JobType.RUN_VALIDATION, { tiny: true });
    expect(seenAdds).toHaveLength(1);
    expect(seenAdds[0]?.options).toBeUndefined();
  });

  it("never overrides a caller-supplied priority", async () => {
    seenAdds.length = 0;
    await enqueue(JobType.GRAPH_INDEX, { tiny: true }, { priority: 1 });
    expect(seenAdds[0]).toMatchObject({ options: { priority: 1 } });
  });
});
