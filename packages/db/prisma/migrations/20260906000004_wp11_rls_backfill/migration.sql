-- WP11 RLS hardening (spec §4.3): three organization-owned tables were
-- app-scoped (ORG_SCOPED_MODELS) but had no database-level tenant policy.
-- Any model with a non-nullable organizationId now enforces isolation in
-- Postgres itself, so a missing application filter fails closed instead of
-- leaking rows. Deliberately exempt (see org-scope.ts): User (session-bound
-- identity), WebhookDelivery (global receiver, org resolved per delivery),
-- Vendor and ContractSource (MIXED catalog/private rows with NULL orgs,
-- which an equality policy would hide from every tenant).

-- AutonomyPolicy (1:1 with Organization).
ALTER TABLE "AutonomyPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutonomyPolicy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AutonomyPolicy_tenant_isolation" ON "AutonomyPolicy";
CREATE POLICY "AutonomyPolicy_tenant_isolation" ON "AutonomyPolicy"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Workspace.
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace_tenant_isolation" ON "Workspace";
CREATE POLICY "Workspace_tenant_isolation" ON "Workspace"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- WorkspaceMember.
ALTER TABLE "WorkspaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WorkspaceMember_tenant_isolation" ON "WorkspaceMember";
CREATE POLICY "WorkspaceMember_tenant_isolation" ON "WorkspaceMember"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
