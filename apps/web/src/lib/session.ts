/**
 * Dev-only signed session cookie. Edge-safe (WebCrypto + atob/btoa only) so it can run in
 * Next middleware. Production auth (Clerk/Auth.js/SSO) replaces this behind the same seam.
 */

export const SESSION_COOKIE = "patchbay_session";

/** NextAuth session cookie names (database session strategy). */
export const NEXTAUTH_SESSION_COOKIES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;

/**
 * GitHub OAuth (NextAuth) is active only when all three values are present.
 * Without them the signed dev cookie above remains the only auth mechanism,
 * which keeps local demos, tests, and e2e independent of GitHub credentials.
 */
export function isGitHubOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.NEXTAUTH_SECRET);
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  sub: string;
  email: string;
  exp: number;
}

export function getSecret(): string {
  const secret = process.env.DEV_AUTH_SECRET;
  if (!secret || secret === "local-dev-secret-change-me") {
    throw new Error(
      "DEV_AUTH_SECRET is not set to a real secret. Refusing to sign session cookies with a known default.",
    );
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToUtf8(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function importKey(secret: string): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verify(data: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await importKey(secret);
    // crypto.subtle.verify performs the comparison in constant time. Copy
    // into a plain ArrayBuffer-backed view so it satisfies BufferSource.
    const actual = base64UrlToBytes(signature);
    const signatureBuffer = new Uint8Array(actual.byteLength);
    signatureBuffer.set(actual);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBuffer.buffer as ArrayBuffer,
      new TextEncoder().encode(data),
    );
  } catch {
    return false;
  }
}

export async function createSessionCookie(
  userId: string,
  email: string,
): Promise<{ name: string; value: string; options: Record<string, unknown> }> {
  const payload: SessionPayload = {
    sub: userId,
    email,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const data = utf8ToBase64Url(JSON.stringify(payload));
  const signature = await sign(data, getSecret());
  return {
    name: SESSION_COOKIE,
    value: `${data}.${signature}`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    },
  };
}

export async function readSessionCookie(
  cookieValue: string | undefined,
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  const [data, signature] = cookieValue.split(".");
  if (!data || !signature) return null;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    // Misconfigured secret: fail closed — no session is valid.
    return null;
  }
  const valid = await verify(data, signature, secret);
  if (!valid) return null;
  try {
    const payload = JSON.parse(base64UrlToUtf8(data)) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
