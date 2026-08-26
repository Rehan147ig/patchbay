import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeBlock,
  EmptyState,
  PageHeader,
} from "@patchbay/ui";
import { requireUser } from "@/lib/auth";
import { PolicyToggle } from "@/components/policy-toggle";
import { Shield, ChevronDown } from "lucide-react";

export const metadata: Metadata = {
  title: "Policies",
};

export default async function PoliciesPage() {
  const user = await requireUser();

  const policies = await prisma.policy.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
  });

  const activeCount = policies.filter((p) => p.enabled).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Policies"
        description="Declarative deterministic gate rules evaluated before sandbox execution or draft PR publication. Toggling policies is recorded in the immutable audit trail."
        badge={
          <Badge tone="green" dot>
            {activeCount} of {policies.length} Active
          </Badge>
        }
      />

      {policies.length === 0 ? (
        <EmptyState
          icon={<Shield className="size-6 text-accent-400" />}
          title="No policy rules registered"
          description="Security and remediation gate policies will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {policies.map((policy) => (
            <Card
              key={policy.id}
              className={
                policy.enabled
                  ? "border-l-2 border-l-mint-400 bg-ink-900/60 transition-all hover:border-mint-400/80"
                  : "border-l-2 border-l-ink-700 bg-ink-900/30 opacity-75"
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CardTitle>{policy.name}</CardTitle>
                    <Badge tone={policy.enabled ? "green" : "neutral"} size="sm" dot>
                      {policy.enabled ? "Enforced" : "Disabled"}
                    </Badge>
                  </div>
                  <PolicyToggle policyId={policy.id} enabled={policy.enabled} />
                </div>
                <CardDescription className="mt-1">
                  {policy.definitionJson &&
                  typeof policy.definitionJson === "object" &&
                  "description" in policy.definitionJson
                    ? String(policy.definitionJson.description)
                    : "No description provided"}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <details className="group mt-2">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-accent-400 transition-colors hover:text-accent-300 flex items-center gap-1">
                    <span>Inspect policy JSON</span>
                    <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-3">
                    <CodeBlock maxHeight="14rem">
                      {JSON.stringify(policy.definitionJson, null, 2)}
                    </CodeBlock>
                  </div>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
