import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerWatchtowerSchedulers } from "./watchtower";

vi.mock("@patchbay/queue", () => ({
  JobType: { DETECT_RELEASES: "detect-releases" },
  queue: { upsertJobScheduler: vi.fn() },
}));

vi.mock("@patchbay/vendor-connectors", () => ({
  getWatchtowerAdapters: vi.fn(),
}));

import { queue } from "@patchbay/queue";
import { getWatchtowerAdapters } from "@patchbay/vendor-connectors";

function mockAdapters() {
  vi.mocked(getWatchtowerAdapters).mockReturnValue([
    { slug: "npm:openai", source: "NPM" },
    { slug: "npm:stripe", source: "NPM" },
    { slug: "openapi:stripe", source: "OPENAPI" },
    { slug: "github-releases:openai", source: "GITHUB_RELEASE" },
  ] as never);
}

describe("registerWatchtowerSchedulers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapters();
  });

  it("registers npm/openapi and github schedulers with their cadences", async () => {
    const result = await registerWatchtowerSchedulers({
      pollingEnabled: true,
      npmIntervalMs: 900_000,
      githubIntervalMs: 1_800_000,
    });

    expect(result.registered).toHaveLength(2);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "watchtower-npm-openapi",
      { every: 900_000 },
      expect.objectContaining({
        name: "detect-releases",
        data: expect.objectContaining({
          adapterSlugs: ["npm:openai", "npm:stripe", "openapi:stripe"],
        }),
      }),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "watchtower-github",
      { every: 1_800_000 },
      expect.objectContaining({
        data: expect.objectContaining({ adapterSlugs: ["github-releases:openai"] }),
      }),
    );
  });

  it("registers nothing when polling is disabled", async () => {
    const result = await registerWatchtowerSchedulers({
      pollingEnabled: false,
      npmIntervalMs: 900_000,
      githubIntervalMs: 1_800_000,
    });

    expect(result.registered).toEqual([]);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
