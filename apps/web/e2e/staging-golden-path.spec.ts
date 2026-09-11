import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Staging golden path (P0-3): ONE deterministic end-to-end maintenance loop,
 * traced by a single correlation ID from ingest to dashboard.
 *
 * Chain: demo login (UI) → agent-key issue → signed agent event → demo change
 * ingest → impact analysis → remediation plan → sandbox validation → second-
 * human approval → draft PR artifact → check_run ingestion → audit export →
 * dashboard states. Negatives: duplicate delivery, invalid signature,
 * permission-denied (401 logged-out, 403 wrong role).
 *
 * STAGING BOUNDARY (read before running): this spec needs the full stack —
 * web + worker + Postgres + Redis + seeded demo data — started with a KNOWN
 * webhook secret. Without it, every test below SKIPS with setup instructions
 * instead of passing vacuously:
 *   E2E_STAGING=1 E2E_WEBHOOK_SECRET=<must equal server GITHUB_APP_WEBHOOK_SECRET>
 *   E2E_DEMO_EMAIL=demo@patchbay.dev E2E_DEMO_PASSWORD=<must equal server DEMO_USER_PASSWORD>
 *   pnpm dev   (web :3000 + worker, seeded DB)
 *   E2E_STAGING=1 pnpm exec playwright test staging-golden-path --project=chromium
 *
 * What this spec does NOT cover (documented, not hidden):
 * - Positive check_run→verdict matching needs a GitHub-backed repo + numeric
 *   PR (local provider PRs carry no GitHub number); covered by
 *   route.check-runs.test.ts (9 tests). Here check_run proves live,
 *   fail-closed ingestion for unknown PRs.
 * - Worker-failure/DLQ injection is covered by wp13-drills.test.ts (real DB)
 *   and DLQ unit tests; here we assert DLQ *visibility* wiring only.
 * - RBAC 403 uses the seeded viewer account (role VIEWER).
 */

const STAGING = process.env.E2E_STAGING === "1";
const WEBHOOK_SECRET = process.env.E2E_WEBHOOK_SECRET ?? "";
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? "demo@patchbay.dev";
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "dev-only";
const ENGINEER_EMAIL = "engineer@patchbay.dev";
const VIEWER_EMAIL = "viewer@patchbay.dev";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const SETUP_MESSAGE = [
  "Staging golden path skipped: set E2E_STAGING=1 with the full stack running:",
  "  1. pnpm dev (web on :3000 + worker) against seeded Postgres + Redis",
  "  2. E2E_WEBHOOK_SECRET=<value> AND server GITHUB_APP_WEBHOOK_SECRET=<same value>",
  "  3. E2E_DEMO_EMAIL/E2E_DEMO_PASSWORD matching server DEMO_USER_EMAIL/DEMO_USER_PASSWORD",
  "  4. E2E_STAGING=1 pnpm exec playwright test staging-golden-path --project=chromium",
].join("\n");

// Unique per run, matches the server's correlation grammar [A-Za-z0-9._-]{8,128}.
const CID = `e2e-golden-${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 12)}`;

async function loginAs(page: Page, email: string, password: string, who: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.waitForURL(/\/overview/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Overview" }))
    .toBeVisible()
    .catch(() => {
      throw new Error(
        `${who} login did not land on /overview — is DEMO_USER_PASSWORD set on the server and E2E_DEMO_PASSWORD matching it client-side?`,
      );
    });
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === "pb_csrf")?.value;
  if (!token) {
    throw new Error(
      "pb_csrf cookie missing after login — the server did not set a CSRF cookie; cannot drive mutating APIs",
    );
  }
  return { "x-csrf-token": token };
}

interface ApiEnvelope<T = unknown> {
  data?: T;
  error?: { message?: string; code?: string };
  correlationId?: string;
}

/** POST with correlation tracing + CSRF; asserts the server echoed OUR id. */
async function tracedPost<T>(
  request: APIRequestContext,
  csrf: Record<string, string>,
  path: string,
  body: unknown,
): Promise<{ status: number; json: ApiEnvelope<T> }> {
  const response = await request.post(path, {
    headers: { ...csrf, "x-correlation-id": CID },
    data: body,
  });
  const json = (await response.json()) as ApiEnvelope<T>;
  expect.soft(json.correlationId, `POST ${path} must echo correlation ${CID}`).toBe(CID);
  return { status: response.status(), json };
}

async function tracedGet<T>(
  request: APIRequestContext,
  path: string,
): Promise<{ status: number; json: ApiEnvelope<T> }> {
  const response = await request.get(path, { headers: { "x-correlation-id": CID } });
  const json = (await response.json()) as ApiEnvelope<T>;
  expect.soft(json.correlationId, `GET ${path} must echo correlation ${CID}`).toBe(CID);
  return { status: response.status(), json };
}

function signWebhook(body: string, deliveryId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`,
    "x-correlation-id": CID,
  };
}

test.describe("staging golden path", () => {
  test.skip(!STAGING, SETUP_MESSAGE);

  test("one correlation ID across ingest → plan → validate → approve → PR → audit → UI", async ({
    page,
    browser,
  }) => {
    test.setTimeout(280_000);
    if (!WEBHOOK_SECRET) {
      test.skip(
        true,
        "E2E_WEBHOOK_SECRET is empty — set it to the server's GITHUB_APP_WEBHOOK_SECRET and rerun",
      );
      return;
    }

    // Preflight 1: staging stack serves DB + Redis. Any transport failure
    // (refused/timeout) is missing infrastructure, not product failure.
    let healthJson: { data?: { db?: string; redis?: string } };
    try {
      const health = await page.request.get("/api/health", { timeout: 60_000 });
      healthJson = (await health.json()) as typeof healthJson;
    } catch (error) {
      test.skip(
        true,
        `staging /api/health unreachable (${error instanceof Error ? error.message : String(error)}) — start the web server backed by Postgres + Redis and rerun`,
      );
      return;
    }
    test.skip(
      healthJson.data?.db !== "ok" || healthJson.data?.redis !== "ok",
      `staging stack unhealthy (db=${healthJson.data?.db} redis=${healthJson.data?.redis}) — start Postgres + Redis and rerun`,
    );

    // Auth (UI): demo ADMIN login renders the maintenance overview.
    await loginAs(page, DEMO_EMAIL, DEMO_PASSWORD, "demo ADMIN");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    const csrf = await csrfHeaders(page);

    // Preflight 2: a live worker heartbeat — without it every poll below
    // would time out and look like product failure.
    let queues: { status: number; json: ApiEnvelope<{ workers?: Array<{ fresh?: boolean }> }> };
    try {
      queues = await tracedGet<{
        workers?: Array<{ workerId: string; fresh?: boolean }>;
      }>(page.request, "/api/operations/queues");
    } catch (error) {
      test.skip(
        true,
        `operations API unreachable (${error instanceof Error ? error.message : String(error)}) — check web server + ADMIN demo session and rerun`,
      );
      return;
    }
    const liveWorker = ((queues.json.data as { workers?: Array<{ fresh?: boolean }> })?.workers ??
      []) as Array<{ fresh?: boolean }>;
    test.skip(
      !liveWorker.some((w) => w.fresh !== false),
      "no live worker heartbeat on /api/operations/queues — start the worker (pnpm dev) and rerun",
    );

    // Connector setup: issue an agent key for the shared openai slug. The
    // credential lands on THIS org's enrollment, never the catalog row.
    const keyed = await tracedPost<{ agentKey: string; vendorSlug: string }>(
      page.request,
      csrf,
      "/api/vendors/openai/agent-key",
      {},
    );
    expect(keyed.status).toBe(201);
    const agentKey = keyed.json.data?.agentKey ?? "";
    expect(agentKey.startsWith("pb_agent_")).toBe(true);

    // Signed agent event ingestion (Bearer credential proof).
    const authed = await page.request.post("/api/vendors/openai/events", {
      headers: {
        ...csrf,
        authorization: `Bearer ${agentKey}`,
        "x-correlation-id": CID,
        "content-type": "application/json",
      },
      data: {
        sourceType: "SDK_RELEASE",
        severity: "HIGH",
        externalReference: `e2e-agent-${CID}`,
        rawPayload: { description: `E2E golden path probe ${CID}` },
      },
    });
    const authedJson = (await authed.json()) as ApiEnvelope<{ changeEventId: string }>;
    expect(authed.status()).toBe(201);
    expect(authedJson.correlationId).toBe(CID);
    expect(authedJson.data?.changeEventId).toBeTruthy();

    // Detection ingest: demo change → worker analyzes (ANALYZE_CHANGE).
    const demoed = await tracedPost<{ changeEventId: string; status: string }>(
      page.request,
      csrf,
      "/api/demo/run",
      { scenario: "openai-migration" },
    );
    expect(demoed.status).toBe(202);
    const changeEventId = demoed.json.data?.changeEventId;
    if (!changeEventId) throw new Error("demo/run returned no changeEventId — cannot continue");

    // Impact analysis: poll the change until the worker records assessments.
    const assessed = await expect
      .poll(
        async () => {
          const detail = await tracedGet<{
            event?: { impactAssessments?: unknown[] };
          }>(page.request, `/api/vendor-changes/${changeEventId}`);
          return detail.json.data?.event?.impactAssessments ?? [];
        },
        {
          timeout: 180_000,
          intervals: [5_000],
          message:
            "no impact assessment appeared — is the worker running and consuming ANALYZE_CHANGE?",
        },
      )
      .not.toEqual([]);

    // Remediation plan from the assessed change.
    const planned = await tracedPost<{ plans?: Array<{ id: string }> }>(
      page.request,
      csrf,
      `/api/vendor-changes/${changeEventId}/plan`,
      {},
    );
    expect(planned.status).toBe(201);
    const planId = planned.json.data?.plans?.[0]?.id;
    if (!planId) {
      throw new Error(
        `plan endpoint returned no plan id (status ${planned.status}) — inspect vendor-changes plan response shape`,
      );
    }

    // Validation request → worker executes in the sandbox.
    const validated = await tracedPost<{ validationRunId: string; status: string }>(
      page.request,
      csrf,
      `/api/remediations/${planId}/validate`,
      {},
    );
    expect(validated.status).toBe(202);

    // Poll the worker verdict. SKIPPED means this staging host cannot
    // execute customer code (github-checks-only) — the delivery half cannot
    // proceed here, so skip explicitly instead of failing or faking it.
    let finalStatus = "PENDING";
    await expect
      .poll(
        async () => {
          const detail = await tracedGet<{
            validations?: Array<{ status: string }>;
          }>(page.request, `/api/remediations/${planId}`);
          const statuses = detail.json.data?.validations?.map((v) => v.status) ?? [];
          if (statuses.includes("PASSED")) finalStatus = "PASSED";
          else if (statuses.includes("FAILED")) finalStatus = "FAILED";
          else if (statuses.includes("SKIPPED")) finalStatus = "SKIPPED";
          return finalStatus;
        },
        {
          timeout: 240_000,
          intervals: [5_000],
          message: "validation run never reached a terminal state — is the worker running?",
        },
      )
      .not.toBe("PENDING");
    if (finalStatus === "SKIPPED") {
      test.skip(
        true,
        "validation recorded SKIPPED (staging runs github-checks-only) — rerun against a staging host with executable sandbox validation for the delivery half",
      );
      return;
    }
    expect(
      finalStatus,
      "staging validation must PASS for the golden path to continue — inspect worker logs + sandbox",
    ).toBe("PASSED");

    // Human approval by a SECOND human (engineer, MEMBER): separation of
    // duties forbids the plan requester (demo admin) from approving.
    const engContext = await browser.newContext({ baseURL: BASE_URL });
    const engPage = await engContext.newPage();
    await loginAs(engPage, ENGINEER_EMAIL, DEMO_PASSWORD, "engineer (second human)");
    const engCsrf = await csrfHeaders(engPage);
    const approved = await tracedPost(
      engPage.request,
      engCsrf,
      `/api/remediations/${planId}/approve`,
      {
        decision: "APPROVED",
        note: `E2E golden path ${CID}`,
      },
    );
    expect(approved.status, "second-human approval must be accepted").toBe(200);
    await engContext.close();

    // Draft PR: the route only QUEUES (202); the worker delivers. Poll the
    // remediation until the worker records the artifact. Local provider in
    // staging → file:// URL, never a merge.
    const pr = await tracedPost<{ status: string; policyDecision: string }>(
      page.request,
      csrf,
      `/api/remediations/${planId}/create-pr`,
      {},
    );
    expect(pr.status).toBe(202);
    expect(pr.json.data?.status).toBe("QUEUED");
    let prUrl: string | null = null;
    await expect
      .poll(
        async () => {
          const detail = await tracedGet<{
            pullRequests?: Array<{ url?: string }>;
          }>(page.request, `/api/remediations/${planId}`);
          prUrl = detail.json.data?.pullRequests?.[0]?.url ?? null;
          return prUrl;
        },
        {
          timeout: 240_000,
          intervals: [5_000],
          message:
            "worker never recorded a draft PR — is the worker running and consuming CREATE_PR?",
        },
      )
      .not.toBeNull();
    expect(prUrl ?? "").toMatch(/^file:\/\//);

    // Signed check_run ingestion (fail-closed: unknown PR is ignored, 200).
    const checkBody = JSON.stringify({
      action: "completed",
      repository: { id: 424242 },
      check_run: {
        id: 900001,
        head_sha: "abc123def456",
        name: "ci / e2e",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/e2e/repo/runs/900001",
      },
      pull_requests: [{ number: 424242 }],
    });
    const checkDelivery = `e2e-check-${CID}`;
    const checkRes = await page.request.post("/api/webhooks/github", {
      headers: {
        ...signWebhook(checkBody, checkDelivery),
        "x-github-event": "check_run",
        "x-correlation-id": CID,
      },
      data: JSON.parse(checkBody) as Record<string, unknown>,
    });
    expect(checkRes.status()).toBe(200);
    const checkJson = (await checkRes.json()) as ApiEnvelope;
    expect(checkJson.correlationId).toBe(CID);

    // Duplicate delivery of the SAME check_run → deduped, single receipt.
    const checkDup = await page.request.post("/api/webhooks/github", {
      headers: {
        ...signWebhook(checkBody, checkDelivery),
        "x-github-event": "check_run",
        "x-correlation-id": CID,
      },
      data: JSON.parse(checkBody) as Record<string, unknown>,
    });
    const checkDupJson = (await checkDup.json()) as ApiEnvelope<{ duplicate?: boolean }>;
    expect(checkDup.status()).toBe(200);
    expect(checkDupJson.data?.duplicate).toBe(true);

    // Invalid signature → 401, nothing ingested.
    const badSig = await page.request.post("/api/webhooks/github", {
      headers: {
        "content-type": "application/json",
        "x-github-delivery": `e2e-bad-${CID}`,
        "x-github-event": "check_run",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-correlation-id": CID,
      },
      data: JSON.parse(checkBody) as Record<string, unknown>,
    });
    expect(badSig.status()).toBe(401);

    // Permission-denied: logged-out caller cannot touch the maintenance API…
    const anon = await browser.newContext({ baseURL: BASE_URL });
    const anonCases = await anon.request.get("/api/maintenance/cases", {
      headers: { "x-correlation-id": CID },
    });
    expect(anonCases.status()).toBe(401);
    await anon.close();

    // …and a VIEWER cannot hit MEMBER+ mutations (RBAC, distinct from auth).
    const viewerContext = await browser.newContext({ baseURL: BASE_URL });
    const viewerPage = await viewerContext.newPage();
    await loginAs(viewerPage, VIEWER_EMAIL, DEMO_PASSWORD, "viewer");
    const viewerCsrf = await csrfHeaders(viewerPage);
    const viewerValidate = await tracedPost(
      viewerPage.request,
      viewerCsrf,
      `/api/remediations/${planId}/validate`,
      {},
    );
    expect(viewerValidate.status).toBe(403);
    await viewerContext.close();

    // Audit evidence: the export must contain OUR correlation ID, proving
    // every traced action above landed in the WORM trail.
    const exported = await page.request.get(
      `/api/audit/export?format=json&limit=1000&since=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`,
      { headers: { "x-correlation-id": CID } },
    );
    expect(exported.status()).toBe(200);
    const exportText = await exported.text();
    expect(
      exportText.includes(CID),
      "audit export must contain the golden-path correlation ID",
    ).toBe(true);

    // Dashboard states: queue renders, case visible, audit trail visible.
    await page.goto("/cases");
    await expect(page.getByRole("heading", { name: "Remediation cases" })).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(`/remediations/${planId}`);
    await expect(page.getByText("PR_CREATED", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible({
      timeout: 30_000,
    });
    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "Immutable Audit Log" })).toBeVisible({
      timeout: 30_000,
    });

    expect(assessed).not.toEqual([]);
  });
});
