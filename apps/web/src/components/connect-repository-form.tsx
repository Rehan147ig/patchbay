"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Select } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

export interface ConnectInstallation {
  installationId: number;
  accountLogin: string;
  accountType: string;
}

interface PickerRepository {
  fullName: string;
  defaultBranch: string;
  externalId: string;
  isPrivate: boolean;
}

/**
 * Rich repository picker (MEMBER+). Lists every repository the selected GitHub
 * App installation can access — searchable, with private/public and branch
 * badges — so members never type `owner/repo` by hand. One click connects and
 * queues the initial scan; the new repository page is opened on success.
 */
export function ConnectRepositoryForm({ installations }: { installations: ConnectInstallation[] }) {
  const router = useRouter();
  const [installationId, setInstallationId] = useState<string>(
    String(installations[0]?.installationId ?? ""),
  );
  const [query, setQuery] = useState("");
  const [repositories, setRepositories] = useState<PickerRepository[]>([]);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!installationId) {
      setRepositories([]);
      setConnected(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/github/installations/${installationId}/repositories`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to list repositories for this installation");
        const body = (await response.json()) as {
          data?: { repositories?: PickerRepository[]; connectedFullNames?: string[] };
        };
        if (cancelled) return;
        setRepositories(body.data?.repositories ?? []);
        setConnected(new Set(body.data?.connectedFullNames ?? []));
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error ? fetchError.message : "Failed to list repositories",
          );
          setRepositories([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [installationId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? repositories.filter((repo) => repo.fullName.toLowerCase().includes(needle))
      : repositories;
    return [...filtered].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [repositories, query]);

  function connect(fullName: string) {
    setError(null);
    setConnecting(fullName);
    const numericId = Number(installationId);
    apiFetch("/api/repositories/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId: numericId, repositoryFullName: fullName }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? "Failed to connect the repository");
        }
        const body = (await response.json()) as { data?: { repositoryId?: string } };
        const repositoryId = body.data?.repositoryId;
        startTransition(() => {
          if (repositoryId) {
            router.push(`/repositories/${repositoryId}`);
          }
          router.refresh();
        });
      })
      .catch((connectError: unknown) => {
        setError(connectError instanceof Error ? connectError.message : "Failed to connect");
        setConnecting(null);
      });
  }

  if (installations.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No GitHub installations connected yet.{" "}
        <a href="/settings/github" className="font-medium text-[#0071e3] hover:underline">
          Install the GitHub App
        </a>{" "}
        first, then pick a repository here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="GitHub installation"
          name="installationId"
          required
          value={installationId}
          onChange={(event) => setInstallationId(event.target.value)}
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
          label="Search repositories"
          name="repositorySearch"
          placeholder="Filter by owner or name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 rounded-xl"
        />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading repositories for this installation…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {repositories.length === 0
            ? "No repositories found for this installation. Check the installation scope on GitHub, then reload."
            : "No repositories match your search."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-[16px] border border-zinc-200/60 bg-white">
          {visible.map((repo) => {
            const isConnected = connected.has(repo.fullName);
            const isBusy = connecting === repo.fullName;
            return (
              <li
                key={repo.externalId}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium tracking-tight text-[#1d1d1f]">
                    {repo.fullName}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" variant="subtle">
                      {repo.isPrivate ? "Private" : "Public"}
                    </Badge>
                    <Badge tone="neutral" variant="outline">
                      {repo.defaultBranch}
                    </Badge>
                    {isConnected ? (
                      <Badge tone="green" variant="subtle">
                        Connected
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {isConnected ? (
                  <span className="shrink-0 text-xs font-medium text-zinc-400">Connected</span>
                ) : (
                  <Button
                    type="button"
                    loading={isBusy}
                    disabled={connecting !== null}
                    onClick={() => connect(repo.fullName)}
                    className="shrink-0 rounded-full bg-[#0071e3] hover:bg-[#0077ed]"
                  >
                    Connect &amp; Scan
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-xs font-medium text-[#ff3b30]">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-zinc-500">
        Connecting queues the initial AST scan automatically — no separate scan step needed.
      </p>
    </div>
  );
}
