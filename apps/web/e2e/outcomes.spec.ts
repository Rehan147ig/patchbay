import { expect, test } from "@playwright/test";
import { suppressProductTour } from "./helpers/tour";

/**
 * WP10 UI: the /outcomes dashboard and the Settings capability gates section
 * render with the seeded ledger data — SLO cards, outcome ledger rows,
 * feedback queue, and the gates table (seed: 13 classified outcomes, 6 ACTIVE
 * + 1 SUSPENDED gates).
 *
 * Credentials come from E2E_DEMO_EMAIL/E2E_DEMO_PASSWORD (wired to the server's
 * DEMO_USER_EMAIL/DEMO_USER_PASSWORD in CI); the dev-only defaults apply only
 * when those variables are absent, matching the local demo setup.
 */
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? "demo@patchbay.dev";
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "dev-only";

test("Outcomes dashboard renders SLO cards and empty states", async ({ page }) => {
  await suppressProductTour(page);
  await page.goto("/login");
  await page.getByLabel("Work Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.waitForURL(/\/overview/);

  await page.goto("/outcomes");
  await expect(page.getByRole("heading", { name: "Outcomes" })).toBeVisible();

  await expect(page.getByText("PR merge rate", { exact: true })).toBeVisible();
  await expect(page.getByText("False positive rate", { exact: true })).toBeVisible();
  await expect(page.getByText("Detection latency", { exact: true })).toBeVisible();
  await expect(page.getByText("Cost per successful remediation", { exact: true })).toBeVisible();

  // Seeded ledger: the merge-rate signal, feedback queue, outcome ledger, and
  // at least one seeded outcome row (branch link text) must render.
  await expect(page.getByText("Feedback queue", { exact: true })).toBeVisible();
  await expect(page.getByText("Outcome ledger", { exact: true })).toBeVisible();
  await expect(page.getByText(/outcomes in the window/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Vendor" })).toBeVisible();
  await expect(page.getByText("patchbay/seed-stripe-metadata")).toBeVisible();
});

test("Settings shows the capability gates card with no gates seeded", async ({ page }) => {
  await suppressProductTour(page);
  await page.goto("/login");
  await page.getByLabel("Work Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.waitForURL(/\/overview/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Capability gates" })).toBeVisible();
  // Seeded gates (6 ACTIVE + 1 SUSPENDED): the table and both status pills render.
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(page.getByText("active", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("suspended", { exact: true }).first()).toBeVisible();
});
