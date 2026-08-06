# ADR-0006: Dev-only signed session cookie auth

Status: accepted

## Context

Local development must run without external auth credentials, but routes still need a real user
identity for role checks and approvals.

## Decision

- Seeded demo users; login sets an HttpOnly, SameSite=Lax cookie containing `{ userId, email }`
  signed with HMAC-SHA256 using `DEV_AUTH_SECRET` and an expiry.
- Auth logic lives behind a small `AuthProvider`-style seam (session helpers in
  `apps/web/src/lib/session.ts`) so Clerk/Auth.js/SSO can replace it without touching pages.
- Explicitly documented: not production auth (threat T11).

## Consequences

- One-click demo login; role checks (ADMIN/MEMBER/VIEWER) are real and enforced.
- No external dependency; swapping providers later is localized.
