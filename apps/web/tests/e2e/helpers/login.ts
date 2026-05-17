import type { Page } from "@playwright/test";

export const ADMIN_EMAIL = "admin@cade.local";
export const ADMIN_PASSWORD = "dev-admin-2026";

/**
 * Log in as the seeded admin user and wait for redirect to /admin.
 * Reusable across all admin-flow specs.
 *
 * Uses the data-testid="login-password-input" selector to avoid the
 * strict-mode collision introduced by the show/hide password toggle
 * (see tasks/lessons.md — login spec password selector).
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.locator('[data-testid="login-password-input"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Continue/i }).click();
  // Cold-start dev server can take >5s for auth round-trip + first admin shell
  // paint. Use generous timeout to prevent flakes.
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}
