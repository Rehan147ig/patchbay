/**
 * Periodic capability health sweep (WP10). Enqueues an
 * EVALUATE_CAPABILITY_HEALTH evaluation for every (organization, vendor) pair
 * with terminal PR activity in the window, so thresholds are re-checked even
 * when no new webhook/feedback trigger arrives. Deterministic: same state,
 * same enqueued set.
 */
import { prisma } from "@patchbay/db";
import { PullRequestStatus } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";

export interface CapabilitySweepResult {
  evaluated: number;
}

export async function sweepCapabilityHealth(now = new Date()): Promise<CapabilitySweepResult> {
  const since = new Date(now.getTime() - 30 * 86_400_000);

  const terminalPrs = await prisma.pullRequest.findMany({
    where: {
      status: { in: [PullRequestStatus.MERGED, PullRequestStatus.CLOSED] },
      createdAt: { gte: since },
    },
    select: {
      organizationId: true,
      remediationPlan: {
        select: {
          impactAssessment: {
            select: {
              changeEvent: { select: { vendor: { select: { slug: true } } } },
            },
          },
        },
      },
    },
  });

  const pairs = new Map<string, { organizationId: string; vendorSlug: string }>();
  for (const pr of terminalPrs) {
    const vendorSlug = pr.remediationPlan?.impactAssessment.changeEvent.vendor.slug;
    if (!vendorSlug) continue;
    const key = `${pr.organizationId}:${vendorSlug}`;
    if (!pairs.has(key)) {
      pairs.set(key, { organizationId: pr.organizationId, vendorSlug });
    }
  }

  const correlationId = `sweep-${now.toISOString()}`;
  let evaluated = 0;
  for (const { organizationId, vendorSlug } of pairs.values()) {
    await enqueue(JobType.EVALUATE_CAPABILITY_HEALTH, {
      organizationId,
      vendorSlug,
      correlationId,
    });
    evaluated += 1;
  }

  return { evaluated };
}
