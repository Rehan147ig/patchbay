import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { DemoRunButton } from "@/components/demo-run-button";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Demo scenarios",
};

const SCENARIOS = [
  {
    id: "openai-migration",
    title: "OpenAI SDK migration",
    description:
      "Runs the openai@3.x → 4.x change: event created, normalized (method renames + structured outputs adoption), impact assessed against ai-assistant-service, rule-based patch applied, validated in sandbox, and mock draft PR created.",
    available: true,
  },
  {
    id: "auth0-config",
    title: "Auth0 configuration change",
    description:
      "Runs the Auth0 middleware change: impact detected on auth-gateway, policy engine evaluates REQUIRE_APPROVAL (AUTH risk tag). An admin can record plan approval — the approval is audited. Auth0 is not certified for DRAFT_PR; no draft PR is created even after approval.",
    available: true,
  },
  {
    id: "openapi-response-field",
    title: "Generic OpenAPI response field removed",
    description:
      "Runs an OpenAPI schema diff scenario: response property removal detected, impact assessed, producing a reviewable plan-only remediation with no automated code patch.",
    available: true,
  },
] as const;

export default async function DemoPage() {
  await requireRole("VIEWER");

  const sandboxRuntime = process.env.SANDBOX_RUNTIME ?? "process";
  const isProcess = sandboxRuntime === "process";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Demo scenarios</h1>
        <p className="text-sm text-slate-500">
          Deterministic, self-contained runs against the seeded demo data. Every run is audited and
          carries a correlation id.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Sandbox runner: <span className="font-mono text-slate-600">{sandboxRuntime}</span>
          {isProcess ? " (development/local only — not a multi-tenant sandbox)" : " (container)"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SCENARIOS.map((scenario) => (
          <Card key={scenario.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">{scenario.title}</CardTitle>
              <CardDescription>{scenario.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <DemoRunButton scenario={scenario.id} disabled={!scenario.available} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
