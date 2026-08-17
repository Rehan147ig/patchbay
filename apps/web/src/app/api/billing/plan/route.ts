import { prisma } from "@patchbay/db";
import {
  createStripeClient,
  PLAN_DEFINITIONS,
  repositoryCapacity,
  stripePriceIdForTier,
} from "@patchbay/billing";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { getEffectivePlan } from "@/lib/billing";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const plan = await getEffectivePlan(user.organizationId);
    const activeRepositories = await prisma.repository.count({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
    });
    const capacity = repositoryCapacity(plan.tier, activeRepositories);
    const client = createStripeClient(env);
    const upgradeableTiers = (["PRO", "TEAM"] as const).filter(
      (tier) => stripePriceIdForTier(tier, env) !== null,
    );

    return jsonOk(
      {
        billingEnabled: client !== null,
        planTier: plan.tier,
        status: plan.status,
        currentPeriodEnd: plan.currentPeriodEnd,
        repositoryCap: capacity.cap,
        activeRepositories: capacity.activeCount,
        remaining: capacity.remaining,
        prices: {
          PRO: PLAN_DEFINITIONS.PRO.priceCents,
          TEAM: PLAN_DEFINITIONS.TEAM.priceCents,
          ENTERPRISE: PLAN_DEFINITIONS.ENTERPRISE.priceCents,
        },
        upgradeableTiers,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
