"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@patchbay/ui";
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
    <form action={connect} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="GitHub installation"
          name="installationId"
          required
          defaultValue={String(installations[0]?.installationId ?? "")}
          className="h-10 rounded-xl"
        >
          {installations.map((installation) => (
            <option key={installation.installationId} value={installation.installationId}>
              {installation.accountLogin} ({installation.accountType}) ·{" "}
              {installation.installationId}
            </option>
          ))}
        </Select>
        <Input
          label="Repository (owner/repo)"
          name="repositoryFullName"
          required
          placeholder="acme/billing-service"
          className="h-10 rounded-xl"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          loading={pending}
          className="rounded-full bg-[#0071e3] hover:bg-[#0077ed]"
        >
          Connect repository
        </Button>
        {error ? (
          <p role="alert" className="text-xs font-medium text-[#ff3b30]">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
