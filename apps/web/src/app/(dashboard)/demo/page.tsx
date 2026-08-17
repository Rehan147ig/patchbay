import type { Metadata } from "next";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
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
      "Runs the openai@3.x → 4.x change: event created, normalized (method renames + feature adoption for structured outputs), impact assessed against ai-assistant-service. Patch, validation, and draft PR arrive in Phases 4-5.",
    available: true,
  },
  {
    id: "auth0-config",
    title: "Auth0 configuration change",
    description: "Policy-gated approval flow. Ships with Phase 6.",
    available: false,
  },
  {
    id: "openapi-response-field",
    title: "Generic OpenAPI response field removed",
    description: "Plan-only OpenAPI diff scenario. Ships with Phase 6.",
    available: false,
  },
] as const;

export default async function DemoPage() {
  await requireRole("VIEWER");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Demo scenarios</h1>
        <p className="text-sm text-slate-500">
          Deterministic, self-contained runs against the seeded demo data. Every run is audited and
          carries a correlation id.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SCENARIOS.map((scenario) => (
          <Card key={scenario.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {scenario.title}
                {!scenario.available ? <Badge tone="slate">Phase 6</Badge> : null}
              </CardTitle>
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
