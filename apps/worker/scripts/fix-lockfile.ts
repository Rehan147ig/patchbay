import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
  const store = (await import("@patchbay/env")).getSecretStore();
  const { createAppJwt } = await import("@patchbay/git-provider/src/github-app-provider");
  const appId = await store.get("GITHUB_APP_ID");
  const keyB64 = await store.get("GITHUB_APP_PRIVATE_KEY");
  if (!appId || !keyB64) throw new Error("no app credentials");
  const jwt = createAppJwt(appId, Buffer.from(keyB64, "base64").toString("utf-8"));

  // Get installation token
  const tokenRes = await fetch("https://api.github.com/app/installations/156460272/access_tokens", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
  const { token } = (await tokenRes.json()) as { token: string };

  // Clone
  const workspace = mkdtempSync(path.join(tmpdir(), "patchbay-lockfix-"));
  const gitOpts = { cwd: workspace, encoding: "utf8" as const };
  const git = (...args: string[]) => execFileSync("git", args, { ...gitOpts }).trim();

  git(
    "clone",
    "https://x-access-token:" + token + "@github.com/Rehan147ig/patch-demo-openai-legacy.git",
    workspace,
  );
  console.log("cloned");

  // Run pnpm install to generate/update lockfile
  execFileSync("pnpm", ["install", "--no-frozen-lockfile"], {
    cwd: workspace,
    stdio: "inherit",
    shell: true,
  });
  console.log("lockfile regenerated");

  // Commit and push
  const authEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from("x-access-token:" + token).toString("base64")}`,
  };
  execFileSync("git", ["config", "user.email", "patch@local"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Patch Lockfile Bot"], { cwd: workspace });
  execFileSync("git", ["add", "pnpm-lock.yaml"], { cwd: workspace });
  execFileSync("git", ["commit", "-m", "chore: regenerate pnpm-lock.yaml for CI compatibility"], {
    cwd: workspace,
    env: authEnv,
  });
  execFileSync("git", ["push", "origin", "main"], { cwd: workspace, env: authEnv });
  console.log("pushed");

  rmSync(workspace, { recursive: true, force: true });
  console.log("done");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
