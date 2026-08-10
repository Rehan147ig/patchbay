import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { LoginForm } from "@/components/login-form";
import { GitHubSignInButton } from "@/components/github-sign-in-button";
import { isGitHubOAuthConfigured } from "@/lib/session";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  const oauthEnabled = isGitHubOAuthConfigured();

  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Patchbay</CardTitle>
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
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                or
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          ) : null}
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
