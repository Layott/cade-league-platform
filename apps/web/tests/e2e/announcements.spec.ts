import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

test.describe("announcements happy path", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin/);
  });

  test("admin composes public announcement, publishes now, shows on /announcements", async ({
    page,
  }) => {
    const title = `E2E test ${Date.now()}`;
    await page.goto("/admin/announcements/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Body (markdown)").fill("# Heading\n\nHello **world**.");
    await page.getByLabel("Public").check();
    // audience_type stays on "All users"; channels in_app + email stay checked.
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page).toHaveURL(/\/admin\/announcements\/[0-9a-f-]+/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/Delivery: \d+ \/ \d+ read/)).toBeVisible();

    // Public feed reflects it (ISR — force-refresh).
    await page.goto("/announcements", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("cron route 403s without secret", async ({ request }) => {
    const r = await request.get("/api/cron/publish-announcements");
    expect(r.status()).toBe(403);
  });

  test("cron route 200s with correct secret", async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET env var required for this test");
    const r = await request.get("/api/cron/publish-announcements", {
      headers: { "X-Cron-Secret": secret! },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("processed");
  });
});
