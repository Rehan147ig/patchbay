export interface SecurityHeadersOptions {
  nonce: string;
  isProduction: boolean;
}

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * Security headers for every document/API response.
 *
 * Production CSP is strict: script-src trusts only same-origin files and the
 * per-request nonce (Next.js applies the x-nonce request header to the
 * inline RSC flight payload script). Dev relaxes script-src because HMR and
 * React refresh inject inline/eval scripts. Styles allow inline attributes
 * (style props) but scripts never do.
 */
export function buildSecurityHeaders({
  nonce,
  isProduction,
}: SecurityHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = { ...BASE_HEADERS };
  const scriptSrc = isProduction
    ? `'self' 'nonce-${nonce}'`
    : "'self' 'unsafe-inline' 'unsafe-eval'";
  headers["Content-Security-Policy"] = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  if (isProduction) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}
