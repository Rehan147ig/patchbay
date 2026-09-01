-- Stage 3: Multi-tenant RLS foundation (defense-in-depth with withOrgContext)
-- Enables ROW LEVEL SECURITY on all organizationId-bearing tables and
-- creates a single tenant-isolation policy per table:
--   USING ("organizationId" = current_setting('app.current_organization_id', true))
-- The second arg true makes the setting optional (returns NULL instead of error)
-- so migrations, seed, and superuser maintenance work without a transaction-local value.
-- Application code MUST set the value per-transaction via SET LOCAL app.current_organization_id = 'org-xxx'
-- (see packages/db/src/rls.ts withRlsContext). withOrgContext remains the primary guard; RLS is the backup.
-- FORCE ROW LEVEL SECURITY ensures the owner bypass is not used — even table owners are checked.

DO $$ DECLARE t TEXT; BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'AuditEvent','GitHubInstallation','Repository','ReleaseRepositoryMatch','RepositoryDependency','RepositoryScan',
    'ImpactAssessment','ImpactAssessmentUsage','RemediationPlan','PatchArtifact','ValidationRun','PullRequest',
    'Policy','Approval','GraphSnapshot','GraphNode','GraphEdge','GraphSourceEvidence','GraphIndexJob',
    'AgentRun','AgentStep','RemediationCase','RemediationCaseEvent','PrOutcome','CapabilityGate','Subscription','Notification','TaskParameter',
    'VendorChangeEvent','IntegrationUsage'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- Drop existing policy if re-running
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.current_organization_id'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_organization_id'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- Vendor is mixed (global catalog + per-org private). Do NOT enable RLS there — it would hide the catalog.
-- User/WebhookDelivery are exempt per org-scope.ts.

-- Helper comment for operators:
-- To verify: SELECT * FROM pg_policies WHERE policyname LIKE '%_tenant_isolation';
