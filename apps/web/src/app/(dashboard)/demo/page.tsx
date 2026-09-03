import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { DemoRunButton } from "@/components/demo-run-button";
import { DemoSimulator } from "@/components/demo-simulator";
import { requireRole } from "@/lib/auth";
import {
  FlaskConical,
  CreditCard,
  MessageCircle,
  Cloud,
  Database,
  Lock,
  FileCode2,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Demo scenarios",
};

const SCENARIOS = [
  {
    id: "openai-migration",
    icon: FlaskConical,
    title: "OpenAI SDK migration",
    description:
      "Runs the openai@3.x → 4.x change: event created, normalized (method renames + structured outputs adoption), impact assessed against ai-assistant-service, rule-based patch applied, validated in sandbox, and mock draft PR created.",
    available: true,
  },
  {
    id: "stripe-metadata",
    icon: CreditCard,
    title: "Stripe customers.create metadata",
    description:
      "Runs the Stripe customers.create metadata change: event created, normalized (metadata parameter required, PAYMENT risk tag), impact assessed against billing-service, rule-based patch applied. PAYMENT changes require human approval — after an admin records approval and validation passes, a mock draft PR is created (stripe is certified for DRAFT_PR, unlike Auth0).",
    available: true,
  },
  {
    id: "anthropic-completions",
    icon: MessageCircle,
    title: "Anthropic Completions → Messages",
    description:
      "Runs the Anthropic Completions API change: anthropic.completions.create is renamed to anthropic.messages.create on claude-assistant-service. Certified DRAFT_PR (corpus-verified line rename).",
    available: true,
  },
  {
    id: "aws-sdk-v2-clients",
    icon: Cloud,
    title: "AWS SDK v2 constructors → v3 clients",
    description:
      "Runs the AWS SDK v2→v3 constructor rename: new AWS.S3() / SQS / DynamoDB become S3Client / SQSClient / DynamoDBClient on aws-workers-service. INFRASTRUCTURE requires approval. This kit does not rewrite SendCommand or .promise().",
    available: true,
  },
  {
    id: "supabase-auth-user",
    icon: Database,
    title: "Supabase auth.user → getUser",
    description:
      "Runs the Supabase JS v2 auth helper change: supabase.auth.user() is renamed to supabase.auth.getUser() on supabase-backend-service. AUTH requires approval; certified DRAFT_PR.",
    available: true,
  },
  {
    id: "auth0-config",
    icon: Lock,
    title: "Auth0 configuration change",
    description:
      "Runs the Auth0 middleware change: impact detected on auth-gateway, policy engine evaluates REQUIRE_APPROVAL (AUTH risk tag). An admin can record plan approval — the approval is audited. Auth0 is not certified for DRAFT_PR; no draft PR is created even after approval.",
    available: true,
  },
  {
    id: "openapi-response-field",
    icon: FileCode2,
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
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <div className="border-b border-zinc-200/60 pb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] antialiased">
          Demo scenarios
        </h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          Deterministic, self-contained runs against the seeded demo data. Every run is audited and
          carries a correlation id.
        </p>
        <p className="mt-2 text-xs text-zinc-400">
          Sandbox runner: <span className="font-mono text-zinc-600">{sandboxRuntime}</span>
          {isProcess ? " (development/local only — not a multi-tenant sandbox)" : " (container)"}
        </p>
      </div>

      <DemoSimulator />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {SCENARIOS.map((scenario) => (
          <Card
            key={scenario.id}
            className="group rounded-[20px] border-zinc-200 bg-white transition-all hover:border-zinc-300/80 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 shadow-sm transition-colors group-hover:border-[#0071e3]/20 group-hover:bg-[#0071e3]/5 group-hover:text-[#0071e3]">
                  <scenario.icon className="size-5" />
                </span>
                <CardTitle className="flex-1 leading-tight">{scenario.title}</CardTitle>
              </div>
              <CardDescription className="mt-2 leading-relaxed">
                {scenario.description}
              </CardDescription>
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
