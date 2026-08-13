import "server-only";
import { forbidden } from "@patchbay/domain";
import { readCsrfCookie, timingSafeEqual } from "./csrf";

/**
 * Throws a forbidden PatchbayError unless the pb_csrf cookie and the
 * x-csrf-token header on the request match. Server-side only; kept out of
 * csrf.ts because that module is bundled into the browser via client-fetch.ts
 * and @patchbay/domain is not browser-safe.
 */
export function assertCsrfToken(request: {
  headers: { get: (name: string) => string | null };
}): void {
  const cookie = readCsrfCookie(request.headers.get("cookie"));
  const header = request.headers.get("x-csrf-token");
  if (!cookie || !header || !timingSafeEqual(cookie, header)) {
    throw forbidden("CSRF token missing or mismatched");
  }
}
