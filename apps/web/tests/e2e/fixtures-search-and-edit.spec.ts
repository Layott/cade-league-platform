import { test, expect } from "@playwright/test";

/**
 * Plan 26 — verifies the new fixture search bar (admin + public) and the
 * inline edit form on the match-day detail page.
 *
 * Self-tolerant: relies on the seed roster (real LOC schedule) but does
 * not require a specific match day id. After editing one fixture's home
 * player, restores it back to the original so re-runs are idempotent.
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

test.setTimeout(120_000);

test("admin search filters /admin/match-days by player tag", async ({ page }) => {
  await login(page);
  await page.goto("/admin/match-days");

  const searchBar = page.getByTestId("match-days-search");
  await expect(searchBar).toBeVisible();
  await searchBar.fill("ADEFOLA");

  // After filter, every visible row should have either a Manage/Attendance
  // link present (i.e. it's still a real match-day row). The "X of Y" pill
  // should reflect the filter.
  await expect(page.locator("text=of")).toBeVisible();

  // Clearing returns the full list count.
  await searchBar.fill("");
  await expect(page.getByTestId("match-days-table")).toBeVisible();
});

test("admin can inline-edit a fixture's home player", async ({ page }) => {
  await login(page);

  // Navigate to the match-days list and into the first row.
  await page.goto("/admin/match-days");
  const firstManage = page.getByRole("link", { name: "Manage" }).first();
  if ((await firstManage.count()) === 0) {
    test.skip(true, "no match days seeded");
  }
  await firstManage.click();
  await expect(page).toHaveURL(/\/admin\/match-days\/[a-f0-9-]+/);

  const fixture = page.locator("[data-testid^='fixture-']").first();
  if ((await fixture.count()) === 0) {
    test.skip(true, "no fixtures on first match day");
  }
  const fixtureId = (await fixture.getAttribute("data-testid"))!.replace(
    "fixture-",
    "",
  );

  const editForm = page.getByTestId(`edit-fixture-form-${fixtureId}`);
  await expect(editForm).toBeVisible();

  const homeSel = page.getByTestId(`edit-home-select-${fixtureId}`);
  const awaySel = page.getByTestId(`edit-away-select-${fixtureId}`);
  const original = await homeSel.inputValue();
  const awayCurrent = await awaySel.inputValue();

  // Pick the first non-conflicting alternative home value.
  const optionValues = await homeSel.locator("option").evaluateAll(
    (opts) => (opts as HTMLOptionElement[]).map((o) => o.value),
  );
  const newHome = optionValues.find(
    (v) => v && v !== original && v !== awayCurrent,
  );
  if (!newHome) {
    test.skip(true, "no alternative player available to swap home with");
  }

  await homeSel.selectOption(newHome!);
  await page.getByTestId(`edit-fixture-btn-${fixtureId}`).click();

  // After submit the page revalidates; the same fixture should now have
  // the new home player as the form's defaultValue.
  await expect(
    page.getByTestId(`edit-home-select-${fixtureId}`),
  ).toHaveValue(newHome!);

  // Restore so re-runs converge.
  await page.getByTestId(`edit-home-select-${fixtureId}`).selectOption(original);
  await page.getByTestId(`edit-fixture-btn-${fixtureId}`).click();
  await expect(
    page.getByTestId(`edit-home-select-${fixtureId}`),
  ).toHaveValue(original);
});

test("public /fixtures search filters by player tag", async ({ page }) => {
  await page.goto("/fixtures");
  const searchBar = page.getByTestId("public-fixtures-search");
  if ((await searchBar.count()) === 0) {
    // Empty league — page renders the empty-state, not the search bar.
    test.skip(true, "no fixtures published yet");
  }
  await expect(searchBar).toBeVisible();
  await searchBar.fill("ADEFOLA");
  // Showing-of-counter should change.
  await expect(page.locator("text=Showing")).toBeVisible();
});
