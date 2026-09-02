import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { ShieldCheck, GitPullRequest, Lock } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { GitHubSignInButton } from "@/components/github-sign-in-button";
import { isGitHubOAuthConfigured } from "@/lib/session";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

const PILLARS = [
  {
    icon: ShieldCheck,
    title: "Governed remediation",
    body: "Deterministic rules propose; humans approve; policy gates every step.",
  },
  {
    icon: GitPullRequest,
    title: "Draft PRs, never auto-merge",
    body: "Validated migration patches land as reviewable draft pull requests.",
  },
  {
    icon: Lock,
    title: "Zero source stored",
    body: "Code is analyzed in disposable workspaces and never archived.",
  },
] as const;

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/overview");
  const oauthEnabled = isGitHubOAuthConfigured();

  return (
    <div className="flex min-h-screen bg-[#fbfbfd] font-sans antialiased">
      {/* Left: brand panel — Apple dark */}
      <div className="relative hidden w-1/2 flex-col justify-center overflow-hidden bg-[#1d1d1f] p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="absolute -top-24 -left-24 size-[520px] rounded-full bg-[#0071e3]/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-32 -right-24 size-[420px] rounded-full bg-white/5 blur-3xl"
        />
        <div className="relative z-10">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-white text-2xl font-semibold tracking-tight text-[#1d1d1f] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              P
            </span>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Patch</h1>
          </div>
          <p className="max-w-md text-lg leading-relaxed text-zinc-300">
            Governed API-change remediation. Zero source code stored.
          </p>
          <ul className="mt-12 space-y-6">
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="flex items-start gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/10">
                  <pillar.icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-white">{pillar.title}</p>
                  <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-zinc-400">
                    {pillar.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 mt-auto pt-12 text-xs leading-relaxed text-zinc-500">
          Patch — You build. We maintain. Draft PRs only, never auto-merge.
        </p>
      </div>

      {/* Right: sign-in form — Apple light */}
      <div className="flex w-full items-center justify-center bg-[#fbfbfd] p-6 lg:w-1/2 lg:p-8">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#1d1d1f] text-base font-semibold text-white shadow-sm">
              P
            </span>
            <span className="text-lg font-semibold tracking-tight text-[#1d1d1f]">Patch</span>
          </div>
          <Card className="rounded-[24px] border-zinc-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
            <CardHeader>
              <CardTitle className="text-base">Sign in to Patch</CardTitle>
              <CardDescription>
                {oauthEnabled
                  ? "Use your GitHub account, or the seeded demo user for local development."
                  : "Local development authentication with a seeded demo user."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {oauthEnabled ? (
                <>
                  <GitHubSignInButton />
                  <div className="flex items-center gap-3 text-xs font-medium text-zinc-400">
                    <span className="h-px flex-1 bg-zinc-200" />
                    or
                    <span className="h-px flex-1 bg-zinc-200" />
                  </div>
                </>
              ) : null}
              <LoginForm />
            </CardContent>
          </Card>
          <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-500">
            Local development MVP — the bundled sandbox and dev auth are not hardened multi-tenant
            infrastructure.
          </p>
        </div>
      </div>
    </div>
  );
}
