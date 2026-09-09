import type { Page } from "@playwright/test";

/**
 * Test-only product-tour suppression.
 *
 * The dashboard layout auto-starts the Driver.js tour ~1.2s after first load
 * (viewport >= 1024px) whenever `localStorage.patchbay_tour_completed` is
 * unset, and its full-screen overlay intercepts pointer events — including
 * E2E clicks. This helper drives the SAME supported browser state the UI
 * uses (no flags, bypasses, or production changes):
 *
 * 1. Seed the completion flag before page scripts run, so the tour never
 *    starts on subsequent documents (the UI's own `onDestroyed` writes this
 *    exact key when a real user finishes/closes the tour).
 * 2. If the overlay already started on the current document, dismiss it the
 *    way a user would (Escape; `allowClose` is enabled), which persists the
 *    flag honestly through `onDestroyed`.
 *
 * Real-user tour behavior is untouched: fresh profiles without the flag still
 * get the tour, and the "Take a tour" button still starts it on demand.
 */
export async function suppressProductTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("patchbay_tour_completed", "true");
    } catch {
      // Storage unavailable (private mode): fall through to Escape dismissal.
    }
  });
  const overlay = page.locator(".driver-overlay");
  if ((await overlay.count()) > 0) {
    await page.keyboard.press("Escape");
    await overlay
      .first()
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {
        // Overlay already gone or never attached: nothing to dismiss.
      });
  }
}
