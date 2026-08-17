import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { requireStripeClient, requireStripeCustomerId } from "@/lib/billing";

/**
 * POST /api/billing/portal
 * Opens the Stripe billing portal (manage payment method, invoices, cancel)
 * for the organization's existing Stripe customer.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const customerId = await requireStripeCustomerId(user.organizationId);

    const client = requireStripeClient();
    const origin = request.nextUrl.origin;
    const session = await client.createPortalSession(customerId, `${origin}/settings`);

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.BILLING_PORTAL_STARTED,
      entityType: "organization",
      entityId: user.organizationId,
      correlationId,
      after: { stripeSessionId: session.id },
    });

    return jsonOk({ url: session.url }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
