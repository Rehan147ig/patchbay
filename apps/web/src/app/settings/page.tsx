import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const user = await requireUser();
  const [organization, vendors] = await Promise.all([
    prisma.organization.findUnique({ where: { id: user.organizationId } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Workspace and integration configuration.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Organization profile (demo).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-slate-800">{organization?.name ?? "—"}</p>
            <p className="text-xs text-slate-500">
              You are signed in as <span className="font-medium">{user.email}</span> with role{" "}
              <Badge tone={user.role === "ADMIN" ? "purple" : "blue"}>{user.role}</Badge>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monitored vendors</CardTitle>
            <CardDescription>
              Vendor catalog entries available for change monitoring.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {vendors.map((vendor) => (
                <li key={vendor.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{vendor.name}</p>
                    <p className="text-xs text-slate-500">
                      {vendor.category}
                      {vendor.docsUrl ? " · " + vendor.docsUrl : ""}
                    </p>
                  </div>
                  <Badge tone={vendor.enabled ? "green" : "neutral"}>
                    {vendor.enabled ? "enabled" : "disabled"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Local development notice</CardTitle>
          <CardDescription>Safety boundaries of this MVP.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Validation runs execute only allowlisted commands with timeouts and output caps.
            </li>
            <li>Pull requests are created as drafts only and are never auto-merged.</li>
            <li>Payment, auth, PII, webhook, and infrastructure changes require human approval.</li>
            <li>
              The bundled sandbox and dev authentication are local-development tools, not hardened
              multi-tenant infrastructure.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
