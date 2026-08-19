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
    id: "stripe-metadata",
    title: "Stripe customers.create metadata",
    description:
      "Runs the Stripe customers.create metadata change: event created, normalized (metadata parameter required, PAYMENT risk tag), impact assessed against billing-service, rule-based patch applied. PAYMENT changes require human approval — after an admin records approval and validation passes, a mock draft PR is created (stripe is certified for DRAFT_PR, unlike Auth0).",
    available: true,
  },
  {
    id: "anthropic-completions",
    title: "Anthropic Completions → Messages",
    description:
      "Runs the Anthropic Completions API change: anthropic.completions.create is renamed to anthropic.messages.create on claude-assistant-service. Certified DRAFT_PR (corpus-verified line rename).",
    available: true,
  },
  {
    id: "aws-sdk-v2-clients",
    title: "AWS SDK v2 constructors → v3 clients",
    description:
      "Runs the AWS SDK v2→v3 constructor rename: new AWS.S3() / SQS / DynamoDB become S3Client / SQSClient / DynamoDBClient on aws-workers-service. INFRASTRUCTURE requires approval. This kit does not rewrite SendCommand or .promise().",
    available: true,
  },
  {
    id: "supabase-auth-user",
    title: "Supabase auth.user → getUser",
    description:
      "Runs the Supabase JS v2 auth helper change: supabase.auth.user() is renamed to supabase.auth.getUser() on supabase-backend-service. AUTH requires approval; certified DRAFT_PR.",
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
