import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Wave 3B — fixture seeder for the advanced-timeline visual-regression
 * baseline.
 *
 * Mirrors the helper pattern of {@link seedWave1aFixtureDesign} +
 * {@link seedWave3aSequenceFixture}: directly INSERTs an `overlay_user_*`
 * design row in published state so /overlay/v2/user/<slug>?demo=1 is
 * reachable without editor interaction.
 *
 * Fixture shape — single text element with TWO advanced-timeline tracks
 * on the entry phase (visually rich enough to catch regression):
 *
 *   - opacity track: 0 → 1   over 0..1000 ms (linear)
 *   - scaleX  track: 0.8 → 1 over 0..1000 ms (linear)
 *
 * Entry phase carries `type: "noop"` because the runtime compiler treats
 * `noop + advancedTimeline` as the advanced path (a `noop` without a
 * timeline opts the phase out entirely per compiler.ts).
 *
 * `durationMs: 1000` so the VR spec can simply wait ~500ms after
 * `body.cade-visible` lands to capture a mid-animation frame at ~50%
 * progress — no need for a separate `?animProgress=0.5` URL param.
 *
 * Cleanup soft-deletes the design + related rows.
 */

function loadEnvFromDotEnvLocal(): void {
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

export type AdvancedTimelineSeedResult = {
  designId: string;
  sceneId: string;
  elementId: string;
  slug: string;
  /** Entry-phase total duration. The VR spec uses this to time its
   *  mid-animation screenshot exactly halfway through. */
  durationMs: number;
  cleanup: () => Promise<void>;
};

/**
 * Insert a single-scene design with one text element carrying an
 * advanced-timeline entry animation (opacity 0→1 + scaleX 0.8→1 over
 * 1000 ms). Published immediately.
 *
 * Used by visual-regression-wave-3b.spec.ts.
 */
export async function seedWave3bAdvancedTimelineFixture(): Promise<AdvancedTimelineSeedResult> {
  const sb = getServiceRoleClient();
  const slug = `vr-wave3b-${Date.now().toString(36)}`;
  const durationMs = 1000;

  // 1. Resolve the seeded admin user's id (best-effort — not load-bearing
  //    for the overlay route, which resolves by slug directly).
  let createdBy: string | null = null;
  try {
    const { data: adminRow } = await sb
      .from("users")
      .select("id")
      .eq("email", "admin@cade.local")
      .is("deleted_at", null)
      .maybeSingle();
    if (adminRow) createdBy = (adminRow.id as string) ?? null;
  } catch {
    // optional — schema may not have users table in all envs
  }

  // 2. Insert the design in published state.
  const { data: design, error: designErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: "Wave 3B Visual Regression Fixture",
      mode: "single",
      status: "published",
      canvas_width: 1920,
      canvas_height: 1080,
      ...(createdBy ? { created_by: createdBy } : null),
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
      name: "main",
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

  // 4. Insert one text element with the advanced-timeline animation.
  //
  //    The animation shape mirrors the runtime TypeScript schema (see
  //    apps/web/src/server/overlays/builder/fixtures/design-with-advanced-timeline.ts).
  //    DB columns expect snake_case at the row level but JSONB column
  //    contents preserve camelCase to match the in-process Element type.
  const element = {
    scene_id: sceneId,
    parent_group_id: null,
    element_type: "text",
    z_index: 0,
    locked: false,
    visible: true,
    transform: {
      x: 400,
      y: 400,
      width: 1120,
      height: 200,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
      opacity: 1,
    },
    style: {
      fill: "#ffffff",
      fontFamily: "Agharti",
      fontSize: 128,
      fontWeight: 700,
      textAlign: "left",
    },
    content: { text: "WAVE 3B" },
    binding: null,
    animation: {
      entry: {
        type: "noop",
        durationMs,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "vr-o1", timeMs: 0, value: 0, easingOut: null },
              { id: "vr-o2", timeMs: durationMs, value: 1, easingOut: null },
            ],
          },
          {
            property: "scaleX",
            keyframes: [
              { id: "vr-s1", timeMs: 0, value: 0.8, easingOut: null },
              { id: "vr-s2", timeMs: durationMs, value: 1, easingOut: null },
            ],
          },
        ],
      },
    },
  };

  const { data: elementRow, error: elErr } = await sb
    .from("overlay_user_design_elements")
    .insert(element)
    .select("id")
    .single();
  if (elErr || !elementRow) {
    throw elErr ?? new Error("element insert failed");
  }
  const elementId = elementRow.id as string;

  // 5. Optionally register the user-design variant row for DB consistency
  //    (not load-bearing for the overlay route, which resolves by slug directly).
  try {
    await sb.from("overlay_template_variants").insert({
      overlay_key: `user-${slug}`,
      variant_id: "default",
      label: "Wave 3B VR Fixture",
      html_path: `/overlay/v2/user/${slug}`,
      active: true,
    });
  } catch {
    // Table may not exist in this schema revision — not load-bearing.
  }

  return {
    designId,
    sceneId,
    elementId,
    slug,
    durationMs,
    cleanup: async () => {
      const sbInner = getServiceRoleClient();
      const now = new Date().toISOString();
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
