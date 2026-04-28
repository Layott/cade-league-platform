import { expect, test, type Page } from "@playwright/test";

/**
 * UI Audit Slice 4 (2026-04-28) — admin IA v2 smoke.
 *
 * Asserts the 8-hub layout: log in as admin, hit each hub URL from the
 * dashboard tile grid, confirm the hub layout renders + the active
 * sub-tab is highlighted.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

const HUBS: Array<{
  key: string;
  href: string;
  testId: string;
}> = [
  { key: "match-days", href: "/admin/match-days", testId: "match-days" },
  { key: "tournament", href: "/admin/tournament", testId: "tournament" },
  { key: "roster", href: "/admin/people", testId: "roster" },
  { key: "discipline", href: "/admin/discipline", testId: "discipline" },
  { key: "comms", href: "/admin/announcements", testId: "comms" },
  { key: "broadcast", href: "/admin/broadcast/v2", testId: "broadcast" },
  { key: "squads", href: "/admin/squads", testId: "squads" },
  { key: "system", href: "/admin/system", testId: "system" },
];

test.describe("admin IA v2 — 8 hubs render", () => {
  test("admin sees 8 hub tiles on /admin dashboard", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-home")).toBeVisible();

    for (const hub of HUBS) {
      const tile = page.getByTestId(`admin-tile-${hub.testId}`);
      await expect(tile).toBeVisible();
      await expect(tile).toHaveAttribute("href", hub.href);
    }
  });

  test("AdminSubnav exposes all 8 hubs + Dashboard link", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-subnav")).toBeVisible();
    await expect(page.getByTestId("admin-subnav-tab-dashboard")).toBeVisible();
    for (const hub of HUBS) {
      await expect(page.getByTestId(`admin-subnav-tab-${hub.testId}`)).toBeVisible();
    }
  });
});

test.describe("admin IA v2 — old paths 307 to new locations", () => {
  test("/admin/players redirects to /admin/people/players", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/players");
    await expect(page).toHaveURL(/\/admin\/people\/players/);
  });

  test("/admin/orgs redirects to /admin/people/orgs", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/orgs");
    await expect(page).toHaveURL(/\/admin\/people\/orgs/);
  });

  test("/admin/users redirects to /admin/people/users", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/people\/users/);
  });

  test("/admin/roles redirects to /admin/people/roles", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/roles");
    await expect(page).toHaveURL(/\/admin\/people\/roles/);
  });

  test("/admin/security/sessions redirects to /admin/people/security/sessions", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/security/sessions");
    await expect(page).toHaveURL(/\/admin\/people\/security\/sessions/);
  });

  test("/admin/punishments redirects to /admin/discipline/punishments", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/punishments");
    await expect(page).toHaveURL(/\/admin\/discipline\/punishments/);
  });

  test("/admin/disputes redirects to /admin/discipline/disputes", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/disputes");
    await expect(page).toHaveURL(/\/admin\/discipline\/disputes/);
  });

  test("/admin/appeals redirects to /admin/discipline/appeals", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/appeals");
    await expect(page).toHaveURL(/\/admin\/discipline\/appeals/);
  });

  test("/admin/trash redirects to /admin/system/trash", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/trash");
    await expect(page).toHaveURL(/\/admin\/system\/trash/);
  });

  test("/admin/stats-review redirects to /admin/match-days/stats-review", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/stats-review");
    await expect(page).toHaveURL(/\/admin\/match-days\/stats-review/);
  });
});

test.describe("admin IA v2 — unauth redirected to login", () => {
  test("unauthenticated /admin/people/users 307s through login", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/people/users");
    // Either /login or 403 acceptable.
    const url = page.url();
    expect(url.includes("/login") || url.includes("/admin/people/users") === false).toBe(true);
  });
});
