import { describe, expect, it } from "vitest";
import { localGitProvider } from "./index";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";

const OPENAI_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/repositories/openai-node-legacy",
);

describe("LocalGitProvider", () => {
  it("creates a local draft pull request workspace and applies patches", async () => {
    const result = await localGitProvider.createDraftPullRequest({
      repositoryName: "openai-node-legacy",
      fixtureDir: OPENAI_FIXTURE,
      branchName: "patchbay/openai-v4-migration",
      title: "Migrate OpenAI SDK to v4",
      body: "Automated remediation plan applied by Patchbay.",
      patches: [
        {
          filePath: "src/chat/chat-service.ts",
          patchedContent: "// patched content test",
        },
      ],
    });

    expect(result.provider).toBe("LOCAL");
    expect(result.branchName).toBe("patchbay/openai-v4-migration");
    expect(result.status).toBe("DRAFT");
    expect(result.url).toContain("file:///");
    expect(result.localWorkspaceDir).toBeDefined();

    if (result.localWorkspaceDir) {
      const patchedFilePath = path.join(result.localWorkspaceDir, "src/chat/chat-service.ts");
      expect(existsSync(patchedFilePath)).toBe(true);
      expect(readFileSync(patchedFilePath, "utf8")).toBe("// patched content test");

      // Cleanup
      rmSync(result.localWorkspaceDir, { recursive: true, force: true });
    }
  });
});
