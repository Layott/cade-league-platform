import { test, expect } from "@playwright/test";
import { seedWave3aSequenceFixture } from "./helpers/seed-sequence-fixture";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3030";

test.describe("Visual regression — Wave 3A sequence midpoint", () => {
  test("scene 2 active state matches baseline (<0.1% pixel diff)", async ({ page }) => {
    const fixture = await seedWave3aSequenceFixture();
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`${BASE_URL}/overlay/v2/user/${fixture.slug}`);
      await page.evaluate(() => window.postMessage({ type: "show" }, "*"));
      await page.waitForFunction(
        (id) => document.querySelector(`[data-scene-id="${id}"]`)?.getAttribute("data-scene-state") === "active",
        fixture.sceneIds[1],
        { timeout: 5000 },
      );
      await page.waitForTimeout(200);
      expect(await page.screenshot({ fullPage: true })).toMatchSnapshot(
        "wave-3a-sequence-scene-2.png",
        { maxDiffPixelRatio: 0.001 },
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
