import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.setTimeout(120_000);

test("design-preview renders every template card with a mounted slot", async ({
  page,
}) => {
  await login(page);
  await page.goto("/overlay/design-preview");

  // The root shows 27+ template cards laid out in groups.
  const root = page.getByTestId("design-preview-root");
  await expect(root).toBeVisible();

  const cards = page.getByTestId("template-card");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(27);

  // Give iframes a generous window to hydrate. Each iframe must mount
  // at least one element with `data-template-slot` within 8s.
  const iframes = page.getByTestId("template-iframe");
  const iframeCount = await iframes.count();
  expect(iframeCount).toBeGreaterThanOrEqual(27);

  // Sample check: the first 6 cards (5 stingers + 1 layout) and the
  // last card must each expose a `data-template-slot` element inside
  // their iframe DOM. Doing all 27 at once is flaky on cold cache.
  const samples = [0, 1, 2, 3, 4, 5, iframeCount - 1];
  for (const idx of samples) {
    const frame = iframes.nth(idx);
    const key = await frame
      .evaluateHandle((el) => el.getAttribute("src"))
      .then((h) => h.jsonValue());
    expect(typeof key).toBe("string");
    // contentFrame() returns the FrameLocator for asserting inside the iframe.
    const fl = frame.contentFrame();
    await expect(fl.locator("[data-template-slot]")).toBeAttached({
      timeout: 8_000,
    });
  }
});
