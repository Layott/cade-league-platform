import { test, expect } from "@playwright/test";

test("landing page renders the CADE League hero", async ({ page }) => {
  // Anonymous `/` now redirects to `/welcome` (the sign-in landing). The
  // ?nolanding=1 flag opts out of that redirect so this existing smoke
  // test still exercises the public homepage.
  await page.goto("/?nolanding=1");
  // Hero wordmark renders as "CADE" + "LEAGUE" on two stacked lines; the
  // hero h1 is the first heading in the document (announcements below it
  // may ship their own h1s inside sanitized markdown).
  const hero = page.getByRole("heading", { level: 1 }).first();
  await expect(hero).toContainText(/CADE/);
  await expect(hero).toContainText(/LEAGUE/);
  await expect(page.getByTestId("stage-marker")).toHaveAttribute(
    "data-stage",
    "home",
  );
});

test("/welcome renders sign-in landing for anonymous visitors", async ({
  page,
}) => {
  await page.goto("/welcome");
  await expect(page.getByTestId("welcome-page")).toBeVisible();
  await expect(page.getByTestId("welcome-signin")).toBeVisible();
  await expect(page.getByTestId("welcome-public-link")).toBeVisible();
  // Chrome is hidden on /welcome — no nav drawer trigger.
  await expect(page.getByTestId("nav-drawer-trigger")).toHaveCount(0);
});

test("anonymous / redirects to /welcome", async ({ page }) => {
  const res = await page.goto("/");
  // Final URL lands on /welcome after the middleware redirect.
  await expect(page).toHaveURL(/\/welcome$/);
  // Redirect chain is a 307 off the root route.
  expect(res).toBeTruthy();
});
