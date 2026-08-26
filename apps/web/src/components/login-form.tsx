"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Input } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";
import { AlertCircle, ArrowRight } from "lucide-react";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    setError(null);
    startTransition(async () => {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Sign in failed");
        return;
      }
      const next = searchParams.get("next");
      window.location.assign(next ?? "/overview");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Work Email"
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue="demo@patchbay.dev"
        required
        placeholder="name@company.com"
      />
      <Input
        label="Password"
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        defaultValue="dev-only"
        required
        placeholder="••••••••"
      />

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Button type="submit" size="md" className="w-full justify-between" loading={pending}>
        <span>Sign in to console</span>
        <ArrowRight className="size-4" />
      </Button>

      <div className="rounded-lg border border-ink-700/60 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-ink-400">
        <span className="font-semibold text-gray-300">Demo workspace:</span>{" "}
        <code>demo@patchbay.dev</code> / <code>dev-only</code>
      </div>
    </form>
  );
}
