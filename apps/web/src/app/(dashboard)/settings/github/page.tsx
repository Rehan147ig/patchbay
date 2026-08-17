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

  const installUrl = "/api/github/install";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">GitHub Integration</h1>
        <p className="text-sm text-slate-500">
          Install and manage the Patchbay GitHub App to enable automated PR creation and repository
          scanning.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected GitHub App Installations</CardTitle>
          <CardDescription>
            Grant Patchbay access to target repositories in your GitHub accounts or organizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {installations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
              <p className="text-sm text-slate-500 mb-4">No GitHub installations connected yet.</p>
              <a
                href={installUrl}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-800 transition"
              >
                Install Patchbay GitHub App
              </a>
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
