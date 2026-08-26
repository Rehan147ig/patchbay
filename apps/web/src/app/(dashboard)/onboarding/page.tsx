import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "Set up Patch",
};

export default async function OnboardingPage() {
  await requireRole("MEMBER");
  const appConfigured = Boolean(process.env.GITHUB_APP_SLUG?.trim());

  return (
    <div className="mx-auto mt-6 w-full max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Set up Patch</h1>
        <p className="mt-1 text-sm text-slate-500">
          One path to your first draft PR: install the GitHub App, connect a TypeScript repository
          that uses a DRAFT_PR-certified SDK, and watch a release turn into a reviewable migration.
          Every step is optional — you can always continue later from Settings.
        </p>
      </div>
      <OnboardingWizard appConfigured={appConfigured} />
    </div>
  );
}
