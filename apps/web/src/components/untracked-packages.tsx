"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

function slugify(packageName: string): string {
  const slug = packageName
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length >= 3 ? slug : `internal-${slug}`;
}

/**
 * Private-SDK auto-discovery: packages imported by the repository but not
 * tracked by any vendor (catalog or private). ADMINs get one-click
 * registration as an organization-private vendor — the next scan then tracks
 * the package automatically via the vendor slug mapping.
 */
export function UntrackedPackages({ packages, isAdmin }: { packages: string[]; isAdmin: boolean }) {
  const router = useRouter();
  const [registering, setRegistering] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (packages.length === 0) return null;

  function register(packageName: string) {
    setError(null);
    setRegistering(packageName);
    const slug = slugify(packageName);
    apiFetch("/api/vendors/private", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, name: packageName }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? "Failed to register private SDK");
        }
        setRegistered((prev) => new Set(prev).add(packageName));
        router.refresh();
      })
      .catch((registerError: unknown) => {
        setError(registerError instanceof Error ? registerError.message : "Failed to register");
        setRegistering(null);
      });
  }

  return (
    <div className="rounded-[16px] border border-dashed border-zinc-200 bg-zinc-50/60 p-4">
      <p className="text-[12px] font-semibold tracking-tight text-[#1d1d1f]">
        Untracked packages — possible private SDKs
      </p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
        Imported but not monitored. Register one as a private SDK and the next scan tracks it
        automatically.
      </p>
      <ul className="mt-3 space-y-2">
        {packages.map((packageName) => {
          const done = registered.has(packageName);
          const busy = registering === packageName;
          return (
            <li key={packageName} className="flex items-center justify-between gap-3">
              <span className="truncate font-mono text-[12px] text-zinc-700">{packageName}</span>
              {done ? (
                <Badge tone="green" variant="subtle" size="sm">
                  Registered
                </Badge>
              ) : isAdmin ? (
                <Button
                  type="button"
                  size="xs"
                  loading={busy}
                  disabled={registering !== null}
                  onClick={() => register(packageName)}
                  className="shrink-0 rounded-full bg-[#0071e3] hover:bg-[#0077ed]"
                >
                  Register private SDK
                </Button>
              ) : (
                <Badge tone="neutral" variant="outline" size="sm">
                  Ask an admin to register
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-[#ff3b30]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
