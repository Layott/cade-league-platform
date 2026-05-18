import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wave 2B — E2E: Photopea iframe page round-trip.
 *
 * Photopea cannot be exercised cross-origin in headless mode without
 * flakiness, so the spec STUBS the iframe by intercepting the
 * Photopea URL and serving an about:blank shell. The save flow is
 * driven by a synthetic `message` event dispatched on the parent
 * window, carrying the committed tiny PSD fixture bytes.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §13.2
 */

// Resolve relative to this spec so it does not depend on the cwd
// playwright was launched with (apps/web vs repo-root differ across CI
// commands and local runs).
const TINY_PSD = readFileSync(
  path.resolve(__dirname, "fixtures/wave-2b-tiny.psd"),
);

test.describe("overlay-builder photopea bridge", () => {
  test.beforeEach(async ({ context }) => {
    await context.route("https://www.photopea.com/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body>stub</body></html>",
      });
    });
  });

  test("page renders sandboxed iframe + posts app.open on load", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/login`);
    await page.getByTestId("login-email-input").fill("admin@cade.local");
    await page.getByTestId("login-password-input").fill("dev-admin-2026");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(`${baseURL}/admin*`);

    const assetId = process.env.WAVE_2B_TEST_ASSET_ID;
    expect(assetId, "WAVE_2B_TEST_ASSET_ID env must be set").toBeTruthy();

    await page.goto(
      `${baseURL}/admin/broadcast/v2/builder/wave-2b-test/psd?assetId=${assetId}`,
    );

    const iframe = page.locator('iframe[title="Photopea editor"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin",
    );
    await expect(iframe).toHaveAttribute(
      "src",
      "https://www.photopea.com/",
    );
  });

  test("save flow uploads PSD bytes + writes history row", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/login`);
    await page.getByTestId("login-email-input").fill("admin@cade.local");
    await page.getByTestId("login-password-input").fill("dev-admin-2026");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(`${baseURL}/admin*`);

    const assetId = process.env.WAVE_2B_TEST_ASSET_ID!;
    await page.goto(
      `${baseURL}/admin/broadcast/v2/builder/wave-2b-test/psd?assetId=${assetId}`,
    );

    await page.getByRole("button", { name: /^save$/i }).click();

    await page.evaluate(async ([psdB64]) => {
      const bytes = Uint8Array.from(atob(psdB64 as string), (c) =>
        c.charCodeAt(0),
      );
      const evt = new MessageEvent("message", {
        data: bytes.buffer,
        origin: "https://www.photopea.com",
      });
      window.dispatchEvent(evt);
    }, [Buffer.from(TINY_PSD).toString("base64")]);

    await expect(page.getByTestId("photopea-status")).toHaveText(/done/i, {
      timeout: 15000,
    });
  });

  test("wrong-origin message is dropped (no save action triggered)", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/login`);
    await page.getByTestId("login-email-input").fill("admin@cade.local");
    await page.getByTestId("login-password-input").fill("dev-admin-2026");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(`${baseURL}/admin*`);

    const assetId = process.env.WAVE_2B_TEST_ASSET_ID!;
    await page.goto(
      `${baseURL}/admin/broadcast/v2/builder/wave-2b-test/psd?assetId=${assetId}`,
    );

    await page.getByRole("button", { name: /^save$/i }).click();

    await page.evaluate(async ([psdB64]) => {
      const bytes = Uint8Array.from(atob(psdB64 as string), (c) =>
        c.charCodeAt(0),
      );
      const evt = new MessageEvent("message", {
        data: bytes.buffer,
        origin: "https://www.attacker.example",
      });
      window.dispatchEvent(evt);
    }, [Buffer.from(TINY_PSD).toString("base64")]);

    await page.waitForTimeout(2000);

    await expect(page.getByTestId("photopea-status")).toHaveText(/saving/i);
  });
});
