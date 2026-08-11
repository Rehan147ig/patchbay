import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { sanitizeText } from "@patchbay/audit";

/**
 * Allowlisted command execution for validation runs (ADR-0004).
 *
 * Only exact-string matches from the allowlist can execute; commands are never
 * constructed from external text, so no metacharacters can reach a child. On
 * POSIX the command runs with shell:false as [program, ...args] — no shell at
 * all. Windows cannot spawn npm/pnpm (.cmd shims) without a shell, so it uses
 * cmd.exe /d /s /c (AutoRun disabled) over the static allowlist string. Both
 * paths pass a minimal allowlisted environment — the worker's secrets never
 * reach the child. Output is bounded and redacted.
 *
 * Backends:
 * - "process" (default, always available): spawns on the local host. NOT a
 *   hardened multi-tenant sandbox: an allowlisted script name can run whatever
 *   the target package.json defines, on the host.
 * - "container" (SANDBOX_RUNTIME=container, Docker daemon required): runs the
 *   allowlisted command in an ephemeral container with no network, no
 *   capabilities, a read-only root filesystem, and CPU/memory/PID caps. The
 *   workspace is the only writable path.
 * - "microvm" (stub): fails loudly until a Firecracker backend ships.
 */

export const ALLOWED_COMMANDS = [
  "pnpm install --frozen-lockfile",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "npm ci",
  "npm run lint",
  "npm run typecheck",
  "npm test",
] as const;

export const SANDBOX_TIMEOUT_MS = 120_000;
export const SANDBOX_MAX_OUTPUT_CHARS = 4_000;
const HARD_OUTPUT_CAP_CHARS = 100_000;

export function isAllowedCommand(command: string): boolean {
  return (ALLOWED_COMMANDS as readonly string[]).includes(command);
}

export class SandboxError extends Error {
  readonly code = "COMMAND_NOT_ALLOWLISTED" as const;

  constructor(command: string) {
    super(`Command is not on the validation allowlist: ${command}`);
    this.name = "SandboxError";
  }
}

export interface RunResult {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  output: string;
}

function truncate(text: string): string {
  if (text.length <= SANDBOX_MAX_OUTPUT_CHARS) return text;
  const kept = text.slice(0, SANDBOX_MAX_OUTPUT_CHARS);
  return `${kept}\n[truncated ${text.length - SANDBOX_MAX_OUTPUT_CHARS} chars]`;
}

/** Bound output size and scrub secret-looking values before it can be logged. */
function boundAndRedact(raw: string): string {
  return truncate(sanitizeText(raw));
}

export interface RunOptions {
  timeoutMs?: number;
}

export type SandboxRuntime = "process" | "microvm" | "container";

/**
 * Contract for executing allowlisted validation commands. Consumers depend on
 * this interface so a deployment can switch backends (process pool today,
 * container/microVM later) without touching the worker.
 */
export interface SandboxRunner {
  readonly runtime: SandboxRuntime;
  /** True when this backend is usable on the current host. */
  isAvailable(): Promise<boolean>;
  /** The policy-approved commands this runner will accept. */
  getAllowlist(): readonly string[];
  run(command: string, cwd: string, options?: RunOptions): Promise<RunResult>;
}

/**
 * Environment allowlist for child processes. The worker holds database URLs,
 * GitHub tokens and webhook secrets; none of those must ever reach a
 * validation command. CI=true keeps package managers in CI mode.
 */
function minimalChildEnv(): Record<string, string> {
  const env: Record<string, string> = { CI: "true" };
  if (process.platform === "win32") {
    for (const key of [
      "PATH",
      "PATHEXT",
      "SystemRoot",
      "SystemDrive",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
    ]) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
  } else {
    for (const key of ["PATH", "HOME", "LANG", "TERM", "TMPDIR"]) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
  }
  return env;
}

/**
 * Spawn an allowlisted command. On Windows npm/pnpm are .cmd shims that Node
 * refuses to spawn without a shell (EINVAL), so cmd.exe /d /s /c is required;
 * /d disables AutoRun and the command string is a static allowlist constant.
 */
export function runValidation(
  command: string,
  cwd: string,
  options: RunOptions = {},
): Promise<RunResult> {
  return processSandboxRunner.run(command, cwd, options);
}

/** Process-pool backend: spawns the command on the local host. */
export class ProcessSandboxRunner implements SandboxRunner {
  readonly runtime: SandboxRuntime = "process";

  getAllowlist(): readonly string[] {
    return ALLOWED_COMMANDS;
  }

  run(command: string, cwd: string, options: RunOptions = {}): Promise<RunResult> {
    if (!isAllowedCommand(command)) {
      return Promise.reject(new SandboxError(command));
    }

    const [program, ...args] = command.split(/\s+/).filter((part) => part.length > 0);
    if (!program) {
      return Promise.reject(new SandboxError(command));
    }

    const timeoutMs = options.timeoutMs ?? SANDBOX_TIMEOUT_MS;
    const started = performance.now();

    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", [program, ...args].join(" ")], {
            cwd,
            windowsHide: true,
            shell: false,
            env: minimalChildEnv(),
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn(program, args, {
            cwd,
            windowsHide: true,
            detached: true,
            shell: false,
            env: minimalChildEnv(),
            stdio: ["ignore", "pipe", "pipe"],
          });

    let rawStdout = "";
    let rawStderr = "";
    const append = (buffer: Buffer, target: () => string, set: (v: string) => void): void => {
      const current = target();
      if (current.length < HARD_OUTPUT_CAP_CHARS) {
        set((current + buffer.toString("utf8")).slice(0, HARD_OUTPUT_CAP_CHARS));
      }
    };

    child.stdout.on("data", (chunk: Buffer) =>
      append(
        chunk,
        () => rawStdout,
        (v) => (rawStdout = v),
      ),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      append(
        chunk,
        () => rawStderr,
        (v) => (rawStderr = v),
      ),
    );

    return new Promise((resolve) => {
      let timedOut = false;

      const childPids = (rootPid: number): Promise<number[]> =>
        new Promise((resolvePids) => {
          const ps = spawn(
            "powershell",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} } | Select-Object -ExpandProperty ProcessId`,
            ],
            { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
          );
          let out = "";
          ps.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
          ps.on("close", () => {
            resolvePids(
              out
                .split(/\s+/)
                .map((part) => Number.parseInt(part, 10))
                .filter((pid) => Number.isInteger(pid) && pid > 0),
            );
          });
          ps.on("error", () => resolvePids([]));
        });

      const collectDescendants = async (rootPid: number, depth: number): Promise<number[]> => {
        const direct = await childPids(rootPid);
        if (direct.length === 0 || depth >= 10) return direct;
        const deeper = await Promise.all(direct.map((pid) => collectDescendants(pid, depth + 1)));
        return [...direct, ...deeper.flat()];
      };

      const killPid = (pid: number): Promise<void> =>
        new Promise((resolveKill) => {
          const killer = spawn("taskkill", ["/pid", String(pid), "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.on("close", () => resolveKill());
          killer.on("error", () => resolveKill());
        });

      // taskkill /T walks the parent/child tree from a snapshot; a child spawned
      // after the snapshot becomes an orphan (parent dead) and is never reachable
      // again. Instead: keep the root alive, enumerate descendants by PID on
      // every pass, kill each by PID, and only kill the root once its tree is
      // empty. On POSIX a detached process group achieves the same via -pid.
      let killInFlight = false;
      const killTree = (): void => {
        const pid = child.pid;
        if (killInFlight || pid === undefined) return;
        killInFlight = true;
        void (async () => {
          try {
            if (process.platform === "win32") {
              const descendants = await collectDescendants(pid, 0);
              for (const descendant of descendants) {
                await killPid(descendant);
              }
              if ((await childPids(pid)).length === 0) {
                await killPid(pid);
              }
            } else {
              process.kill(-pid, "SIGKILL");
            }
          } catch {
            // process already gone; "close" will fire.
          } finally {
            killInFlight = false;
          }
        })();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);

      // After a timeout, taskkill can race process startup and miss freshly
      // spawned children; keep re-killing until the whole tree is gone. The
      // interval must never touch a running (non-timed-out) command.
      const killer = setInterval(() => {
        if (!timedOut) return;
        if (child.exitCode === null && child.signalCode === null) {
          killTree();
        } else {
          clearInterval(killer);
        }
      }, 1_000);

      child.on("close", (code) => {
        clearTimeout(timer);
        clearInterval(killer);
        resolve({
          ok: code === 0 && !timedOut,
          timedOut,
          exitCode: code,
          durationMs: Math.round(performance.now() - started),
          stdout: boundAndRedact(rawStdout),
          stderr: boundAndRedact(rawStderr),
          output: boundAndRedact(`${rawStdout}${rawStderr}`),
        });
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        clearInterval(killer);
        const message = `failed to spawn: ${error.message}`;
        resolve({
          ok: false,
          timedOut,
          exitCode: null,
          durationMs: Math.round(performance.now() - started),
          stdout: message,
          stderr: message,
          output: message,
        });
      });
    });
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/**
 * Default container limits. `node:20-slim` ships npm but not pnpm; pnpm-backed
 * commands (`pnpm install --frozen-lockfile`, …) require a pnpm-baked image,
 * selectable via SANDBOX_IMAGE.
 */
export const SANDBOX_IMAGE = "node:20-slim";
export const SANDBOX_CONTAINER_CPUS = "0.5";
export const SANDBOX_CONTAINER_MEMORY = "512m";
export const SANDBOX_CONTAINER_PIDS_LIMIT = 128;

export interface ContainerSandboxOptions {
  image?: string;
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
  /** Availability probe override (tests inject a fake; default: docker info). */
  probe?: () => Promise<boolean>;
  /** Container name suffix (tests inject a stable name to assert on). */
  containerName?: string;
}

/** Arguments for `docker run`, fully static aside from the workspace mount. */
export function buildDockerRunArgs(
  command: string,
  cwd: string,
  options: ContainerSandboxOptions = {},
): string[] {
  const image = options.image ?? process.env.SANDBOX_IMAGE ?? SANDBOX_IMAGE;
  const cpus = options.cpus ?? SANDBOX_CONTAINER_CPUS;
  const memory = options.memory ?? SANDBOX_CONTAINER_MEMORY;
  const pidsLimit = options.pidsLimit ?? SANDBOX_CONTAINER_PIDS_LIMIT;
  const name = options.containerName ?? `patchbay-sb-${randomUUID().slice(0, 12)}`;
  return [
    "run",
    "--rm",
    "--name",
    name,
    "--init",
    "--network",
    "none",
    "--cpus",
    cpus,
    "--memory",
    memory,
    "--pids-limit",
    String(pidsLimit),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m,noexec,nosuid",
    "--env",
    "CI=true",
    "--env",
    "HOME=/tmp",
    "--env",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "--env",
    "npm_config_cache=/tmp/npm-cache",
    "--env",
    "npm_config_update_notifier=false",
    "--workdir",
    "/app",
    "--volume",
    `${cwd}:/app:rw`,
    image,
    "sh",
    "-c",
    command,
  ];
}

/**
 * Container backend: runs the allowlisted command in an ephemeral Docker
 * container with no network, all capabilities dropped, no new privileges, a
 * read-only root filesystem (workspace is the only writable path), and
 * CPU/memory/PID caps. Host secrets are never passed; the container env is the
 * static allowlist above. `sh -c` over a static allowlist constant is the same
 * trust model as cmd.exe on Windows: the string can never contain input-derived
 * metacharacters. Timeouts SIGKILL the container.
 */
export class ContainerSandboxRunner implements SandboxRunner {
  readonly runtime: SandboxRuntime = "container";
  private readonly options: ContainerSandboxOptions;
  private availability: boolean | null = null;

  constructor(options: ContainerSandboxOptions = {}) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    if (this.availability === null) {
      const probe = this.options.probe ?? probeDocker;
      this.availability = await probe().catch(() => false);
    }
    return this.availability;
  }

  getAllowlist(): readonly string[] {
    return ALLOWED_COMMANDS;
  }

  async run(command: string, cwd: string, options: RunOptions = {}): Promise<RunResult> {
    if (!isAllowedCommand(command)) {
      return Promise.reject(new SandboxError(command));
    }
    if (!(await this.isAvailable())) {
      const reason =
        "container sandbox runtime requires a running Docker daemon; route validations to SANDBOX_RUNTIME=process or start Docker";
      return {
        ok: false,
        timedOut: false,
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: reason,
        output: reason,
      };
    }

    const args = buildDockerRunArgs(command, cwd, this.options);
    const timeoutMs = options.timeoutMs ?? SANDBOX_TIMEOUT_MS;
    const started = performance.now();

    const child = spawn("docker", args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let rawStdout = "";
    let rawStderr = "";
    const append = (buffer: Buffer, target: () => string, set: (v: string) => void): void => {
      const current = target();
      if (current.length < HARD_OUTPUT_CAP_CHARS) {
        set((current + buffer.toString("utf8")).slice(0, HARD_OUTPUT_CAP_CHARS));
      }
    };
    child.stdout.on("data", (chunk: Buffer) =>
      append(
        chunk,
        () => rawStdout,
        (v) => (rawStdout = v),
      ),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      append(
        chunk,
        () => rawStderr,
        (v) => (rawStderr = v),
      ),
    );

    return new Promise((resolve) => {
      let timedOut = false;
      let closed = false;

      const killContainer = (): void => {
        // Name is static by the time we spawn; a kill that misses (name unknown)
        // is harmless because --rm cleans up on exit.
        const nameIndex = args.indexOf("--name");
        const name = nameIndex >= 0 ? args[nameIndex + 1] : null;
        if (name) {
          const killer = spawn("docker", ["kill", "--signal", "SIGKILL", name], {
            windowsHide: true,
            shell: false,
            stdio: "ignore",
          });
          killer.on("error", () => undefined);
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killContainer();
      }, timeoutMs);

      child.on("close", (code) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0 && !timedOut,
          timedOut,
          exitCode: code,
          durationMs: Math.round(performance.now() - started),
          stdout: boundAndRedact(rawStdout),
          stderr: boundAndRedact(rawStderr),
          output: boundAndRedact(`${rawStdout}${rawStderr}`),
        });
      });

      child.on("error", (error) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        const message = `docker failed to start: ${error.message}`;
        resolve({
          ok: false,
          timedOut,
          exitCode: null,
          durationMs: Math.round(performance.now() - started),
          stdout: message,
          stderr: message,
          output: message,
        });
      });
    });
  }
}

/** Cheap daemon liveness probe: `docker info` returns non-zero when down. */
async function probeDocker(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 10_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * MicroVM backend (stub). The interface contract is implemented so the worker
 * can select it via SANDBOX_RUNTIME=microvm, but no Firecracker runtime is
 * bundled here. Until it is, any validation routed here fails loudly instead
 * of silently running on the wrong backend. The real backend would boot a
 * read-only rootfs microVM, mount the workspace read-only, drop networking,
 * and run the allowlisted command to completion with a hard CPU/memory cap.
 */
export class MicroVmSandboxRunner implements SandboxRunner {
  readonly runtime: SandboxRuntime = "microvm";
  private readonly available: boolean;

  constructor(options: { available?: boolean } = {}) {
    this.available = options.available ?? process.env.SANDBOX_RUNTIME === "microvm";
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  getAllowlist(): readonly string[] {
    return ALLOWED_COMMANDS;
  }

  async run(command: string, cwd: string, _options: RunOptions = {}): Promise<RunResult> {
    if (!isAllowedCommand(command)) {
      return Promise.reject(new SandboxError(command));
    }
    const reason = (await this.isAvailable())
      ? "microVM sandbox runtime is not implemented yet; route validations to SANDBOX_RUNTIME=process"
      : "microVM sandbox runtime is not available on this host";
    const result: RunResult = {
      ok: false,
      timedOut: false,
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: reason,
      output: reason,
    };
    return Promise.resolve(result);
  }
}

/**
 * Selects the sandbox backend for this process. Defaults to the process
 * runner; set SANDBOX_RUNTIME=container (Docker required) or
 * SANDBOX_RUNTIME=microvm (stub) to opt into a hardened backend.
 */
export function createSandboxRunner(runtime?: SandboxRuntime): SandboxRunner {
  const selected: SandboxRuntime =
    runtime ??
    (process.env.SANDBOX_RUNTIME === "container"
      ? "container"
      : process.env.SANDBOX_RUNTIME === "microvm"
        ? "microvm"
        : "process");
  if (selected === "container") return new ContainerSandboxRunner();
  if (selected === "microvm") return new MicroVmSandboxRunner();
  return new ProcessSandboxRunner();
}

const processSandboxRunner = new ProcessSandboxRunner();
