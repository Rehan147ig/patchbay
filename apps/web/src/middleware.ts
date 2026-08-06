import { NextResponse, type NextRequest } from "next/server";
import { readSessionCookie, SESSION_COOKIE } from "./lib/session";

const CORRELATION_HEADER = "x-correlation-id";

const PUBLIC_PATHS = ["/login", "/api/health"];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const correlationId =
    request.headers.get(CORRELATION_HEADER) ??
    request.headers.get("x-vercel-id") ??
    crypto.randomUUID();

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/vendors/");
  const session = await readSessionCookie(request.cookies.get(SESSION_COOKIE)?.value);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);

  if (!isPublic && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url, { headers: requestHeaders });
  }

  const response = isPublic
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
