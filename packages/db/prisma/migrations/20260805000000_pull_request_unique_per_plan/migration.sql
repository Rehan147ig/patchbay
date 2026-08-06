-- Idempotency guard: exactly one PullRequest per RemediationPlan (enterprise-readiness Phase 0/1)
CREATE UNIQUE INDEX "PullRequest_remediationPlanId_key" ON "PullRequest"("remediationPlanId");
