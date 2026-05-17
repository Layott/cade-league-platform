import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Wave 1A — runtime route E2E.
 *
 * Seeds a minimal design via the service-role client, hits the route,
 * asserts the §14 contract holds in the returned body. Cleans up via
 * hard-purge of seeded rows.
 *
 * Requires:
 *   - Dev server at http://localhost:3030 (npx next dev -p 3030)
 *   - .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3030";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function seedPublishedDesign(slug: string): Promise<{ designId: string; sceneId: string }> {
  const sb = svc();
  const { data: design, error: dErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: `E2E ${slug}`,
      mode: "single",
      status: "published",
      canvas_width: 1920,
      canvas_height: 1080,
      created_by: "e2e-test",
    })
    .select("id")
    .single();
  if (dErr || !design) throw new Error(`seed design failed: ${dErr?.message}`);

  const { data: scene, error: sErr } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: design.id,
      order_index: 0,
      name: "main",
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
    })
    .select("id")
    .single();
  if (sErr || !scene) throw new Error(`seed scene failed: ${sErr?.message}`);

  await sb.from("overlay_user_design_elements").insert([
    {
      scene_id: scene.id,
      element_type: "rect",
      z_index: 0,
      transform: { x: 100, y: 100, width: 200, height: 100, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
      style: { fill: "#6bcd06" },
    },
  ]);

  return { designId: design.id as string, sceneId: scene.id as string };
}

async function seedDraftDesign(slug: string): Promise<string> {
  const sb = svc();
  const { data, error } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: `E2E draft ${slug}`,
      mode: "single",
      status: "draft",
      canvas_width: 1920,
      canvas_height: 1080,
      created_by: "e2e-test",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed draft failed: ${error?.message}`);
  return data.id as string;
}

async function purge(slug: string) {
  const sb = svc();
  await sb.from("overlay_user_designs").delete().eq("slug", slug);
}

test.describe("/overlay/v2/user/[slug] runtime route", () => {
  test("200 + text/html + §14 markers for published design", async ({ request }) => {
    const slug = `e2e-pub-${Date.now()}`;
    await seedPublishedDesign(slug);
    try {
      const res = await request.get(`${BASE_URL}/overlay/v2/user/${slug}?demo=1`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
      expect(body).toContain('<html lang="en">');
      expect(body).toContain('name="color-scheme" content="dark"');
      expect(body).toMatch(/background:\s*transparent\s*!important/);
      expect(body).toContain("cade-visible-gate-observer-v2");
      // CSP header
      const csp = res.headers()["content-security-policy"];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors *");
      // Cache-Control
      expect(res.headers()["cache-control"]).toBe("no-store");
    } finally {
      await purge(slug);
    }
  });

  test("404 on unpublished draft (no preview token)", async ({ request }) => {
    const slug = `e2e-draft-${Date.now()}`;
    await seedDraftDesign(slug);
    try {
      const res = await request.get(`${BASE_URL}/overlay/v2/user/${slug}`);
      expect(res.status()).toBe(404);
    } finally {
      await purge(slug);
    }
  });

  test("200 on draft with valid admin preview token", async ({ request }) => {
    const slug = `e2e-draft-preview-${Date.now()}`;
    await seedDraftDesign(slug);
    // Issue a preview token via the dedicated test-only endpoint that wraps
    // the helper used by the admin UI.
    const tokenRes = await request.post(`${BASE_URL}/api/test/preview-token`, {
      data: { slug },
      headers: {
        "x-test-secret": process.env.E2E_TEST_SECRET ?? "test-secret-2026",
      },
    });
    // If the test endpoint isn't enabled (production builds), skip.
    test.skip(tokenRes.status() !== 200, "preview-token test endpoint not available");
    const { token } = await tokenRes.json();
    try {
      const res = await request.get(
        `${BASE_URL}/overlay/v2/user/${slug}?previewToken=${encodeURIComponent(token)}`,
      );
      expect(res.status()).toBe(200);
    } finally {
      await purge(slug);
    }
  });

  test("401 on session-scoped request with bad view token", async ({ request }) => {
    const slug = `e2e-pub-vt-${Date.now()}`;
    await seedPublishedDesign(slug);
    const sb = svc();
    // Create a session that has a non-null view_token. The route will
    // gate on ?t= mismatch → 401.
    const { data: sess } = await sb
      .from("stream_sessions")
      .insert({ view_token: "secret-token-xyz", match_day_id: null })
      .select("id")
      .single();
    if (!sess) {
      test.skip(true, "could not seed stream session");
      return;
    }
    try {
      // sessionId present + wrong token → 401
      const res = await request.get(
        `${BASE_URL}/overlay/v2/user/${slug}?sessionId=${sess.id}&t=wrong-token`,
      );
      expect(res.status()).toBe(401);
    } finally {
      if (sess) await sb.from("stream_sessions").delete().eq("id", sess.id);
      await purge(slug);
    }
  });
});
