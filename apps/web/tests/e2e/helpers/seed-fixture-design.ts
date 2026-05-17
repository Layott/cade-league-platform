import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Load variables from apps/web/.env.local into process.env.
 * Same pattern as overlay-design-tokens.spec.ts + overlay-design-animations.spec.ts.
 * Only sets keys that are not already present (CI may pre-export them).
 */
function loadEnvFromDotEnvLocal(): void {
  // __dirname = apps/web/tests/e2e/helpers
  // .env.local is at apps/web/.env.local  →  ../../..
  const p = path.resolve(__dirname, "..", "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

/**
 * Returns a service-role Supabase client that bypasses RLS.
 * Throws if the required env vars are absent so caller gets an
 * explicit error rather than a silent auth failure.
 */
export function getServiceRoleClient(): SupabaseClient {
  loadEnvFromDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set. " +
        "Check apps/web/.env.local or CI env exports.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type FixtureSeedResult = {
  designId: string;
  sceneId: string;
  slug: string;
  cleanup: () => Promise<void>;
};

/**
 * Insert a deterministic 3-element design (rect + text + image) directly
 * into the `overlay_user_*` tables under a unique slug. The design is
 * published immediately so /overlay/v2/user/<slug>?demo=1 is reachable
 * without any editor interaction.
 *
 * Fixture shape:
 *   - 1 rect     (x:100, y:100, 800×200, fill:#6bcd06)
 *   - 1 text     (x:140, y:160, "WAVE 1A", Agharti 96px, fill:#050505)
 *   - 1 image    (x:1500, y:850, 320×160, src:/overlays/v2/_assets/logos/cade.png)
 *
 * Cleanup soft-deletes the design + related rows.
 *
 * Used by visual-regression-wave-1a.spec.ts to seed a stable fixture
 * without driving the editor UI (which is harder to make deterministic
 * at a pixel-perfect level for VR baselines).
 */
export async function seedWave1aFixtureDesign(): Promise<FixtureSeedResult> {
  const sb = getServiceRoleClient();
  const slug = `vr-wave1a-${Date.now().toString(36)}`;

  // 1. Resolve the seeded admin user's id.
  const { data: adminRow, error: adminErr } = await sb
    .from("users")
    .select("id")
    .eq("email", "admin@cade.local")
    .is("deleted_at", null)
    .maybeSingle();
  if (adminErr || !adminRow) {
    throw new Error(
      `Could not resolve admin@cade.local user row: ${adminErr?.message ?? "no row"}`,
    );
  }
  const createdBy = adminRow.id as string;

  // 2. Insert the design in published state so the overlay route is
  //    immediately accessible.
  const { data: design, error: designErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: "Wave 1A Visual Regression Fixture",
      mode: "single",
      status: "published",
      canvas_width: 1920,
      canvas_height: 1080,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (designErr || !design) {
    throw designErr ?? new Error("design insert failed");
  }
  const designId = design.id as string;

  // 3. Insert one scene.
  const { data: scene, error: sceneErr } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: designId,
      order_index: 0,
      name: "Scene 1",
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
    })
    .select("id")
    .single();
  if (sceneErr || !scene) {
    throw sceneErr ?? new Error("scene insert failed");
  }
  const sceneId = scene.id as string;

  // 4. Insert 3 deterministic elements: rect + text + image.
  //    Positions and sizes are fixed so the baseline PNG is reproducible
  //    across machines (canvas is always 1920×1080).
  const elements = [
    {
      scene_id: sceneId,
      element_type: "rect",
      z_index: 1,
      transform: {
        x: 100,
        y: 100,
        width: 800,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: { fill: "#6bcd06", strokeWidth: 0 },
      content: {},
    },
    {
      scene_id: sceneId,
      element_type: "text",
      z_index: 2,
      transform: {
        x: 140,
        y: 160,
        width: 720,
        height: 80,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {
        fontFamily: "Agharti",
        fontSize: 96,
        fill: "#050505",
        fontWeight: 700,
      },
      content: { text: "WAVE 1A" },
    },
    {
      scene_id: sceneId,
      element_type: "image",
      z_index: 3,
      transform: {
        x: 1500,
        y: 850,
        width: 320,
        height: 160,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {},
      content: {
        // Brand asset shipped with the repo — reproducible across machines.
        src: "/overlays/v2/_assets/logos/cade.png",
      },
    },
  ];

  const { error: elErr } = await sb
    .from("overlay_user_design_elements")
    .insert(elements);
  if (elErr) throw elErr;

  // 5. Optionally register the user-design variant row so the overlay route
  //    is discoverable via overlay_template_variants queries. The user-design
  //    route resolves by slug directly, but mirroring existing conventions
  //    keeps the DB consistent.
  //    Ignore conflict errors — if the table doesn't exist in this schema
  //    revision the insert simply fails silently here (not load-bearing for
  //    the route itself).
  try {
    await sb
      .from("overlay_template_variants")
      .insert({
        overlay_key: `user-${slug}`,
        variant_id: "default",
        label: "Wave 1A VR Fixture",
        html_path: `/overlay/v2/user/${slug}`,
        active: true,
      });
  } catch {
    // Table may not exist in this schema revision — not load-bearing for
    // the overlay route (which resolves by slug directly).
  }

  return {
    designId,
    sceneId,
    slug,
    cleanup: async () => {
      const sbInner = getServiceRoleClient();
      const now = new Date().toISOString();
      // Soft-delete in reverse dependency order.
      try {
        await sbInner
          .from("overlay_template_variants")
          .update({ deleted_at: now })
          .eq("overlay_key", `user-${slug}`);
      } catch {
        // optional table
      }
      await sbInner
        .from("overlay_user_design_elements")
        .update({ deleted_at: now })
        .eq("scene_id", sceneId);
      await sbInner
        .from("overlay_user_design_scenes")
        .update({ deleted_at: now })
        .eq("id", sceneId);
      await sbInner
        .from("overlay_user_designs")
        .update({ deleted_at: now })
        .eq("id", designId);
    },
  };
}
