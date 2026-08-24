import { createAppJwt, decodeAppPrivateKey } from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";

/**
 * Dev diagnostic: verifies GITHUB_APP_* credentials against the live GitHub
 * API and lists every installation the App has on GitHub's side (regardless
 * of local bindings). Read-only; prints no secrets.
 */

async function main(): Promise<void> {
  const store = getSecretStore();
  const appId = await store.get("GITHUB_APP_ID");
  const privateKeyB64 = await store.get("GITHUB_APP_PRIVATE_KEY");
  if (appId === null || privateKeyB64 === null) {
    throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are not configured");
  }
  const jwt = createAppJwt(appId, decodeAppPrivateKey(privateKeyB64));

  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const appResponse = await fetch("https://api.github.com/app", { headers });
  console.log("GET /app ->", appResponse.status);
  if (!appResponse.ok) {
    console.log(await appResponse.text());
    return;
  }
  const app = (await appResponse.json()) as { slug: string; name: string };
  console.log("app slug:", app.slug);
  console.log("install URL:", `https://github.com/apps/${app.slug}/installations/new`);

  const installsResponse = await fetch("https://api.github.com/app/installations?per_page=20", {
    headers,
  });
  console.log("GET /app/installations ->", installsResponse.status);
  const installs = (await installsResponse.json()) as Array<{
    id: number;
    suspended_at: string | null;
    repository_selection: string;
    account: { login: string } | null;
    permissions: Record<string, string>;
  }>;
  for (const inst of installs) {
    console.log(
      `- installation ${inst.id} account=${inst.account?.login ?? "?"} selection=${inst.repository_selection} suspended=${inst.suspended_at !== null}`,
    );

    const tokenResponse = await fetch(
      `https://api.github.com/app/installations/${inst.id}/access_tokens`,
      { method: "POST", headers },
    );
    if (!tokenResponse.ok) continue;
    const token = ((await tokenResponse.json()) as { token: string }).token;
    const reposResponse = await fetch(
      "https://api.github.com/installation/repositories?per_page=50",
      {
        headers: { ...headers, Authorization: `Bearer ${token}` },
      },
    );
    if (!reposResponse.ok) continue;
    const repos = (await reposResponse.json()) as {
      repositories: Array<{ full_name: string; default_branch: string }>;
    };
    for (const repo of repos.repositories) {
      console.log(`    repo ${repo.full_name} (default: ${repo.default_branch})`);
    }
  }
}

main().catch((error: unknown) => {
  console.error("failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
