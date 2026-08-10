/**
 * Double-submit CSRF protection.
 *
 * The server sets a random `pb_csrf` cookie on every page/API response
 * (SameSite=Lax, readable by same-origin JS). Mutating requests must echo
 * the same value in the `x-csrf-token` header; the handler compares both.
 * A cross-site attacker cannot read or set either value, so a forged
 * request never carries a matching pair. Edge-safe: no Node APIs.
 */

import { forbidden } from "@patchbay/domain";
import type { NextRequest } from "next/server";

export const CSRF_COOKIE = "pb_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const CSRF_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function createCsrfToken(): string {
  return crypto.randomUUID();
}

export function csrfCookieOptions(
  isProduction: boolean,
): Record<string, string | boolean | number> {
  return {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: CSRF_MAX_AGE_SECONDS,
    secure: isProduction,
  };
}

/** Constant-time string comparison (length leak is irrelevant for a token). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Reads the CSRF cookie from the Cookie header (header-name case-insensitive). */
export function readCsrfCookie(request: NextRequest): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) return rest.join("=");
  }
  return undefined;
}

/** Throws 403 unless the cookie and the x-csrf-token header match. */
export function assertCsrfToken(request: NextRequest): void {
  const cookie = readCsrfCookie(request);
  const header = request.headers.get(CSRF_HEADER);
  if (!cookie || !header || !timingSafeEqual(cookie, header)) {
    throw forbidden("CSRF token missing or mismatched");
  }
}
