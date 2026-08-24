SELECT i."installationId", i."accountLogin", i."organizationId", o.name AS org_name, i."suspendedAt" FROM "GitHubInstallation" i JOIN "Organization" o ON o.id = i."organizationId";
SELECT id, name, "fullName", provider, "organizationId" FROM "Repository" LIMIT 5;
SELECT count(*) AS repos FROM "Repository";
