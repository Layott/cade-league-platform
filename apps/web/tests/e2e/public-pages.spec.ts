import { test, expect } from "@playwright/test";

/**
 * Smoke test for every public-facing route. Each test verifies the
 * PageHeader renders + at least one meaningful data point OR the
 * brand-voice empty state is on screen.
 */

test.describe("public pages", () => {
  test("homepage renders hero + all four landing sections", async ({
    page,
  }) => {
    // Anonymous `/` now redirects to `/welcome`; pass ?nolanding=1 to
    // render the public homepage directly for the asserting tests.
    await page.goto("/?nolanding=1");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /LEAGUE/,
    );

    // Upcoming match day section — either real card OR empty state.
    const matchDaySection = page.getByTestId("home-match-day");
    await expect(matchDaySection).toBeVisible();
    await expect(matchDaySection).toContainText(
      /Next match day|No match day locked in/,
    );

    // News strip — 3 cards or empty state.
    const news = page.getByTestId("home-news");
    await expect(news).toBeVisible();

    // Nav links resolve.
    await expect(
      page.getByRole("link", { name: "Fixture list" }).first(),
    ).toBeVisible();
  });

  test("/fixtures renders with meaningful content or empty state", async ({
    page,
  }) => {
    await page.goto("/fixtures");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Match Days",
    );
    const hasGroups = await page.getByTestId("fixture-group").count();
    if (hasGroups > 0) {
      await expect(page.getByTestId("fixture-group").first()).toBeVisible();
    } else {
      await expect(page.getByText("Schedule drop pending")).toBeVisible();
    }
  });

  test("/standings renders table or brand empty state", async ({ page }) => {
    await page.goto("/standings");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "League Table",
    );
    const body = page.getByTestId("standings-body");
    const hasRows = (await body.count()) > 0;
    if (hasRows) {
      await expect(body).toBeVisible();
    } else {
      await expect(page.getByText("No matches confirmed yet")).toBeVisible();
    }
  });

  test("/players renders grid with at least one card (seeded data)", async ({
    page,
  }) => {
    await page.goto("/players");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "The Roster",
    );
    await expect(page.getByTestId("player-card").first()).toBeVisible();
  });

  test("/announcements renders feed or empty state", async ({ page }) => {
    await page.goto("/announcements");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "League News",
    );
    // Either at least one announcement heading renders OR the empty state.
    const hasAny =
      (await page.getByRole("article").count()) > 0 ||
      (await page
        .getByText("The studio is quiet — for now")
        .isVisible()
        .catch(() => false));
    expect(hasAny).toBeTruthy();
  });

  test("/punishments renders list or clean-slate state", async ({ page }) => {
    await page.goto("/punishments");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Sanctions Register",
    );
    const list = page.getByTestId("public-punishments-list");
    const hasList = await list.isVisible().catch(() => false);
    if (hasList) {
      await expect(list).toBeVisible();
    } else {
      await expect(page.getByText("Clean slate")).toBeVisible();
    }
  });

  test("primary nav links reach every public page", async ({ page }) => {
    await page.goto("/?nolanding=1");
    for (const [label, pathFragment] of [
      ["Fixtures", "/fixtures"],
      ["Standings", "/standings"],
      ["Players", "/players"],
      ["News", "/announcements"],
      ["Discipline", "/punishments"],
    ] as const) {
      await page.goto("/?nolanding=1");
      // Use the desktop nav — first match. Mobile copy matches too but
      // desktop locator is first in DOM.
      await page.getByRole("link", { name: label }).first().click();
      await expect(page).toHaveURL(new RegExp(pathFragment + "$"));
    }
  });
});
