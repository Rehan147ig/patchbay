import { z } from "zod";
import { stripePriceIdForTier } from "@patchbay/billing";
import { AuditAction } from "@patchbay/audit";
import { ActorType, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { env } from "@/lib/env";
import { requireStripeClient } from "@/lib/billing";

const checkoutSchema = z.object({
  tier: z.enum(["PRO", "TEAM"]),
});

/**
 * POST /api/billing/checkout
 * Starts a Stripe Checkout session for the organization's subscription.
 * Only ADMIN and MEMBER roles may initiate billing changes.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { tier } = await parseBody(request, checkoutSchema);

    const priceId = stripePriceIdForTier(tier, env);
    if (!priceId) {
      throw validationFailed(`No Stripe price is configured for the ${tier} plan`);
    }

    const client = requireStripeClient();
    const origin = request.nextUrl.origin;
    const session = await client.createCheckoutSession({
      priceId,
      clientReferenceId: user.organizationId,
      successUrl: `${origin}/settings?billing=success`,
      cancelUrl: `${origin}/settings?billing=cancelled`,
      customerEmail: user.email || undefined,
      metadata: { planTier: tier, organizationId: user.organizationId },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.BILLING_CHECKOUT_STARTED,
      entityType: "organization",
      entityId: user.organizationId,
      correlationId,
      after: { tier, stripeSessionId: session.id },
    });

    return jsonOk({ url: session.url }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
