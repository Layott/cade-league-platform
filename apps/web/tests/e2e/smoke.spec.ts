import { test, expect } from "@playwright/test";

test("landing page renders the CADE League hero", async ({ page }) => {
  await page.goto("/");
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
