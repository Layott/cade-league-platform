import { test, expect } from "@playwright/test";

test("landing page renders and shows Phase 1A stage marker", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CADE League Platform" })).toBeVisible();
  await expect(page.getByTestId("stage-marker")).toHaveText("Phase 1A · Foundations");
});
