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
          className="flex items-center gap-2 rounded-xl border border-[#ff3b30]/20 bg-[#ff3b30]/10 px-3.5 py-2.5 text-xs font-medium text-[#ff3b30]"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Button
        type="submit"
        size="md"
        className="w-full justify-between rounded-full bg-[#0071e3] hover:bg-[#0077ed]"
        loading={pending}
      >
        <span>Sign in to console</span>
        <ArrowRight className="size-4" />
      </Button>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-500">
        <span className="font-semibold tracking-tight text-[#1d1d1f]">Demo workspace:</span>{" "}
        <code className="font-mono text-[#1d1d1f]">demo@patchbay.dev</code> /{" "}
        <code className="font-mono text-[#1d1d1f]">dev-only</code>
      </div>
    </form>
  );
}
