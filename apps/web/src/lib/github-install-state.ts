import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GITHUB_INSTALL_STATE_COOKIE = "patchbay_github_install_state";
const STATE_TTL_MS = 10 * 60 * 1000;

interface InstallState {
  userId: string;
  organizationId: string;
  nonce: string;
  exp: number;
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.DEV_AUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET or DEV_AUTH_SECRET is required for GitHub installs");
  return value;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createGitHubInstallState(userId: string, organizationId: string): string {
  const payload: InstallState = {
    userId,
    organizationId,
    nonce: randomBytes(16).toString("base64url"),
    exp: Date.now() + STATE_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyGitHubInstallState(value: string | undefined): InstallState | null {
  if (!value) return null;
  const [data, providedSignature] = value.split(".");
  if (!data || !providedSignature) return null;
  const expectedSignature = sign(data);
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as InstallState;
    if (
      typeof payload.userId !== "string" ||
      typeof payload.organizationId !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
