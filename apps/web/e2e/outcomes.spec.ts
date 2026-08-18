import { expect, test } from "@playwright/test";

/**
 * WP10 UI: the /outcomes dashboard and the Settings capability gates section
 * render with seeded (outcome-less) data — SLO cards, empty ledger, feedback
 * queue, and the gates card.
 */
test("Outcomes dashboard renders SLO cards and empty states", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as demo user" }).click();
  await page.waitForURL(/\/overview/);

  await page.goto("/outcomes");
  await expect(page.getByRole("heading", { name: "Outcomes" })).toBeVisible();

  await expect(page.getByText("PR merge rate", { exact: true })).toBeVisible();
  await expect(page.getByText("False positive rate", { exact: true })).toBeVisible();
  await expect(page.getByText("Detection latency", { exact: true })).toBeVisible();
  await expect(page.getByText("Cost per successful remediation", { exact: true })).toBeVisible();

  await expect(page.getByText("Nothing to classify")).toBeVisible();
  await expect(page.getByText("No outcomes yet")).toBeVisible();
});

test("Settings shows the capability gates card with no gates seeded", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as demo user" }).click();
  await page.waitForURL(/\/overview/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Capability gates" })).toBeVisible();
  await expect(page.getByText("No gates yet", { exact: false })).toBeVisible();
});
