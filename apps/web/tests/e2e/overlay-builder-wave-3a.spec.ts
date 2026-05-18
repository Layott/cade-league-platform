import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3030";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function loginAdmin(page: import("@playwright/test").Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByTestId("login-email-input").fill("admin@cade.local");
  await page.getByTestId("login-password-input").fill("dev-admin-2026");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 10000 });
}

async function purge(slug: string) {
  const sb = svc();
  await sb.from("overlay_user_designs").delete().eq("slug", slug);
  await sb.from("overlay_template_variants").delete().eq("overlay_key", `user-${slug}`);
}

test.describe.configure({ mode: "serial" });

test.describe("Wave 3A multi-scene authoring", () => {
  test("admin authors a 3-scene sequence design + render contains all 3", async ({ page, request }) => {
    const slug = `e2e-w3a-${Date.now().toString(36)}`;
    await loginAdmin(page);

    await page.goto(`${BASE_URL}/admin/broadcast/v2/builder`);
    await page.getByRole("button", { name: /new design/i }).click();
    await page.getByLabel(/title/i).fill(`E2E ${slug}`);
    await page.getByRole("button", { name: /create/i }).click();
    await page.waitForURL(/\/admin\/broadcast\/v2\/builder\/.+\/edit/);

    const url = page.url();
    const generatedSlug = url.match(/\/builder\/([^/]+)\/edit/)?.[1];
    expect(generatedSlug).toBeTruthy();

    try {
      await page.getByTestId("mode-toggle-sequence").click();
      await expect(page.getByLabel(/scene picker/i)).toBeVisible();

      await page.getByTestId("scene-tile-add").click();
      await page.waitForTimeout(300);
      await page.getByTestId("scene-tile-add").click();
      await page.waitForTimeout(300);
      await expect(page.getByTestId(/^scene-tile-/).filter({ hasNotText: "" })).toHaveCount(4);

      await page.getByLabel(/duration/i).fill("5");
      await page.getByLabel(/transition out/i).selectOption("slide-left");

      const tiles = page.locator('[data-testid^="scene-tile-"]:not([data-testid="scene-tile-add"])');
      await tiles.nth(1).click();
      await page.getByLabel(/duration/i).fill("3");
      await page.getByLabel(/transition in/i).selectOption("slide-left");
      await page.getByLabel(/transition out/i).selectOption("slide-up");

      await tiles.nth(2).click();
      await page.getByLabel(/duration/i).fill("4");
      await page.getByLabel(/transition in/i).selectOption("slide-up");
      await page.getByLabel(/transition out/i).selectOption("fade");

      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /publish/i }).click();
      await page.waitForTimeout(500);

      const res = await request.get(`${BASE_URL}/overlay/v2/user/${generatedSlug}?demo=1`);
      expect(res.status()).toBe(200);
      const html = await res.text();

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("cade-visible-gate-observer-v2");

      expect(html).toContain("__OVERLAY_SCENES_META__");
      expect(html.match(/data-scene-id="[^"]+"/g)?.length).toBe(3);
      expect(html).toContain("@keyframes scene-slide-left-in");
      expect(html).toContain("@keyframes scene-slide-left-out");
      expect(html).toContain("@keyframes scene-slide-up-in");
      expect(html).toContain("@keyframes scene-slide-up-out");
      expect(html).toContain("@keyframes scene-fade-out");
      expect(html).toMatch(/durationMs:\s*5000/);
      expect(html).toMatch(/durationMs:\s*3000/);
      expect(html).toMatch(/durationMs:\s*4000/);
    } finally {
      if (generatedSlug) await purge(generatedSlug);
    }
  });

  test("postMessage next-scene advances the sequence", async ({ page }) => {
    const sb = svc();
    const slug = `e2e-w3a-next-${Date.now().toString(36)}`;
    const { data: design } = await sb
      .from("overlay_user_designs")
      .insert({
        slug,
        title: `next-scene ${slug}`,
        mode: "sequence",
        status: "published",
        canvas_width: 1920,
        canvas_height: 1080,
      })
      .select("id")
      .single();
    try {
      const sceneRows = [];
      for (let i = 0; i < 3; i++) {
        const { data: scene } = await sb
          .from("overlay_user_design_scenes")
          .insert({
            design_id: design!.id,
            order_index: i,
            duration_ms: 10000,
            transition_in: "fade",
            transition_out: "fade",
          })
          .select("id")
          .single();
        sceneRows.push(scene!.id);
        await sb.from("overlay_user_design_elements").insert({
          scene_id: scene!.id,
          element_type: "text",
          z_index: 0,
          transform: { x: 100, y: 100, width: 800, height: 100, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
          style: {},
          content: { text: `SCENE ${i + 1}` },
        });
      }

      await page.goto(`${BASE_URL}/overlay/v2/user/${slug}`);
      await page.evaluate(() => window.postMessage({ type: "show" }, "*"));
      await page.waitForFunction(
        (id) => document.querySelector(`[data-scene-id="${id}"]`)?.getAttribute("data-scene-state") === "active",
        sceneRows[0],
        { timeout: 2000 },
      );
      await page.evaluate(() => window.postMessage({ type: "next-scene" }, "*"));
      await page.waitForFunction(
        (id) => document.querySelector(`[data-scene-id="${id}"]`)?.getAttribute("data-scene-state") === "active",
        sceneRows[1],
        { timeout: 2000 },
      );
    } finally {
      await purge(slug);
    }
  });
});
