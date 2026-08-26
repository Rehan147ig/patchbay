import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "GitHub App Settings",
};

export default async function GitHubSettingsPage() {
  const user = await requireUser();

  const installations = await prisma.gitHubInstallation.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { installedAt: "desc" },
  });

  const appConfigured = Boolean(process.env.GITHUB_APP_SLUG?.trim());
  const installUrl = "/api/github/install";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">GitHub Integration</h1>
        <p className="text-sm text-slate-500">
          Install and manage the Patch GitHub App to enable automated PR creation and repository
          scanning.
        </p>
      </div>

      {appConfigured ? null : (
        <div
          role="alert"
          className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-300"
        >
          <p className="font-semibold">App not configured.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Installing is disabled because this deployment is missing{" "}
            <code className="font-mono">GITHUB_APP_SLUG</code>. A working integration also requires{" "}
            <code className="font-mono">GITHUB_APP_ID</code>,{" "}
            <code className="font-mono">GITHUB_APP_PRIVATE_KEY</code> (base64 PEM), and{" "}
            <code className="font-mono">GITHUB_APP_WEBHOOK_SECRET</code>. See docs/self-host.md.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connected GitHub App Installations</CardTitle>
          <CardDescription>
            Grant Patch access to target repositories in your GitHub accounts or organizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {installations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
              <p className="text-sm text-slate-500 mb-4">No GitHub installations connected yet.</p>
              {appConfigured ? (
                <a
                  href={installUrl}
                  className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-800 transition"
                >
                  Install Patch GitHub App
                </a>
              ) : (
                <p className="text-xs text-amber-300">
                  Install link unavailable until the App environment is configured.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {installations.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{inst.accountLogin}</p>
                    <p className="text-xs text-slate-500">
                      {inst.accountType} ·{" "}
                      {inst.repositorySelection === "all"
                        ? "All repositories"
                        : "Selected repositories"}{" "}
                      · Installation ID #{inst.installationId}
                    </p>
                  </div>
                  <Badge tone={inst.suspendedAt ? "red" : "green"}>
                    {inst.suspendedAt ? "suspended" : "active"}
                  </Badge>
                </div>
              ))}
              <div className="pt-2">
                <a
                  href={installUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 transition"
                >
                  + Add or reconfigure GitHub App installation
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
