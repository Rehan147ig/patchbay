import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "Set up Patchbay",
};

export default async function OnboardingPage() {
  await requireRole("MEMBER");

  return (
    <div className="mx-auto mt-6 w-full max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Set up Patchbay</h1>
        <p className="mt-1 text-sm text-slate-500">
          Three steps to connect your repositories and start watching upstream releases. Every step
          is optional — you can always continue later from Settings.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
