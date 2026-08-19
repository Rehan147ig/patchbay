"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface ConnectInstallation {
  installationId: number;
  accountLogin: string;
  accountType: string;
}

/**
 * Connects a GitHub repository through an App installation (MEMBER+). On
 * success the new repository page is opened so the member can scan it.
 */
export function ConnectRepositoryForm({ installations }: { installations: ConnectInstallation[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function connect(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const installationId = Number(formData.get("installationId"));
      const repositoryFullName = String(formData.get("repositoryFullName") ?? "").trim();
      const response = await apiFetch("/api/repositories/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId, repositoryFullName }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Failed to connect the repository");
        return;
      }
      const body = (await response.json()) as { data?: { repositoryId?: string } };
      const repositoryId = body.data?.repositoryId;
      if (repositoryId) {
        router.push(`/repositories/${repositoryId}`);
        router.refresh();
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form action={connect} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500">
          GitHub installation
          <select
            name="installationId"
            required
            defaultValue={String(installations[0]?.installationId ?? "")}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            {installations.map((installation) => (
              <option key={installation.installationId} value={installation.installationId}>
                {installation.accountLogin} ({installation.accountType}) ·{" "}
                {installation.installationId}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Repository (owner/repo)
          <input
            name="repositoryFullName"
            required
            placeholder="acme/billing-service"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          Connect repository
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
