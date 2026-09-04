# Patchbay Trust Architecture — CISO One-Pager

**What Patchbay is:** an autonomous software-change engine that watches your dependencies and delivers third-party SDK/API remediations as GitHub **draft pull requests**. It finds, fixes, proves, and proposes — **humans always merge**.

## 1. Draft-PR only. Never auto-merge. Ever.

Patchbay cannot push to `main`, cannot merge, and has no auto-merge code path. Every remediation ends as a draft PR that your engineers review and merge with your existing branch protection, required checks, and merge queues. This is a product invariant, not a configuration flag.

## 2. Zero-network, zero-privilege validation sandboxes

Every patch is proven before it is proposed, inside an ephemeral Docker container launched with:

- `--network none` — no exfiltration, no dependency confusion at validation time
- `--cap-drop ALL` + non-root user — no container escape primitives
- `--read-only` root filesystem — only the workspace is writable
- CPU / memory / PID limits and hard timeouts on every run
- **Fixed command allowlist** — only exact-string allowlisted commands (`tsc`, test runners) can execute; commands are never constructed from model output or external text

The worker's secrets (DB URLs, tokens) never enter the sandbox; containers receive a minimal allowlisted environment.

## 3. Tamper-evident WORM audit trail

Every state change — detection, classification, plan, validation, approval, PR — appends to an **append-only audit log** enforced at the database layer with `BEFORE UPDATE / DELETE` rejection triggers. History can be written and read, never rewritten. Exports stream as cursor-paginated JSONL/CEF with per-batch HMAC signatures, plus an optional Splunk HEC forwarder for your SOC.

## 4. Content-addressed SHA-256 evidence chain

Every piece of release evidence is stored content-addressed (SHA-256 of canonical bytes) with deduplication. Any remediation can be traced byte-for-byte: upstream release → detected evidence → affected call-sites → generated patch → sandbox validation → approval → draft PR. If one byte changes anywhere, the hash chain breaks loudly instead of silently.

## 5. Two-person quorum on sensitive paths

Changes touching payment, auth, encryption, or secrets paths require **two distinct human approvers** (not one approver twice, not a stale approval — approvals are hash-bound to the exact patch contents and expire). Single-approval PRs on these paths are blocked at both PR creation vectors.

## 6. Enterprise identity and secrets hygiene

- **Per-organization SCIM 2.0** (Okta / Azure AD): automated provisioning and instant deprovisioning — revoked users lose every session immediately. Tokens stored as **Argon2id hashes only** (never plaintext), with rotation grace.
- **Credentials live server-side only**, redacted before logging, auditing, or any AI contact. GitHub tokens never reach the browser. AI output must validate through Zod schemas before it can affect state.

## 7. Deployment posture

Runs inside your VPC boundary model: bring your own forward-proxy CA bundle (TLS verification is never disabled — unknown issuers are still rejected) and your own npm mirror (Artifactory / Nexus / CodeArtifact, HTTPS-enforced) instead of the public registry.

## 8. Compliance trajectory

The controls above map to **SOC 2 Type I (Security, Availability, Confidentiality)** criteria; the WORM log, quorum enforcement, and evidence chain are designed as auditor-ready evidence. Formal certification audit is scheduled pre-GA — ask us for the current controls matrix.

---

_Contact: [your email] · Live demo: connect one repository, watch all of its dependencies — not just the well-known SDKs — get inventoried, assessed, and remediated as verified draft PRs._
