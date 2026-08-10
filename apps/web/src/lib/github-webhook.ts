import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
