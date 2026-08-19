import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    gitHubInstallation: { findFirst: vi.fn() },
    repository: { findUnique: vi.fn(), upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/billing", () => ({
  assertRepositoryCapacity: vi.fn(),
  countActiveRepositories: vi.fn(),
}));

vi.mock("@patchbay/git-provider", () => ({
  createGitHubAppProviderFromStore: vi.fn(),
}));

vi.mock("@patchbay/env", () => ({
  getSecretStore: vi.fn().mockReturnValue({}),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { assertRepositoryCapacity, countActiveRepositories } from "@/lib/billing";
import { createGitHubAppProviderFromStore } from "@patchbay/git-provider";

const memberUser = { id: "u-member", organizationId: "org-acme" };

function requestWithCsrf(body: unknown): NextRequest {
  return new Request("http://localhost/api/repositories/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("POST /api/repositories/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.gitHubInstallation.findFirst).mockResolvedValue({
      installationId: 42,
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.repository.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.repository.upsert).mockResolvedValue({
      id: "repo-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(countActiveRepositories).mockResolvedValue(1);
    vi.mocked(assertRepositoryCapacity).mockResolvedValue({
      allowed: true,
      tier: "PRO",
      cap: 10,
      activeCount: 1,
      remaining: 9,
    } as never);
    vi.mocked(createGitHubAppProviderFromStore).mockResolvedValue({
      fetchRepositoryInfo: vi.fn().mockResolvedValue({
        externalId: "12345",
        name: "billing-service",
        fullName: "acme/billing-service",
        defaultBranch: "main",
      }),
    } as never);
  });

  it("registers a repository from an installation belonging to the organization (MEMBER)", async () => {
    const response = await POST(
      requestWithCsrf({ installationId: 42, repositoryFullName: "acme/billing-service" }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { repositoryId: string } };
    expect(body.data.repositoryId).toBe("repo-1");
    expect(prisma.repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: "GITHUB",
          fullName: "acme/billing-service",
          metadata: expect.objectContaining({ installationId: 42, provider: "GITHUB" }),
        }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-acme",
          action: "repository.registered",
          entityId: "repo-1",
        }),
      }),
    );
  });

  it("rejects installations that belong to another organization", async () => {
    vi.mocked(prisma.gitHubInstallation.findFirst).mockResolvedValue(null as never);
    const response = await POST(
      requestWithCsrf({ installationId: 99, repositoryFullName: "acme/billing-service" }),
    );
    expect(response.status).toBe(422);
    expect(prisma.repository.upsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await POST(requestWithCsrf({ installationId: 42 }));
    expect(response.status).toBe(422);
    expect(prisma.repository.upsert).not.toHaveBeenCalled();
  });
});
