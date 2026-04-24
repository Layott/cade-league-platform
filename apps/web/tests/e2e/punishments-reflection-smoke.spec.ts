import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

test("admin + public punishments pages render rows (post Plan 39 RLS fix)", async ({
  page,
}) => {
  // Public /punishments does NOT require auth. Confirm rows render.
  await page.goto("/punishments");
  await expect(page.getByText("Sanctions Register")).toBeVisible();
  // Counter in top-right shows "Active cases" + numeric value; be permissive
  // about exact count so this spec stays green as admins issue new
  // punishments, but it MUST be > 0 — that's the reflection regression.
  const countText = await page
    .locator('[aria-label="Active cases"], :has-text("Active cases")')
    .first()
    .innerText()
    .catch(() => "");
  // Look at the number of <li> cards instead — more robust.
  const cards = await page
    .getByTestId("public-punishments-list")
    .locator("li")
    .count();
  console.log(`public-list cards=${cards}, counter text="${countText}"`);
  expect(cards).toBeGreaterThan(0);

  // Admin page — log in as admin first.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Continue/i }).click();
  // Give the login redirect time to settle.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15000,
  });

  await page.goto("/admin/punishments");
  await expect(
    page.getByRole("heading", { name: "Punishments" }),
  ).toBeVisible();
  // DataTable renders rows with testId; assert > 0 rows.
  const adminRows = await page
    .getByTestId("punishments-table")
    .locator("tbody tr")
    .count();
  console.log(`admin-list rows=${adminRows}`);
  expect(adminRows).toBeGreaterThan(0);

  // Sanity: pick the first View link + open detail — confirms service-role
  // read path works on [id] page too + the Edit form renders.
  const firstView = page.getByRole("link", { name: "View" }).first();
  await firstView.click();
  await expect(page.getByText("Edit punishment")).toBeVisible();
});
