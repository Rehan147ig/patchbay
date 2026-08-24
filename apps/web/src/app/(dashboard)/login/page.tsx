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
    <div className="flex min-h-screen bg-ink-900">
      {/* Left: brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-center overflow-hidden border-r border-ink-700/70 bg-[#0d0e11] p-12 lg:flex">
        <div
          aria-hidden="true"
          className="absolute size-96 rounded-full bg-accent-500/10 blur-3xl animate-drift"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-32 right-0 size-80 rounded-full bg-mint-400/5 blur-3xl animate-drift"
        />
        <div className="relative z-10">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 text-2xl font-black text-white shadow-[0_0_40px_rgba(99,102,241,0.4)]">
              P
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-white">Patch</h1>
          </div>
          <p className="max-w-md text-lg leading-relaxed text-ink-300">
            Governed API-change remediation. Zero source code stored.
          </p>
          <ul className="mt-12 space-y-6">
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="flex items-start gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-ink-700 bg-ink-800 text-accent-400">
                  <pillar.icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-100">{pillar.title}</p>
                  <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-ink-400">
                    {pillar.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right: sign-in form */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 text-base font-black text-white shadow-[0_0_28px_rgba(99,102,241,0.35)]">
              P
            </span>
            <span className="text-lg font-bold tracking-tight text-white">Patch</span>
          </div>
          <Card className="border-ink-700/60 bg-ink-800/50 backdrop-blur-xl">
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
                  <div className="flex items-center gap-3 text-xs text-ink-500">
                    <span className="h-px flex-1 bg-ink-700" />
                    or
                    <span className="h-px flex-1 bg-ink-700" />
                  </div>
                </>
              ) : null}
              <LoginForm />
            </CardContent>
          </Card>
          <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-500">
            Local development MVP — the bundled sandbox and dev auth are not hardened multi-tenant
            infrastructure.
          </p>
        </div>
      </div>
    </div>
  );
}
