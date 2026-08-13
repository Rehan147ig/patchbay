import type { PrismaClient } from "@prisma/client";

/**
 * Defense-in-depth tenant scoping.
 *
 * Route handlers already filter by organizationId explicitly; `withOrgContext`
 * makes that structural: every scoped query on a scoped model is wrapped so a
 * missing organization filter fails the QUERY (returns nothing / throws)
 * instead of leaking rows. findUnique is intentionally untouched — its where
 * is a unique key without organizationId, so injecting one would make Prisma
 * throw; cross-org uniqueness is enforced by the explicit
 * `organizationId_...` compound keys in the schema.
 */

export const ORG_SCOPED_MODELS = [
  "AuditEvent",
  "GitHubInstallation",
  "Repository",
  "ReleaseRepositoryMatch",
  "RepositoryDependency",
  "RepositoryScan",
  "Vendor",
  "VendorChangeEvent",
  "IntegrationUsage",
  "ImpactAssessment",
  "ImpactAssessmentUsage",
  "RemediationPlan",
  "PatchArtifact",
  "ValidationRun",
  "PullRequest",
  "Policy",
  "Approval",
  "GraphSnapshot",
  "GraphNode",
  "GraphEdge",
  "GraphSourceEvidence",
  "GraphIndexJob",
  "AgentRun",
  "AgentStep",
] as const;

export type OrgScopedModel = (typeof ORG_SCOPED_MODELS)[number];

/**
 * Models that carry an organizationId column but are deliberately not
 * auto-scoped: User identity is bound by the session, not tenant queries;
 * WebhookDelivery is a global receiver whose org is resolved per delivery.
 */
export const ORG_SCOPE_EXEMPT_MODELS = ["User", "WebhookDelivery"] as const;

/** Prisma delegate property names are lower-camel (auditEvent), model names PascalCase. */
function delegateKeyOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

const SCOPE_KEYS = new Set(ORG_SCOPED_MODELS.map(delegateKeyOf));

const SCOPED_OPS = new Set([
  "findFirst",
  "findMany",
  "count",
  "aggregate",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

interface QueryArgs {
  where?: unknown;
}

function isQueryArgs(value: unknown): value is QueryArgs {
  return typeof value === "object" && value !== null;
}

function withOrganizationWhere(args: QueryArgs, organizationId: string): QueryArgs {
  const existing = args.where;
  if (existing === undefined) {
    return { ...args, where: { organizationId } };
  }
  // AND semantics preserve any caller filters; a caller-supplied
  // organizationId is harmless (it can only narrow, never widen).
  return { ...args, where: { AND: [{ organizationId }, existing] } };
}

/**
 * Wrap a Prisma client so every scoped read/write on an org-scoped model
 * automatically ANDs `organizationId` into its where clause. Returns a new
 * wrapper (the underlying client is untouched).
 */
export function withOrgContext<T extends PrismaClient>(client: T, organizationId: string): T {
  const isScopedModel = (name: unknown): name is OrgScopedModel =>
    typeof name === "string" && SCOPE_KEYS.has(name);

  const handler: ProxyHandler<object> = {
    get(target, prop, receiver) {
      if (typeof prop === "string" && isScopedModel(prop)) {
        const modelDelegate = Reflect.get(target, prop, receiver);
        if (typeof modelDelegate === "object" && modelDelegate !== null) {
          return new Proxy(modelDelegate as object, {
            get(modelTarget, opProp, modelReceiver) {
              const operation = Reflect.get(modelTarget, opProp, modelReceiver);
              if (typeof operation !== "function" || typeof opProp !== "string") {
                return operation;
              }
              if (!SCOPED_OPS.has(opProp)) return operation;
              return (...callArgs: unknown[]) => {
                const [first, ...rest] = callArgs;
                if (!isQueryArgs(first)) return operation.apply(modelTarget, callArgs);
                return operation.apply(modelTarget, [
                  withOrganizationWhere(first, organizationId),
                  ...rest,
                ]);
              };
            },
          });
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  };

  return new Proxy(client as object, handler) as T;
}
