import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeBlock,
  EmptyState,
} from "@patchbay/ui";
import { requireUser } from "@/lib/auth";
import { PolicyToggle } from "@/components/policy-toggle";

export const metadata: Metadata = {
  title: "Policies",
};

export default async function PoliciesPage() {
  const user = await requireUser();

  const policies = await prisma.policy.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Policies</h1>
        <p className="mt-1 text-sm text-ink-400">
          JSON-defined rules that govern remediation: when plans may be created, validated, or
          turned into draft pull requests. Toggling a policy records an audit event.
        </p>
      </div>

      {policies.length === 0 ? (
        <EmptyState title="No policies" description="Policy rules will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {policies.map((policy) => (
            <Card
              key={policy.id}
              className={
                policy.enabled
                  ? "border-l-4 border-l-mint-400 transition-colors"
                  : "border-l-4 border-l-ink-600"
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{policy.name}</CardTitle>
                  <PolicyToggle policyId={policy.id} enabled={policy.enabled} />
                </div>
                <CardDescription>
                  {policy.definitionJson &&
                  typeof policy.definitionJson === "object" &&
                  "description" in policy.definitionJson
                    ? String(policy.definitionJson.description)
                    : "No description"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <details className="group">
                  <summary className="cursor-pointer select-none text-xs font-medium text-accent-400 transition-colors hover:text-accent-300">
                    Show definition
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
