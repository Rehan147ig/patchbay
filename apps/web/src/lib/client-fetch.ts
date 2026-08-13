import { CSRF_HEADER, readCsrfCookieClient } from "./csrf";

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * fetch wrapper for mutating browser calls. Echoes the double-submit CSRF
 * token from the cookie into the x-csrf-token header so API handlers can
 * reject forged cross-site requests.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== "GET" && method !== "HEAD") {
    const token = readCsrfCookieClient();
    if (token) headers.set(CSRF_HEADER, token);
  }
  return fetch(input, { ...init, headers });
}
