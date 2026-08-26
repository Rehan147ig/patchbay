import { randomUUID } from "node:crypto";

const PLAN_ID = "387607f1-0710-49cb-b4dd-ab0287073b19";

async function main() {
  const correlationId = randomUUID();
  const { processCreatePR } = await import("../src/jobs/create-pr");
  const result = await processCreatePR({
    data: {
      remediationPlanId: PLAN_ID,
      organizationId: "org-acme",
      correlationId,
    },
  } as never);
  console.log("CREATE_PR result:", JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
