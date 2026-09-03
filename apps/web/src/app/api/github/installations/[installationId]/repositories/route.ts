import { prisma } from "@patchbay/db";
import { listInstallationRepositoriesFromStore } from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/github/installations/[installationId]/repositories
 * Lists repositories accessible to a GitHub App installation for the
 * organization, with already-connected repos flagged. Powers the rich
 * repository picker (searchable, private/public + branch badges) so members
 * never have to type `owner/repo` by hand.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ installationId: string }> },
) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const { installationId: rawId } = await params;
    const installationId = Number(rawId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      return jsonOk({ repositories: [], connectedFullNames: [] }, correlationId);
    }

    const installation = await prisma.gitHubInstallation.findFirst({
      where: {
        organizationId: user.organizationId,
        installationId,
        suspendedAt: null,
      },
      select: { installationId: true },
    });
    if (!installation) {
      return jsonOk({ repositories: [], connectedFullNames: [] }, correlationId);
    }

    const [repositories, connected] = await Promise.all([
      listInstallationRepositoriesFromStore(installationId, getSecretStore()),
      prisma.repository.findMany({
        where: { organizationId: user.organizationId },
        select: { fullName: true },
      }),
    ]);

    return jsonOk(
      {
        repositories,
        connectedFullNames: connected.map((repo) => repo.fullName),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
