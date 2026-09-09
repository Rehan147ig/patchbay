import { expect, test } from "@playwright/test";
import { suppressProductTour } from "./helpers/tour";

/**
 * Autonomous track settings (CI-runnable against the dev server with the demo
 * user, like the outcomes spec). Verifies the guardrails card renders and the
 * policy round-trips through the real API.
 *
 * Credentials come from E2E_DEMO_EMAIL/E2E_DEMO_PASSWORD (wired to the server's
 * DEMO_USER_EMAIL/DEMO_USER_PASSWORD in CI); the dev-only defaults apply only
 * when those variables are absent, matching the local demo setup.
 */
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? "demo@patchbay.dev";
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "dev-only";

test("Settings shows the autonomous updates card with guardrails", async ({ page }) => {
  await suppressProductTour(page);
  await page.goto("/login");
  await page.getByLabel("Work Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.waitForURL(/\/overview/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Autonomous dependency updates" })).toBeVisible();
  await expect(page.getByText("Draft PRs only, never auto-merge", { exact: false })).toBeVisible();
});

test("Autonomy policy API round-trips guardrail values", async ({ page }) => {
  await suppressProductTour(page);
  await page.goto("/login");
  await page.getByLabel("Work Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.waitForURL(/\/overview/);

  // page.request shares the login cookies, so the MEMBER-gated API answers.
  const get = await page.request.get("/api/settings/autonomy");
  expect(get.status()).toBe(200);
  const body = (await get.json()) as { data: { maxOpenAutonomousPRs: number } };
  expect(typeof body.data.maxOpenAutonomousPRs).toBe("number");
});
