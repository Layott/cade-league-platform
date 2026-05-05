import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the public sub-standings routes:
 *   /standings                              -> Overall
 *   /standings/matchday/[n]                 -> cumulative through MD n
 *   /standings/matchday/[n]/match/[matchId] -> cumulative through specific match
 *
 * The live cloud DB is seeded with the Elite 2025-2026 season + confirmed
 * match_results, so every assertion below expects real rows.
 */

test.describe("public sub-standings routes", () => {
  test("/standings shows MD picker with Overall + at least one MD chip", async ({
    page,
  }) => {
    await page.goto("/standings");
    const picker = page.getByTestId("md-picker");
    await expect(picker).toBeVisible();

    const overall = picker.getByRole("link", { name: "Overall" });
    await expect(overall).toBeVisible();
    // Active styling: text colour token. Fall back to text match if class
    // changes — `Overall` is the unambiguous label for the active chip.
    await expect(overall).toHaveClass(/text-\[var\(--signal\)\]/);

    // At least one MD chip rendered next to "Overall".
    const mdChips = picker.getByRole("link", { name: /^MD \d+/ });
    expect(await mdChips.count()).toBeGreaterThan(0);
  });

  test("MD picker navigates to /standings/matchday/1", async ({ page }) => {
    await page.goto("/standings");
    const md1 = page
      .getByTestId("md-picker")
      .locator('a[href="/standings/matchday/1"]');
    await md1.click();
    await expect(page).toHaveURL(/\/standings\/matchday\/1$/);
    await expect(page.getByTestId("standings-table")).toBeVisible();
  });

  test("/standings/matchday/1 renders standings table with rows", async ({
    page,
  }) => {
    await page.goto("/standings/matchday/1");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(/Standings/);
    await expect(heading).toContainText(/MD 1/);

    await expect(page.getByTestId("standings-table")).toBeVisible();
    const rows = page.locator('[data-testid="standings-table"] tbody tr');
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test("/standings/matchday/1 has match cutoff picker", async ({ page }) => {
    await page.goto("/standings/matchday/1");
    // Build agent will add data-testid="match-picker" on the MatchPicker
    // wrapper; this spec depends on that. Fallback: any link whose text
    // starts with "M1:" / "M 1:" inside the page body.
    const matchPicker = page.getByTestId("match-picker");
    await expect(matchPicker).toBeVisible();
    const chips = matchPicker.getByRole("link");
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test("/standings/matchday/1/match/[id] resolves and renders", async ({
    page,
  }) => {
    await page.goto("/standings/matchday/1");
    // Skip the "End of MD" link (href === current page); click first link
    // whose href contains `/match/`.
    const firstMatchChip = page
      .getByTestId("match-picker")
      .locator('a[href*="/match/"]')
      .first();
    await firstMatchChip.click();
    await expect(page).toHaveURL(
      /\/standings\/matchday\/1\/match\/[0-9a-f-]{36}$/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Standings.*MD 1.*Match/,
    );
    await expect(page.getByTestId("standings-table")).toBeVisible();
  });

  test("scope toggle switches between cumulative + MD-only", async ({
    page,
  }) => {
    await page.goto("/standings/matchday/1");
    const toggle = page.getByTestId("scope-toggle");
    await expect(toggle).toBeVisible();

    const cumulative = page.getByTestId("scope-cumulative");
    const onlyTab = page.getByTestId("scope-md-only");
    await expect(cumulative).toHaveAttribute("aria-selected", "true");
    await expect(onlyTab).toHaveAttribute("aria-selected", "false");

    await onlyTab.click();
    await expect(page).toHaveURL(/\/standings\/matchday\/1\?view=md-only$/);
    await expect(page.getByTestId("scope-md-only")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Match-picker hides on md-only scope (cumulative-only feature).
    await expect(page.getByTestId("match-picker")).toHaveCount(0);
    await expect(page.getByTestId("standings-table")).toBeVisible();
  });

  test("scope toggle exposes Week Only pill that navigates to ?view=week-only", async ({
    page,
  }) => {
    await page.goto("/standings/matchday/1");
    const weekTab = page.getByTestId("scope-week-only");
    await expect(weekTab).toBeVisible();
    await expect(weekTab).toHaveAttribute("aria-selected", "false");

    await weekTab.click();
    await expect(page).toHaveURL(/\/standings\/matchday\/1\?view=week-only$/);
    await expect(page.getByTestId("scope-week-only")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Match-picker hidden on week-only too (only meaningful in cumulative scope).
    await expect(page.getByTestId("match-picker")).toHaveCount(0);
    await expect(page.getByTestId("standings-table")).toBeVisible();
  });

  test("invalid matchday number 404s", async ({ page }) => {
    const res = await page.goto("/standings/matchday/999");
    // Either Next returns a 404 status OR the default not-found body.
    if (res && res.status() === 404) {
      expect(res.status()).toBe(404);
      return;
    }
    await expect(
      page.getByText(/404|This page could not be found/i).first(),
    ).toBeVisible();
  });
});
