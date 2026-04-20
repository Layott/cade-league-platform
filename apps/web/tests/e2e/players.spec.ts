import { test, expect } from "@playwright/test";

test("/players shows a grid of player cards", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "The Roster",
  );
  const cards = page.getByTestId("player-card");
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test("/players/[id] opens a profile and back-link returns", async ({ page }) => {
  await page.goto("/players");
  const first = page.getByTestId("player-card").first();
  await first.click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /Back to roster/i }).click();
  await expect(page).toHaveURL(/\/players$/);
});
