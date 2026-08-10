import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALLOWED_COMMANDS,
  isAllowedCommand,
  runValidation,
  SandboxError,
  SANDBOX_MAX_OUTPUT_CHARS,
} from "./index";

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
});

function makeWorkspace(scripts: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "patchbay-sandbox-"));
  tempDirs.push(dir);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "sandbox-fixture", scripts }),
  );
  return dir;
}

describe("allowlist", () => {
  it("accepts only exact allowlist entries", () => {
    for (const command of ALLOWED_COMMANDS) expect(isAllowedCommand(command)).toBe(true);
    expect(isAllowedCommand("rm -rf /")).toBe(false);
    expect(isAllowedCommand("pnpm test -- --extra")).toBe(false);
    expect(isAllowedCommand("npm run typecheck && pnpm test")).toBe(false);
  });

  it("rejects a non-allowlisted command before spawning anything", async () => {
    const error = await runValidation("rm -rf /", tmpdir()).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SandboxError);
    expect((error as SandboxError).code).toBe("COMMAND_NOT_ALLOWLISTED");
  });
});

describe("runValidation", () => {
  it("runs an allowlisted command and reports success", async () => {
    const dir = makeWorkspace({ test: 'node -e "console.log(\\"hello-from-sandbox\\")"' });
    const result = await runValidation("npm test", dir);

    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-from-sandbox");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("reports a non-zero exit code as failure", async () => {
    const dir = makeWorkspace({ test: 'node -e "process.exit(3)"' });
    const result = await runValidation("npm test", dir);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("kills the process when the timeout is exceeded", async () => {
    const dir = makeWorkspace({ test: 'node -e "setTimeout(() => {}, 60000)"' });
    const result = await runValidation("npm test", dir, { timeoutMs: 700 });

    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  }, 20_000);

  it("bounds captured output", async () => {
    const dir = makeWorkspace({ test: 'node -e "console.log(\\"x\\".repeat(6000))"' });
    const result = await runValidation("npm test", dir);

    expect(result.output.length).toBeLessThanOrEqual(SANDBOX_MAX_OUTPUT_CHARS + 200);
    expect(result.output).toContain("[truncated");
  });

  it("redacts secret-looking values in output", async () => {
    const dir = makeWorkspace({
      test: 'node -e "console.log(\\"sk-abcdefghijklmnopqrstuvwxyz\\")"',
    });
    const result = await runValidation("npm test", dir);

    expect(result.output).toContain("[REDACTED]");
    expect(result.output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("does not leak the parent process environment to child commands", async () => {
    process.env.SANDBOX_LEAK_MARKER = "top-secret-marker";
    const dir = makeWorkspace({
      test: 'node -e "const e=process.env; console.log(Object.keys(e).sort().join(\\",\\")); console.log(\\"CI=\\"+e.CI)"',
    });
    const result = await runValidation("npm test", dir);

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("CI=true");
    expect(result.stdout).toContain("PATH");
    expect(result.stdout).not.toContain("SANDBOX_LEAK_MARKER");
    delete process.env.SANDBOX_LEAK_MARKER;
  });
});
