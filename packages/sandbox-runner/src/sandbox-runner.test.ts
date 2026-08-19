import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_COMMANDS,
  buildDockerRunArgs,
  ContainerSandboxRunner,
  createSandboxRunner,
  isAllowedCommand,
  MicroVmSandboxRunner,
  ProcessSandboxRunner,
  resolveSandboxMode,
  resolveSandboxValidationMode,
  runValidation,
  SandboxError,
  SandboxPolicyError,
  SANDBOX_CONTAINER_USER,
  SANDBOX_MAX_OUTPUT_CHARS,
} from "./index";

const tempDirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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
  // mkdtempSync creates mode 0700 dirs; the container's user namespace maps
  // to a different uid on the host, so make the fixture world-readable.
  chmodSync(dir, 0o755);
  const packageJson = path.join(dir, "package.json");
  writeFileSync(packageJson, JSON.stringify({ name: "sandbox-fixture", scripts }));
  chmodSync(packageJson, 0o644);
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

describe("runtime modes", () => {
  it("defaults to test under vitest, development otherwise, production via env", () => {
    expect(resolveSandboxMode()).toBe("test");
    vi.stubEnv("SANDBOX_MODE", "development");
    expect(resolveSandboxMode()).toBe("development");
    vi.stubEnv("SANDBOX_MODE", "production");
    expect(resolveSandboxMode()).toBe("production");
    vi.stubEnv("SANDBOX_MODE", "development");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveSandboxMode()).toBe("development");
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveSandboxMode()).toBe("production");
    vi.stubEnv("SANDBOX_MODE", "garbage");
    expect(resolveSandboxMode()).toBe("production");
  });

  it("production rejects the process runtime at startup and at execution", async () => {
    vi.stubEnv("SANDBOX_MODE", "production");
    expect(() => createSandboxRunner("process")).toThrow(SandboxPolicyError);
    expect(() => createSandboxRunner()).toThrow(SandboxPolicyError);
    const error = await runValidation("npm test", tmpdir()).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SandboxPolicyError);
  });

  it("production rejects the microVM stub and demands the container runtime", () => {
    vi.stubEnv("SANDBOX_MODE", "production");
    expect(() => createSandboxRunner("microvm")).toThrow(SandboxPolicyError);
    expect(createSandboxRunner("container")).toBeInstanceOf(ContainerSandboxRunner);
  });

  it("a process runner instance also refuses to run in production", async () => {
    vi.stubEnv("SANDBOX_MODE", "production");
    const runner = new ProcessSandboxRunner();
    const error = await runner.run("npm test", tmpdir()).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SandboxPolicyError);
    const micro = new MicroVmSandboxRunner({ available: true });
    const microError = await micro.run("npm test", tmpdir()).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(microError).toBeInstanceOf(SandboxPolicyError);
  });

  it("development allows the process runtime", () => {
    vi.stubEnv("SANDBOX_MODE", "development");
    expect(createSandboxRunner("process")).toBeInstanceOf(ProcessSandboxRunner);
  });

  it("defaults validation mode to hosted-docker and reads SANDBOX_VALIDATION_MODE", () => {
    expect(resolveSandboxValidationMode()).toBe("hosted-docker");
    vi.stubEnv("SANDBOX_VALIDATION_MODE", "github-checks-only");
    expect(resolveSandboxValidationMode()).toBe("github-checks-only");
    vi.stubEnv("SANDBOX_VALIDATION_MODE", "process");
    expect(resolveSandboxValidationMode()).toBe("process");
    vi.stubEnv("SANDBOX_VALIDATION_MODE", "garbage");
    expect(resolveSandboxValidationMode()).toBe("hosted-docker");
  });

  it("production stays fail-closed with the default hosted-docker validation mode", () => {
    vi.stubEnv("SANDBOX_MODE", "production");
    vi.stubEnv("SANDBOX_VALIDATION_MODE", "hosted-docker");
    expect(() => createSandboxRunner("process")).toThrow(SandboxPolicyError);
    expect(() => createSandboxRunner()).toThrow(SandboxPolicyError);
    expect(createSandboxRunner("container")).toBeInstanceOf(ContainerSandboxRunner);
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

describe("sandbox runners", () => {
  it("createSandboxRunner defaults to the process backend", () => {
    expect(createSandboxRunner()).toBeInstanceOf(ProcessSandboxRunner);
  });

  it("createSandboxRunner selects the microVM backend on request", () => {
    expect(createSandboxRunner("microvm")).toBeInstanceOf(MicroVmSandboxRunner);
  });

  it("process runner is always available with the full allowlist", async () => {
    const runner = createSandboxRunner();
    expect(runner.runtime).toBe("process");
    expect(await runner.isAvailable()).toBe(true);
    expect(runner.getAllowlist()).toEqual(ALLOWED_COMMANDS);
  });

  it("microVM runner fails loudly instead of silently falling back", async () => {
    const runner = createSandboxRunner("microvm");
    expect(runner.runtime).toBe("microvm");
    expect(await runner.isAvailable()).toBe(false);
    const result = await runner.run("npm test", tmpdir());
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("microVM");
  });

  it("microVM runner still enforces the allowlist first", async () => {
    const runner = new MicroVmSandboxRunner({ available: true });
    const error = await runner.run("rm -rf /", tmpdir()).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SandboxError);
  });

  it("process runner matches the legacy runValidation behavior", async () => {
    const dir = makeWorkspace({ test: 'node -e "console.log(\\"runner-works\\")"' });
    const result = await createSandboxRunner().run("npm test", dir);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("runner-works");
  });
});

describe("provenance", async () => {
  const dockerAvailable = await new ContainerSandboxRunner().isAvailable();

  it("records runtime, mode, network policy and failure class for a success", async () => {
    const dir = makeWorkspace({ test: 'node -e "console.log(\\"ok\\")"' });
    const result = await runValidation("npm test", dir);
    expect(result.provenance.runtime).toBe("process");
    expect(result.provenance.mode).toBe("test");
    expect(result.provenance.imageDigest).toBeNull();
    expect(result.provenance.networkPolicy).toBe("host-network");
    expect(result.provenance.failureClass).toBe("none");
    expect(result.provenance.workspace.path).toBe(dir);
    expect(result.provenance.workspace.disposable).toBe(false);
    expect(result.provenance.limits.timeoutMs).toBeGreaterThan(0);
  });

  it("classifies command failures and timeouts", async () => {
    const failing = makeWorkspace({ test: 'node -e "process.exit(7)"' });
    const failedResult = await runValidation("npm test", failing);
    expect(failedResult.provenance.failureClass).toBe("command-failed");

    const hanging = makeWorkspace({ test: 'node -e "setTimeout(() => {}, 60000)"' });
    const timedOutResult = await runValidation("npm test", hanging, { timeoutMs: 500 });
    expect(timedOutResult.provenance.failureClass).toBe("timed-out");
  }, 20_000);

  it.runIf(dockerAvailable)(
    "container provenance carries image digest and configured limits",
    async () => {
      const runner = new ContainerSandboxRunner({
        probe: async () => true,
        digestResolver: async () => "sha256:abc123",
        cpus: "1.5",
        memory: "1g",
        pidsLimit: 256,
      });
      const dir = makeWorkspace({ test: 'node -e "console.log(\\"provenance\\")"' });
      const result = await runner.run("npm test", dir, { timeoutMs: 120_000 });
      expect(result.provenance.runtime).toBe("container");
      expect(result.provenance.imageDigest).toBe("sha256:abc123");
      expect(result.provenance.limits).toEqual({
        cpus: "1.5",
        memory: "1g",
        pidsLimit: 256,
        timeoutMs: 120_000,
      });
      expect(result.provenance.networkPolicy).toBe("none");
      expect(result.provenance.workspace.disposable).toBe(true);
      expect(result.provenance.failureClass).toBe("none");
    },
    180_000,
  );

  it("reports runtime-unavailable for a container without a daemon", async () => {
    const runner = new ContainerSandboxRunner({ probe: async () => false });
    const result = await runner.run("npm test", tmpdir());
    expect(result.provenance.failureClass).toBe("runtime-unavailable");
    expect(result.provenance.runtime).toBe("container");
  });
});

describe("container runner", async () => {
  const dockerAvailable = await new ContainerSandboxRunner().isAvailable();

  it("isAvailable reports the daemon probe result", async () => {
    const runner = new ContainerSandboxRunner({ probe: async () => true });
    expect(await runner.isAvailable()).toBe(true);
    const failing = new ContainerSandboxRunner({ probe: async () => false });
    expect(await failing.isAvailable()).toBe(false);
  });

  it("builds hardened docker run arguments with no shell metacharacters", () => {
    const args = buildDockerRunArgs("npm test", "C:\\work dir", {
      containerName: "patchbay-sb-test",
    });
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--init");
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args).toContain("--cap-drop");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args).toContain("--security-opt");
    expect(args[args.indexOf("--security-opt") + 1]).toBe("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain("--pids-limit");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("128");
    expect(args[args.indexOf("--cpus") + 1]).toBe("0.5");
    expect(args[args.indexOf("--memory") + 1]).toBe("512m");
    expect(args[args.indexOf("--volume") + 1]).toBe("C:\\work dir:/app:rw");
    expect(args[args.indexOf("--name") + 1]).toBe("patchbay-sb-test");
    const commandIndex = args.indexOf("npm test");
    expect(commandIndex).toBeGreaterThan(0);
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("-it");
    expect(args.join(" ")).not.toMatch(/[;&|`$()<>]/);
  });

  it("enforces the allowlist before touching docker", async () => {
    const runner = new ContainerSandboxRunner({ probe: async () => true });
    const error = await runner.run("rm -rf /", tmpdir()).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SandboxError);
  });

  it("runs as a non-root user and never mounts the docker socket", () => {
    const args = buildDockerRunArgs("npm test", tmpdir(), { containerName: "patchbay-sb-noroot" });
    expect(args[args.indexOf("--user") + 1]).toBe(SANDBOX_CONTAINER_USER);
    expect(args[args.indexOf("--user") + 1]).not.toBe("0:0");
    expect(args.join(" ")).not.toContain("/var/run/docker.sock");
    expect(args.join(" ")).not.toContain("--privileged");
  });

  it("requires an explicit policy for registry egress", () => {
    const args = buildDockerRunArgs("npm test", tmpdir(), {
      containerName: "patchbay-sb-net",
      networkPolicy: "registry-only",
    });
    expect(args[args.indexOf("--network") + 1]).toBe("bridge");
    expect(() =>
      buildDockerRunArgs("npm test", tmpdir(), {
        networkPolicy: "host-network" as never,
      }),
    ).toThrow(SandboxPolicyError);
    const runner = new ContainerSandboxRunner({ probe: async () => true });
    return runner.run("npm test", tmpdir(), { networkPolicy: "host-network" }).then(
      () => {
        throw new Error("expected host-network to be rejected");
      },
      (error: unknown) => expect(error).toBeInstanceOf(SandboxPolicyError),
    );
  });

  it("mounts an immutable dependency cache read-only when configured", () => {
    const args = buildDockerRunArgs("npm test", tmpdir(), {
      containerName: "patchbay-sb-cache",
      cacheDir: "C:\\dep-cache",
    });
    expect(args).toContain("C:\\dep-cache:/npm-cache:ro");
    const env = args
      .filter((_, index) => args[index - 1] === "--env")
      .map((value) => value.split("=")[0]);
    expect(env).toContain("npm_config_cache");
    const npmCacheValue = args[args.indexOf("npm_config_cache=/npm-cache") + 0];
    expect(npmCacheValue).toBe("npm_config_cache=/npm-cache");
  });

  it("fails loudly when the daemon is unavailable", async () => {
    const runner = new ContainerSandboxRunner({ probe: async () => false });
    const result = await runner.run("npm test", tmpdir());
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Docker daemon");
  });

  it("never passes host secrets into the container environment", () => {
    process.env.SANDBOX_CONTAINER_LEAK_MARKER = "top-secret-marker";
    const args = buildDockerRunArgs("npm test", tmpdir());
    const env = args
      .filter((_, index) => args[index - 1] === "--env")
      .map((value) => value.split("=")[0]);
    expect(env).not.toContain("SANDBOX_CONTAINER_LEAK_MARKER");
    expect(env).toContain("CI");
    expect(env).toContain("HOME");
    delete process.env.SANDBOX_CONTAINER_LEAK_MARKER;
  });

  it.runIf(dockerAvailable)(
    "runs npm test inside an isolated container",
    async () => {
      const dir = makeWorkspace({ test: 'node -e "console.log(\\"hello-from-container\\")"' });
      const result = await new ContainerSandboxRunner().run("npm test", dir);
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("hello-from-container");
    },
    60_000,
  );

  it.runIf(dockerAvailable)(
    "kills the container when the timeout is exceeded",
    async () => {
      const dir = makeWorkspace({ test: 'node -e "setTimeout(() => {}, 60000)"' });
      const result = await new ContainerSandboxRunner().run("npm test", dir, {
        timeoutMs: 1_500,
      });
      expect(result.timedOut).toBe(true);
      expect(result.ok).toBe(false);
    },
    60_000,
  );

  it.runIf(dockerAvailable)(
    "blocks network egress (--network none)",
    async () => {
      const script =
        'node -e "Promise.any([' +
        "[fetch('http://host.docker.internal:1/'),fetch('http://172.17.0.1:1/'),fetch('http://127.0.0.1:1/')]" +
        "]).then(()=>{console.log('LINK-UP');process.exit(0)}).catch(()=>{console.log('LINK-DOWN');process.exit(0)})\"";
      const dir = makeWorkspace({ test: script });
      const result = await new ContainerSandboxRunner().run("npm test", dir);
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("LINK-DOWN");
    },
    60_000,
  );

  it.runIf(dockerAvailable)(
    "redacts secret-looking values in container output",
    async () => {
      const dir = makeWorkspace({
        test: 'node -e "console.log(\\"sk-abcdefghijklmnopqrstuvwxyz\\")"',
      });
      const result = await new ContainerSandboxRunner().run("npm test", dir);
      expect(result.output).toContain("[REDACTED]");
      expect(result.output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    },
    60_000,
  );

  it.runIf(dockerAvailable)(
    "does not leak the parent environment into the container",
    async () => {
      process.env.SANDBOX_CONTAINER_RUNTIME_MARKER = "container-top-secret";
      const dir = makeWorkspace({
        test: 'node -e "const e=process.env; console.log(Object.keys(e).sort().join(\\",\\")); console.log(\\"CI=\\"+e.CI)"',
      });
      const result = await new ContainerSandboxRunner().run("npm test", dir);
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("CI=true");
      expect(result.stdout).not.toContain("SANDBOX_CONTAINER_RUNTIME_MARKER");
      delete process.env.SANDBOX_CONTAINER_RUNTIME_MARKER;
    },
    60_000,
  );
});
