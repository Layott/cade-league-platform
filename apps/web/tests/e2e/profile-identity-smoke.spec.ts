import { test, expect } from "@playwright/test";

// Plan 40 + 41 smoke — post-bugfix verification.

test("admin sees UserBadge + reaches /profile without 500", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@cade.local");
  await page.getByLabel("Password").fill("dev-admin-2026");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
  // Badge rendered (not the Sign-in fallback).
  await expect(page.getByTestId("user-badge")).toBeVisible();
  await expect(page.getByTestId("user-badge-sign-in")).toHaveCount(0);
  // /profile loads clean.
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByText(/Your profile|admin/i).first()).toBeVisible();
});

test("player logs in and is redirected to /player (not 403)", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("faruk@cade.local");
  await page.getByLabel("Password").fill("cade-player-2026");
  await page.getByRole("button", { name: "Continue" }).click();
  // Landing is /player or /profile (role-aware redirect) — not 403.
  await page.waitForLoadState("networkidle");
  const url = page.url();
  expect(url).toMatch(/\/(player|profile)/);
  // UserBadge rendered (not Sign-in fallback).
  await expect(page.getByTestId("user-badge")).toBeVisible();
  await expect(page.getByTestId("user-badge-sign-in")).toHaveCount(0);
});

test("announcement modal opens at a reasonable size (not clipped)", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@cade.local");
  await page.getByLabel("Password").fill("dev-admin-2026");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);

  await page.getByTestId("announcement-bell").click();
  const modal = page.getByTestId("announcements-modal");
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  // min-h-[500px] per modal styles — must be at least 450 px tall to
  // rule out the "small rectangle" bug.
  expect(box!.height).toBeGreaterThanOrEqual(450);
  // Title inside the modal is visible (top not clipped).
  await expect(page.locator("#announcements-title")).toBeVisible();
});
