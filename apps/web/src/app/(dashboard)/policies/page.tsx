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
        <h1 className="text-xl font-semibold text-slate-900">Policies</h1>
        <p className="text-sm text-slate-500">
          JSON-defined rules that govern remediation: when plans may be created, validated, or
          turned into draft pull requests. Toggling a policy records an audit event.
        </p>
      </div>

      {policies.length === 0 ? (
        <EmptyState title="No policies" description="Policy rules will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {policies.map((policy) => (
            <Card key={policy.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
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
                <CodeBlock maxHeight="14rem">
                  {JSON.stringify(policy.definitionJson, null, 2)}
                </CodeBlock>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
