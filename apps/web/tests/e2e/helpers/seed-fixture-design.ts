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

/**
 * Insert a 4-element Wave 1B fixture design directly into the
 * `overlay_user_*` tables under a unique slug.
 *
 * Fixture shape (exercises every Wave 1B compiler path):
 *   - 1 rect     (x:100, y:100, 600×240) with linear gradient green→pink,
 *                 dual box-shadows, filter brightness+saturate.
 *   - 1 ellipse  (x:900, y:100, 400×400) with radial gradient white→black.
 *   - 1 polygon  (x:1400, y:100, 400×400) pink solid hexagon (sides=6).
 *   - 1 text     (x:100, y:600, 1700×200) "WAVE 1B" Agharti 128 px with
 *                 linear gradient green→pink.
 *
 * The design is published immediately so /overlay/v2/user/<slug>?demo=1
 * is reachable without any editor interaction.
 *
 * Cleanup soft-deletes the design + related rows.
 *
 * Used by visual-regression-wave-1b.spec.ts.
 */
export async function seedWave1bFixtureDesign(): Promise<FixtureSeedResult> {
  const sb = getServiceRoleClient();
  const slug = `vr-wave1b-${Date.now().toString(36)}`;

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

  // 2. Insert the design in published state.
  const { data: design, error: designErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: "Wave 1B Visual Regression Fixture",
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

  // 4. Insert 4 elements covering all Wave 1B compiler paths.
  const elements = [
    // Rect — linear gradient + dual shadows + filter.
    {
      scene_id: sceneId,
      element_type: "rect",
      z_index: 1,
      transform: {
        x: 100,
        y: 100,
        width: 600,
        height: 240,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {
        gradient: {
          kind: "linear",
          angle: 90,
          stops: [
            { offset: 0, color: "#6bcd06" },
            { offset: 1, color: "#fe036d" },
          ],
        },
        shadows: [
          { offsetX: 4, offsetY: 4, blur: 16, color: "#000000", opacity: 0.6 },
          { offsetX: -4, offsetY: -4, blur: 16, color: "#6bcd06", opacity: 0.4 },
        ],
        filter: { brightness: 1.1, saturate: 1.2 },
      },
      content: {},
    },
    // Ellipse — radial gradient (produces border-radius: 50% in HTML output).
    {
      scene_id: sceneId,
      element_type: "ellipse",
      z_index: 2,
      transform: {
        x: 900,
        y: 100,
        width: 400,
        height: 400,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {
        gradient: {
          kind: "radial",
          cx: 0.5,
          cy: 0.5,
          radius: 0.7,
          stops: [
            { offset: 0, color: "#ffffff" },
            { offset: 1, color: "#050505" },
          ],
        },
      },
      content: {},
    },
    // Polygon — solid pink hexagon (produces clip-path: polygon() in HTML output).
    {
      scene_id: sceneId,
      element_type: "polygon",
      z_index: 3,
      transform: {
        x: 1400,
        y: 100,
        width: 400,
        height: 400,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: { fill: "#fe036d", sides: 6 },
      content: {},
    },
    // Text — Agharti 128 px with linear gradient ink.
    {
      scene_id: sceneId,
      element_type: "text",
      z_index: 4,
      transform: {
        x: 100,
        y: 600,
        width: 1700,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {
        fontFamily: "Agharti",
        fontSize: 128,
        fontWeight: 700,
        color: "#ffffff",
        gradient: {
          kind: "linear",
          angle: 45,
          stops: [
            { offset: 0, color: "#6bcd06" },
            { offset: 1, color: "#fe036d" },
          ],
        },
      },
      content: { text: "WAVE 1B" },
    },
  ];

  const { error: elErr } = await sb
    .from("overlay_user_design_elements")
    .insert(elements);
  if (elErr) throw elErr;

  // 5. Optionally register the user-design variant row. Not load-bearing for
  //    the overlay route (which resolves by slug directly) but mirrors the
  //    Wave 1A fixture convention for DB consistency.
  try {
    await sb.from("overlay_template_variants").insert({
      overlay_key: `user-${slug}`,
      variant_id: "default",
      label: "Wave 1B VR Fixture",
      html_path: `/overlay/v2/user/${slug}`,
      active: true,
    });
  } catch {
    // Table may not exist in this schema revision — not load-bearing.
  }

  return {
    designId,
    sceneId,
    slug,
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

/**
 * Insert a Wave 1C fixture design that exercises the new compiler paths
 * introduced in Wave 1C: path elements and grouped elements.
 *
 * Two scenes:
 *
 *   Scene 1 — "path scene":
 *     - 1 path     (closed cubic-Bézier triangle, fill #6bcd06, stroke #ffffff)
 *
 *   Scene 2 — "group scene":
 *     - 1 group    (parent container — elementType="group")
 *     - 1 rect     (child of group, fill #fe036d)
 *     - 1 text     (child of group, "WAVE 1C", Agharti 96 px, fill #ffffff)
 *
 * Both scenes are in a single design published immediately so
 * /overlay/v2/user/<slug>?demo=1 is reachable without editor interaction.
 *
 * Fixture shape deliberately uses distinct, pixel-stable positions so the
 * captured baseline PNG is reproducible across machines (canvas 1920×1080).
 *
 * Used by visual-regression-wave-1c.spec.ts.
 */
export async function seedWave1cFixtureDesign(): Promise<FixtureSeedResult> {
  const sb = getServiceRoleClient();
  const slug = `vr-wave1c-${Date.now().toString(36)}`;

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

  // 2. Insert the design in published state.
  const { data: design, error: designErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: "Wave 1C Visual Regression Fixture",
      mode: "slideshow",
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

  // 3. Insert Scene 1 — path scene.
  const { data: scene1, error: scene1Err } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: designId,
      order_index: 0,
      name: "Path Scene",
      duration_ms: 6000,
      transition_in: "fade",
      transition_out: "fade",
    })
    .select("id")
    .single();
  if (scene1Err || !scene1) {
    throw scene1Err ?? new Error("scene 1 insert failed");
  }
  const scene1Id = scene1.id as string;

  // 4. Insert Scene 2 — group scene.
  const { data: scene2, error: scene2Err } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: designId,
      order_index: 1,
      name: "Group Scene",
      duration_ms: 6000,
      transition_in: "fade",
      transition_out: "fade",
    })
    .select("id")
    .single();
  if (scene2Err || !scene2) {
    throw scene2Err ?? new Error("scene 2 insert failed");
  }
  const scene2Id = scene2.id as string;

  // 5a. Scene 1 elements — one closed cubic-Bézier triangle.
  const scene1Elements = [
    {
      scene_id: scene1Id,
      parent_group_id: null,
      element_type: "path",
      z_index: 1,
      locked: false,
      visible: true,
      transform: {
        x: 600,
        y: 300,
        width: 720,
        height: 480,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: { fill: "#6bcd06", stroke: "#ffffff", strokeWidth: 4 },
      content: {
        path: {
          nodes: [
            { x: 360, y: 0,   ctrlInX: 360, ctrlInY: 0,   ctrlOutX: 720, ctrlOutY: 240 },
            { x: 720, y: 480, ctrlInX: 720, ctrlInY: 480, ctrlOutX: 0,   ctrlOutY: 480 },
            { x: 0,   y: 480, ctrlInX: 0,   ctrlInY: 480, ctrlOutX: 0,   ctrlOutY: 0   },
          ],
          closed: true,
        },
      },
      binding: null,
      animation: null,
    },
  ];

  const { error: el1Err } = await sb
    .from("overlay_user_design_elements")
    .insert(scene1Elements);
  if (el1Err) throw el1Err;

  // 5b. Scene 2 elements — a group parent + rect child + text child.
  //     Insert the group placeholder first to obtain its id for parent_group_id.
  const { data: groupEl, error: groupElErr } = await sb
    .from("overlay_user_design_elements")
    .insert({
      scene_id: scene2Id,
      parent_group_id: null,
      element_type: "group",
      z_index: 1,
      locked: false,
      visible: true,
      transform: {
        x: 400,
        y: 200,
        width: 1000,
        height: 600,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {},
      content: {},
      binding: null,
      animation: null,
    })
    .select("id")
    .single();
  if (groupElErr || !groupEl) {
    throw groupElErr ?? new Error("group element insert failed");
  }
  const groupId = groupEl.id as string;

  const groupChildren = [
    // Rect child.
    {
      scene_id: scene2Id,
      parent_group_id: groupId,
      element_type: "rect",
      z_index: 2,
      locked: false,
      visible: true,
      transform: {
        x: 0,
        y: 0,
        width: 1000,
        height: 600,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: { fill: "#fe036d" },
      content: {},
      binding: null,
      animation: null,
    },
    // Text child.
    {
      scene_id: scene2Id,
      parent_group_id: groupId,
      element_type: "text",
      z_index: 3,
      locked: false,
      visible: true,
      transform: {
        x: 100,
        y: 250,
        width: 800,
        height: 100,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
        opacity: 1,
      },
      style: {
        fontFamily: "Agharti",
        fontSize: 96,
        fontWeight: 700,
        color: "#ffffff",
      },
      content: { text: "WAVE 1C" },
      binding: null,
      animation: null,
    },
  ];

  const { error: el2Err } = await sb
    .from("overlay_user_design_elements")
    .insert(groupChildren);
  if (el2Err) throw el2Err;

  // 6. Optionally register the user-design variant row for DB consistency
  //    (not load-bearing for the overlay route, which resolves by slug directly).
  try {
    await sb.from("overlay_template_variants").insert({
      overlay_key: `user-${slug}`,
      variant_id: "default",
      label: "Wave 1C VR Fixture",
      html_path: `/overlay/v2/user/${slug}`,
      active: true,
    });
  } catch {
    // Table may not exist in this schema revision — not load-bearing.
  }

  // Cleanup uses scene1Id as the representative sceneId in FixtureSeedResult;
  // the cleanup fn deletes all elements by design_id to cover both scenes.
  return {
    designId,
    sceneId: scene1Id,
    slug,
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
      // Delete elements across both scenes via design_id → scene join.
      for (const sid of [scene1Id, scene2Id]) {
        await sbInner
          .from("overlay_user_design_elements")
          .update({ deleted_at: now })
          .eq("scene_id", sid);
      }
      for (const sid of [scene1Id, scene2Id]) {
        await sbInner
          .from("overlay_user_design_scenes")
          .update({ deleted_at: now })
          .eq("id", sid);
      }
      await sbInner
        .from("overlay_user_designs")
        .update({ deleted_at: now })
        .eq("id", designId);
    },
  };
}
