import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

const RARITIES = [
  "gold",
  "silver",
  "bronze",
  "totw",
  "hero",
  "icon",
  "cade-special",
] as const;

// 13 real CADE players (slug + display name) — slugs come straight from
// KNOWLEDGE/brand-assets/players/processed/manifest.json. The storybook
// renders these via getPlayerDisplayName.
const REAL_PLAYERS = [
  "Adefola",
  "Anife",
  "Baji Jnr",
  "Dadaboi",
  "Faruk",
  "Guru",
  "Kaykay",
  "Killer Freak",
  "Kingnonex",
  "Mitch",
  "Mr Oga",
  "Tactical",
  "Wolevation",
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.setTimeout(60_000);

test("cade-player-card storybook renders 7 rarities + 13 real players + a rating chip", async ({
  page,
}) => {
  await login(page);
  await page.goto("/overlay/storybook/cade-player-card");

  await expect(page.getByTestId("cade-card-storybook-root")).toBeVisible();

  // Each rarity has a tag heading.
  for (const r of RARITIES) {
    await expect(page.getByTestId(`rarity-tag-${r}`)).toBeVisible();
  }

  // Each real player's display name is present at least once.
  for (const name of REAL_PLAYERS) {
    await expect(
      page.getByTestId("cade-card-storybook-root").getByText(name, {
        exact: false,
      }).first(),
    ).toBeVisible();
  }

  // At least one rating chip in the DOM.
  const ratingChips = page.getByTestId("cade-card-rating");
  expect(await ratingChips.count()).toBeGreaterThan(0);
});
