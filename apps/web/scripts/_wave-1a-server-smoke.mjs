#!/usr/bin/env node
/* eslint-disable no-console */
// Wave 1A — overlay builder server-pipeline smoke.
//
// Run pipeline smoke after `npx next dev -p 3030`:
//   node apps/web/scripts/_wave-1a-server-smoke.mjs
//
// What it does:
//   - Boots a service-role Supabase client from apps/web/.env.local.
//   - Calls the same server modules the admin UI will use (via raw Supabase
//     client — same DB path the server actions take):
//       createDesign (1 row in overlay_user_designs + 1 scene)
//       addElement × 3 — one rect, one text ("SMOKE TEST"), one image bound
//                         to standings rank-1 photoUrl
//       publishDesign  — sets status=published + inserts overlay_template_variants
//   - Fetches /overlay/v2/user/<slug>?demo=1 from the dev server.
//   - Asserts every §14 contract marker in the response body.
//   - Soft-deletes the design (audit trail preserved, scenes/elements excluded
//     via design-level deleted_at filter on all reads).
//
// Exits non-zero on any failed assertion. Prints a green PASS line on success.
// Exit code 2 = hard error (env missing, DB failure, dev server unreachable).
// Exit code 1 = one or more §14 assertion failures (smoke red).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ── env loading ──────────────────────────────────────────────────────────────
// Match the manual parser pattern from _backfill-card-images.mjs — avoids
// needing dotenv as an explicit dep while reliably handling KEY=VALUE and
// KEY="VALUE" lines.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, "..", ".env.local");

function loadEnv() {
  let raw;
  try {
    raw = readFileSync(ENV_PATH, "utf8");
  } catch {
    console.error(`ERR: cannot read ${ENV_PATH}`);
    process.exit(2);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      // Strip surrounding quotes if present.
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3030";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "ERR: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in",
    ENV_PATH,
  );
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── assertion harness ────────────────────────────────────────────────────────
const failures = [];
function check(label, cond) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

// ── cleanup helper ───────────────────────────────────────────────────────────
// Soft-delete design. Does NOT hard-delete — audit trail must be preserved.
// Scenes + elements are excluded from subsequent reads via the design's own
// deleted_at filter (JOIN pattern in getDesign / getScene reads).
async function cleanup(designId) {
  if (!designId) return;
  const nowIso = new Date().toISOString();
  await sb
    .from("overlay_user_designs")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("id", designId);
  // Also soft-delete the overlay_template_variants row inserted by publishDesign
  // so the broadcast panel doesn't surface a dangling smoke entry.
  await sb
    .from("overlay_template_variants")
    .update({ deleted_at: nowIso })
    .like("overlay_key", "user-smoke-%")
    .eq("kind", "dynamic");
}

// ── main pipeline ────────────────────────────────────────────────────────────
async function main() {
  // Slug: all-lowercase, starts + ends with alphanumeric, only hyphens between
  // (matches SLUG_RE in the runtime route).
  const slug = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
  console.log(`\n>>> Wave 1A server-pipeline smoke`);
  console.log(`    slug    = ${slug}`);
  console.log(`    baseUrl = ${BASE_URL}`);

  let designId = null;

  // ── Step 1: createDesign ───────────────────────────────────────────────────
  // Uses same DB path as the server action (direct Supabase client).
  // createDesign allocates slug + creates the single "main" scene for mode=single.
  console.log("\n>>> Step 1 — createDesign");
  const { data: designData, error: dErr } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: `Smoke ${slug}`,
      description: null,
      mode: "single",
      status: "draft",
      canvas_width: 1920,
      canvas_height: 1080,
      created_by: "smoke-script",
    })
    .select("id")
    .single();
  if (dErr || !designData) {
    console.error("ERR insert design:", dErr?.message ?? "no data returned");
    process.exit(2);
  }
  designId = designData.id;
  console.log(`  designId = ${designId}`);

  // Create the single scene (mirrors createDesign mode=single path).
  const { data: sceneData, error: sErr } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: designId,
      order_index: 0,
      name: null,
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
    })
    .select("id")
    .single();
  if (sErr || !sceneData) {
    console.error("ERR insert scene:", sErr?.message ?? "no data returned");
    await cleanup(designId);
    process.exit(2);
  }
  const sceneId = sceneData.id;
  console.log(`  sceneId  = ${sceneId}`);

  // ── Step 2: addElement × 3 ────────────────────────────────────────────────
  // Transform uses camelCase (scaleX, scaleY, opacity) to match the Zod
  // TransformSchema in builder/types.ts — the style-validator reads camelCase
  // from the DB JSONB, not snake_case.
  console.log("\n>>> Step 2 — addElement × 3");

  const baseTransform = {
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };

  const elements = [
    // 1. Rect — green fill, no binding, no animation.
    {
      scene_id: sceneId,
      parent_group_id: null,
      element_type: "rect",
      z_index: 0,
      locked: false,
      visible: true,
      transform: { ...baseTransform, x: 100, y: 100, width: 400, height: 200 },
      style: { fill: "#6bcd06" },
      content: {},
      binding: null,
      animation: {},
    },
    // 2. Text — hardcoded content "SMOKE TEST", Agharti font (triggers @font-face).
    {
      scene_id: sceneId,
      parent_group_id: null,
      element_type: "text",
      z_index: 1,
      locked: false,
      visible: true,
      transform: { ...baseTransform, x: 600, y: 150, width: 800, height: 80 },
      style: {
        fill: "#ffffff",
        fontFamily: "Agharti",
        fontSize: 64,
        fontWeight: 700,
        textAlign: "left",
      },
      content: { text: "SMOKE TEST" },
      binding: null,
      animation: {},
    },
    // 3. Image — bound to standings[0].photoUrl (triggers data-binding-feed +
    //    __OVERLAY_FEEDS__ standings entry in compiled HTML).
    {
      scene_id: sceneId,
      parent_group_id: null,
      element_type: "image",
      z_index: 2,
      locked: false,
      visible: true,
      transform: { ...baseTransform, x: 1300, y: 400, width: 400, height: 400 },
      style: {},
      content: {},
      binding: {
        feed: "standings",
        fieldPath: "standings[0].photoUrl",
      },
      animation: {},
    },
  ];

  const { error: eErr } = await sb
    .from("overlay_user_design_elements")
    .insert(elements);
  if (eErr) {
    console.error("ERR insert elements:", eErr.message);
    await cleanup(designId);
    process.exit(2);
  }
  console.log(`  inserted 3 elements (rect, text, image-with-binding)`);

  // ── Step 3: publishDesign ──────────────────────────────────────────────────
  // Mirrors publishDesign() in builder/designs.ts:
  //   status = "published"  +  inserts overlay_template_variants row.
  console.log("\n>>> Step 3 — publishDesign");
  const nowIso = new Date().toISOString();

  const { error: pErr } = await sb
    .from("overlay_user_designs")
    .update({ status: "published", updated_at: nowIso })
    .eq("id", designId);
  if (pErr) {
    console.error("ERR publish design:", pErr.message);
    await cleanup(designId);
    process.exit(2);
  }

  const overlayKey = `user-${slug}`;
  const { error: vErr } = await sb
    .from("overlay_template_variants")
    .insert({
      overlay_key: overlayKey,
      variant_id: "default",
      label: `Smoke ${slug}`,
      html_path: `/overlay/v2/user/${slug}`,
      thumbnail_path: null,
      active: true,
      kind: "dynamic",
    });
  if (vErr) {
    // Non-fatal for the smoke — the route doesn't depend on the variants row.
    // Warn but continue so the HTML assertions can still run.
    console.warn(`  WARN: overlay_template_variants insert failed: ${vErr.message}`);
    console.warn(`  (route fetch will still work — continuing)`);
  } else {
    console.log(`  status=published, template_variants row inserted`);
  }

  // ── Step 4: fetch the route ────────────────────────────────────────────────
  const url = `${BASE_URL}/overlay/v2/user/${slug}?demo=1`;
  console.log(`\n>>> Step 4 — GET ${url}`);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error(`ERR fetch — is the dev server running on ${BASE_URL}?`);
    console.error(`     ${e.message}`);
    await cleanup(designId);
    process.exit(2);
  }

  // ── Step 5: §14 assertions ────────────────────────────────────────────────
  console.log("\n>>> Step 5 — §14 contract assertions");
  check("status 200", res.status === 200);
  check(
    "content-type text/html",
    (res.headers.get("content-type") ?? "").includes("text/html"),
  );

  const body = await res.text();

  // §14 structural markers
  check("starts with <!DOCTYPE html>", body.trimStart().startsWith("<!DOCTYPE html>"));
  check('html lang="en"', body.includes('<html lang="en">'));
  check("meta charset UTF-8", /<meta charset="UTF-8"/.test(body));
  check(
    "meta color-scheme dark",
    /name="color-scheme"\s+content="dark"/.test(body) ||
      /content="dark"\s+name="color-scheme"/.test(body),
  );
  check(
    "html,body background transparent !important",
    /background:\s*transparent\s*!important/.test(body),
  );
  check(
    "body 1920x1080 + overflow hidden",
    /width:\s*1920px/.test(body) &&
      /height:\s*1080px/.test(body) &&
      /overflow:\s*hidden/.test(body),
  );
  check("body opacity 1 !important", /opacity:\s*1\s*!important/.test(body));

  // Element DOM markers
  check(
    "3+ data-element-id attrs",
    (body.match(/data-element-id=/g) ?? []).length >= 3,
  );
  check("text content SMOKE TEST present", /SMOKE TEST/.test(body));
  check(
    "image element has data-element-img",
    /data-element-img/.test(body),
  );

  // Binding / feed markers (image element bound to standings)
  check(
    'image element has data-binding-feed="standings"',
    /data-binding-feed="standings"/.test(body),
  );
  check(
    "__OVERLAY_FEEDS__ standings entry present",
    /window\.__OVERLAY_FEEDS__\s*=\s*\{[\s\S]*standings\s*:/.test(body),
  );

  // Bootstrap script markers (§14 observer + demo flag)
  check(
    "bootstrap observer marker cade-visible-gate-observer-v2",
    /cade-visible-gate-observer-v2/.test(body),
  );
  check(
    "__OVERLAY_DEMO__ = true (demo=1 flag set)",
    /__OVERLAY_DEMO__\s*=\s*true/.test(body),
  );

  // Font face (Agharti @font-face emitted for text element)
  check(
    "@font-face Agharti present",
    /@font-face[\s\S]*Agharti/.test(body),
  );

  // CSP header — frame-ancestors * required for OBS/vMix embedding
  check(
    "CSP frame-ancestors * set",
    (res.headers.get("content-security-policy") ?? "").includes("frame-ancestors *"),
  );

  // ── Step 6: softDeleteDesign cleanup ──────────────────────────────────────
  console.log("\n>>> Step 6 — softDeleteDesign cleanup");
  await cleanup(designId);
  console.log(`  soft-deleted design ${designId} + template_variants row`);

  // ── Result ─────────────────────────────────────────────────────────────────
  if (failures.length === 0) {
    console.log("\n[32mPASS[0m — Wave 1A server pipeline smoke green");
    process.exit(0);
  } else {
    console.log(`\n[31mFAIL[0m — ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("UNCAUGHT:", e);
  process.exit(2);
});
