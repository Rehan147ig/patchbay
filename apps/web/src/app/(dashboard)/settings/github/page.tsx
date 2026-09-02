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
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <div className="border-b border-zinc-200/60 pb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] antialiased">
          GitHub Integration
        </h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          Install and manage the Patch GitHub App to enable automated PR creation and repository
          scanning.
        </p>
      </div>

      {appConfigured ? null : (
        <div
          role="alert"
          className="rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <p className="text-[13px] font-semibold tracking-tight">App not configured.</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            Installing is disabled because this deployment is missing{" "}
            <code className="font-mono text-[#1d1d1f]">GITHUB_APP_SLUG</code>. A working integration
            also requires <code className="font-mono text-[#1d1d1f]">GITHUB_APP_ID</code>,{" "}
            <code className="font-mono text-[#1d1d1f]">GITHUB_APP_PRIVATE_KEY</code> (base64 PEM),
            and <code className="font-mono text-[#1d1d1f]">GITHUB_APP_WEBHOOK_SECRET</code>. See
            docs/self-host.md.
          </p>
        </div>
      )}

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Connected GitHub App Installations</CardTitle>
          <CardDescription>
            Grant Patch access to target repositories in your GitHub accounts or organizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {installations.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center">
              <p className="mb-4 text-sm text-zinc-500">No GitHub installations connected yet.</p>
              {appConfigured ? (
                <a
                  href={installUrl}
                  className="inline-flex items-center justify-center rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0077ed]"
                >
                  Install Patch GitHub App
                </a>
              ) : (
                <p className="text-xs text-amber-700">
                  Install link unavailable until the App environment is configured.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {installations.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between gap-3 rounded-[16px] border border-zinc-200 bg-zinc-50 p-4"
                >
                  <div>
                    <p className="text-[13px] font-semibold tracking-tight text-[#1d1d1f]">
                      {inst.accountLogin}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {inst.accountType} ·{" "}
                      {inst.repositorySelection === "all"
                        ? "All repositories"
                        : "Selected repositories"}{" "}
                      · Installation ID #{inst.installationId}
                    </p>
                  </div>
                  <Badge tone={inst.suspendedAt ? "red" : "green"} variant="subtle">
                    {inst.suspendedAt ? "suspended" : "active"}
                  </Badge>
                </div>
              ))}
              <div className="pt-2">
                <a
                  href={installUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0071e3] transition-colors hover:text-[#0077ed] hover:underline"
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
