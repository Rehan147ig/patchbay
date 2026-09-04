import { prisma } from "@patchbay/db";
import { CaseReasonCode } from "@patchbay/domain";
import { evaluatePromotionEligibility } from "@patchbay/policy-engine";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/vendors/promotions
 *
 * Evidence-based promotion proposals for the autonomous track (Step 5).
 * Groups autonomous-bump cases by vendor+package, evaluates each package's
 * measured PR outcomes (merge streaks, failure vetoes, validation linkage),
 * and returns proposal-ready evidence sorted eligible-first.
 *
 * MEMBER and above. Read-only: certification itself stays static
 * source-controlled configuration — a human promotes by code change, and this
 * endpoint makes the evidence undeniable. No audit event (pure observation).
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");

    const cases = await prisma.remediationCase.findMany({
      where: {
        organizationId: user.organizationId,
        reasonCode: CaseReasonCode.AUTONOMOUS_BUMP,
      },
      select: {
        id: true,
        release: {
          select: {
            product: {
              select: { vendor: { select: { slug: true } }, packageName: true },
            },
          },
        },
        outcomes: {
          select: {
            status: true,
            classification: true,
            validationRunId: true,
            createdAt: true,
          },
        },
      },
    });

    const byPackage = new Map<
      string,
      {
        vendorSlug: string;
        packageName: string;
        outcomes: Array<{
          status: "OPEN" | "MERGED" | "CLOSED";
          classification: string;
          validated: boolean;
          recordedAt: Date;
        }>;
      }
    >();
    for (const c of cases) {
      const vendorSlug = c.release.product.vendor.slug;
      const packageName = c.release.product.packageName;
      const key = `${vendorSlug}:${packageName}`;
      const entry = byPackage.get(key) ?? { vendorSlug, packageName, outcomes: [] };
      for (const o of c.outcomes) {
        entry.outcomes.push({
          status: o.status,
          classification: o.classification,
          validated: o.validationRunId !== null && o.validationRunId !== undefined,
          recordedAt: o.createdAt,
        });
      }
      byPackage.set(key, entry);
    }

    const proposals = [...byPackage.values()].map((entry) => {
      const eligibility = evaluatePromotionEligibility({ outcomes: entry.outcomes });
      return {
        vendorSlug: entry.vendorSlug,
        packageName: entry.packageName,
        eligible: eligibility.eligible,
        reasons: eligibility.reasons,
        evidence: eligibility.evidence,
      };
    });
    proposals.sort((a, b) => Number(b.eligible) - Number(a.eligible));

    return jsonOk({ proposals }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
