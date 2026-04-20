import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

test("admin can log in and reach /admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByTestId("admin-home")).toBeVisible();
});

test("wrong password shows error and does not navigate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-error")).toBeVisible();
});

test("unauthenticated visitor is redirected from /admin to /login", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
