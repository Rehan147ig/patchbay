import { expect, test } from "@playwright/test";

/**
 * Acceptance criterion 1 + Phase 7 E2E: OpenAI demo happy path runs the full
 * chain against a live stack — change event → analysis → plan → sandbox
 * validation → local draft PR — with the diff and validation view visible.
 */
test("OpenAI demo happy path ends in a stored draft PR", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as demo user" }).click();
  await page.waitForURL(/\/overview/);

  await page.goto("/demo");
  await page.getByRole("button", { name: "Run demo change" }).first().click();
  await page.waitForURL(/\/changes\/[a-z0-9-]+$/);

  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByText("ai-assistant-service").first()).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Generate plan" }).click();
  await page.waitForURL(/\/remediations\/[0-9a-f-]+$/);

  // Diff view: the plan page shows the patched call in the patch artifact
  await expect(page.getByText("openai.chat.completions.create").first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Run validation" }).click();
  // The plan page only refreshes once; the sandbox install can take a minute, so
  // poll with reloads until the worker settles the plan status.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("VALIDATED", { exact: true })).toBeVisible({ timeout: 60_000 });
  }).toPass({ timeout: 300_000 });

  await page.getByRole("button", { name: "Create Draft PR" }).click();
  await expect(page.getByText("PR_CREATED", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("text=/file:\\/\\//")).toBeVisible({ timeout: 60_000 });
});
