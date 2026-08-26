import { prisma } from "@patchbay/db";
import { enqueue, JobType } from "@patchbay/queue";
import { randomUUID } from "node:crypto";

async function main() {
  const planId = "387607f1-0710-49cb-b4dd-ab0287073b19";
  const orgId = "org-acme";
  const correlationId = randomUUID();

  // Verify gates
  const plan = await prisma.remediationPlan.findFirst({
    where: {
      id: planId,
      impactAssessment: { repository: { organizationId: orgId } },
    },
    include: {
      validations: { select: { status: true } },
      approvals: true,
      patches: true,
      pullRequests: true,
      impactAssessment: {
        include: {
          changeEvent: { include: { vendor: { select: { slug: true } } } },
          repository: true,
        },
      },
    },
  });
  if (!plan) throw new Error("plan not found");
  if (plan.pullRequests.length > 0) {
    console.log("PR already exists:", plan.pullRequests[0]?.url);
    return;
  }

  const hasPassingValidation = plan.validations.some((v) => v.status === "PASSED");
  const hasApproval = plan.approvals.some((a) => a.decision === "APPROVED");
  console.log("validation:", hasPassingValidation ? "PASSED" : "NOT-PASSED");
  console.log("approval:", hasApproval ? "GRANTED" : "NONE");

  if (!hasPassingValidation || !hasApproval) {
    throw new Error("policy gates not satisfied: need passing validation + approval");
  }

  await enqueue(JobType.CREATE_PR, {
    remediationPlanId: planId,
    organizationId: orgId,
    correlationId,
  });
  console.log("CREATE_PR job enqueued:", correlationId);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
