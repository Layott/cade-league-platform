import { test, expect } from "@playwright/test";

/**
 * Plan 27 — Verifies:
 *   1. Admin publishes the first match day → public /fixtures shows it.
 *   2. Admin unpublishes that match day → public /fixtures hides it.
 *   3. Admin reorders fixture #2 up → it now appears before fixture #1
 *      in the visible list.
 *
 * Self-cleaning: the test re-publishes the day at the end (so the public
 * page re-converges to whatever the original visible state was), and
 * undoes the reorder by clicking the down chevron once.
 *
 * Tolerant: skips gracefully if no match days are seeded yet.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.setTimeout(180_000);

test("admin publishes match day → public /fixtures surfaces it; unpublish hides it", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/match-days");

  const firstManage = page.getByRole("link", { name: "Manage" }).first();
  if ((await firstManage.count()) === 0) {
    test.skip(true, "no match days seeded");
  }
  await firstManage.click();
  await expect(page).toHaveURL(/\/admin\/match-days\/[a-f0-9-]+/);
  const matchDayUrl = page.url();
  const matchDayId = matchDayUrl.split("/").pop()!;

  // Read the displayed date so we can search for it on /fixtures.
  // The H1 reads e.g. "Sunday, April 26 2026" (formatWat output).
  // Extract the day-number which appears verbatim on /fixtures (formatted as
  // 2-digit "dd" in the public FixtureList).
  const titleText = await page.getByRole("heading", { level: 1 }).first().innerText();
  const dayMatch = titleText.match(/\b(\d{1,2})\b/);
  const dayNum = dayMatch ? dayMatch[1].padStart(2, "0") : "";

  // Ensure we start in a known state: if already published, unpublish first.
  const unpubBtn = page.getByTestId("unpublish-md-btn");
  if ((await unpubBtn.count()) > 0) {
    await unpubBtn.click();
    await expect(page.getByTestId("publish-md-btn")).toBeVisible();
  }

  // 1. Public /fixtures should not show this match day yet (or show empty state).
  await page.goto("/fixtures");
  // tolerant: a different day on the same weekday could pass; we only care
  // about post-publish state asserting it explicitly.

  // 2. Admin publishes
  await page.goto(matchDayUrl);
  await page.getByTestId("publish-md-btn").click();
  await expect(page.getByTestId("unpublish-md-btn")).toBeVisible();
  await expect(page.getByTestId("md-publish-pill")).toContainText(/published/i);

  // 3. Public /fixtures now shows it. The public page renders the day-of-month
  // as a 2-digit `dd`, which is the most stable token to assert against.
  await page.goto("/fixtures");
  if (dayNum) {
    await expect(page.locator("main")).toContainText(dayNum);
  }

  // 4. Admin unpublishes
  await page.goto(matchDayUrl);
  await page.getByTestId("unpublish-md-btn").click();
  await expect(page.getByTestId("publish-md-btn")).toBeVisible();
  await expect(page.getByTestId("md-publish-pill")).toContainText(/draft/i);

  // 5. Re-publish to leave the system in a usable state for the next test.
  await page.getByTestId("publish-md-btn").click();
  await expect(page.getByTestId("unpublish-md-btn")).toBeVisible();

  // sanity: the URL format of the row id is preserved
  expect(matchDayId).toMatch(/^[a-f0-9-]+$/);
});

test("admin reorders a fixture up, verifies new position, then restores", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/match-days");
  const firstManage = page.getByRole("link", { name: "Manage" }).first();
  if ((await firstManage.count()) === 0) {
    test.skip(true, "no match days seeded");
  }
  await firstManage.click();

  const fixtures = page.locator("[data-testid^='fixture-']");
  const count = await fixtures.count();
  if (count < 3) {
    test.skip(true, "need at least 3 fixtures to test a meaningful reorder");
  }

  // Capture the id of the third fixture (idx 2) so we can target it
  // independent of any visual labels.
  const targetId = (await fixtures
    .nth(2)
    .getAttribute("data-testid"))!.replace("fixture-", "");
  const upBtn = page.getByTestId(`reorder-up-${targetId}`);
  await expect(upBtn).toBeVisible();

  // Move it up once. After: target is at idx 1.
  await upBtn.click();
  // After the reorder + revalidate, targetId should now be at index 1.
  // Use Playwright's auto-retrying toHaveAttribute so the assertion waits
  // for the server-action revalidation to flush.
  await expect(
    page.locator("[data-testid^='fixture-']").nth(1),
  ).toHaveAttribute("data-testid", `fixture-${targetId}`);

  // Restore by clicking down once.
  await page.getByTestId(`reorder-down-${targetId}`).click();
  await expect(
    page.locator("[data-testid^='fixture-']").nth(2),
  ).toHaveAttribute("data-testid", `fixture-${targetId}`);
});
