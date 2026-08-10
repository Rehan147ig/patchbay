import { NextResponse, type NextRequest } from "next/server";
import { buildSecurityHeaders } from "./lib/security-headers";
import { isGitHubOAuthConfigured, NEXTAUTH_SESSION_COOKIES, SESSION_COOKIE } from "./lib/session";

const CORRELATION_HEADER = "x-correlation-id";
const NONCE_HEADER = "x-nonce";

const PUBLIC_PATHS = ["/login", "/api/health"];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const correlationId =
    request.headers.get(CORRELATION_HEADER) ??
    request.headers.get("x-vercel-id") ??
    crypto.randomUUID();

  const nonce = crypto.randomUUID();
  const securityHeaders = buildSecurityHeaders({
    nonce,
    isProduction: process.env.NODE_ENV === "production",
  });

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/vendors/") ||
    pathname.startsWith("/api/webhooks/");

  // The dev cookie is fully verified here; the NextAuth cookie is only checked
  // for presence (edge middleware cannot query the session table) — route
  // handlers and pages re-validate it through getServerSession.
  const developmentCookie = request.cookies.get(SESSION_COOKIE)?.value;
  // In development the Edge runtime cannot reliably access the local HMAC
  // secret, so middleware only uses presence to avoid redirect loops.
  // In production the dev session cookie is NEVER accepted — production
  // authentication is GitHub OAuth only.
  let session: { sub: string; email: string; exp: number } | null = null;
  if (process.env.NODE_ENV === "production") {
    if (isGitHubOAuthConfigured()) {
      const hasOAuthSession = NEXTAUTH_SESSION_COOKIES.some((name) => request.cookies.has(name));
      if (hasOAuthSession) {
        session = { sub: "oauth", email: "", exp: Number.POSITIVE_INFINITY };
      }
    }
  } else if (developmentCookie) {
    session = { sub: "dev", email: "", exp: Number.POSITIVE_INFINITY };
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  // Next.js attaches this nonce to its inline RSC flight-payload script.
  requestHeaders.set(NONCE_HEADER, nonce);

  if (!isPublic && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url, { headers: requestHeaders });
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CORRELATION_HEADER, correlationId);
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
