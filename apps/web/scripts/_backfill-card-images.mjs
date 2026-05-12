#!/usr/bin/env node
/**
 * Backfill Futbin card images to Supabase Storage.
 *
 * Futbin's `cdn3.futbin.com` CDN bot-blocks every non-browser origin
 * (curl_cffi chrome120, Vercel-side fetch, weserv proxy all 403). The
 * scraper resolves image URLs from rendered DOM but never downloads
 * bytes; production overlay rendering hot-links to Futbin → broken
 * image icons on /overlay/v2/26-card-meta (and any future card-art
 * surface).
 *
 * Strategy:
 *   1. Launch persistent Chromium with the Futbin profile (Cloudflare-
 *      cleared cookies live there).
 *   2. Visit `https://www.futbin.com/` once to confirm CF is still
 *      trusting the profile. If 403 here, abort with the same message
 *      _scrape_futbin_auto.js emits — user runs the headful script to
 *      re-warm.
 *   3. For each fc26_players row where `attributes.card_image_url`
 *      exists but `card_image_local` is missing, in-page fetch the
 *      image bytes via the trusted www.futbin.com origin (cross-
 *      subdomain to cdn3 inherits CF cookies on .futbin.com).
 *   4. Upload bytes to Supabase Storage bucket `card-images` under
 *      path `cards/{resourceId}/face.png` / `cards/{resourceId}/bg.png`.
 *   5. Write the public URL into the row's attributes JSONB.
 *
 * Resumable: rows that already have `card_image_local` set are skipped.
 * Re-run safely after partial completion.
 *
 * Usage:
 *   node apps/web/scripts/_backfill-card-images.mjs            # full run
 *   node apps/web/scripts/_backfill-card-images.mjs --limit=50 # cap rows
 *   node apps/web/scripts/_backfill-card-images.mjs --resource=117677750
 *                                                              # single card
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const PROFILE_DIR = path.join(
  ROOT,
  "KNOWLEDGE",
  "extracted",
  ".futbin_chromium_profile",
);
const ENV_PATH = path.join(ROOT, "apps", "web", ".env.local");
const BUCKET = "card-images";

function loadEnv() {
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function arg(flag, fallback) {
  const m = process.argv.find((a) => a.startsWith(flag + "="));
  return m ? m.slice(flag.length + 1) : fallback;
}

async function ensureBucket(sb) {
  const { data: existing } = await sb.storage.listBuckets();
  if (existing?.some((b) => b.name === BUCKET)) return;
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 1024 * 1024 * 2, // 2 MB cap per asset
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(`Created bucket: ${BUCKET}`);
}

async function inPageFetchBytes(page, url) {
  const result = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) return { status: r.status };
      const buf = await r.arrayBuffer();
      // Base64-encode in browser, since we can't return ArrayBuffer
      // directly through page.evaluate.
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(
          null,
          bytes.subarray(i, i + chunk),
        );
      }
      return {
        status: 200,
        b64: btoa(binary),
        type: r.headers.get("content-type") || "image/png",
        size: bytes.length,
      };
    } catch (err) {
      return { error: String(err) };
    }
  }, url);
  return result;
}

async function uploadAsset(sb, resourceId, kind, bytes, contentType) {
  const ext =
    contentType.includes("jpeg") ? "jpg" :
    contentType.includes("webp") ? "webp" :
    "png";
  const objectPath = `cards/${resourceId}/${kind}.${ext}`;
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(objectPath, bytes, {
      contentType,
      upsert: true,
      cacheControl: "public, max-age=2592000, immutable",
    });
  if (error) throw error;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function main() {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  await ensureBucket(sb);

  const limit = Number(arg("--limit", "0")) || null;
  const resourceId = arg("--resource", null);

  let query = sb
    .from("fc26_players")
    .select("id, attributes")
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null)
    .order("rating", { ascending: false });
  if (resourceId) {
    query = query.eq("attributes->>futbin_resource_id", resourceId);
  }
  if (limit) query = query.limit(limit * 4); // overfetch since many already done
  const { data: rows, error } = await query;
  if (error) throw error;

  const todo = (rows ?? []).filter((r) => {
    const a = r.attributes ?? {};
    const hasFutbin = a.card_image_url || a.card_bg_url;
    const hasLocal = a.card_image_local && a.card_bg_local;
    return hasFutbin && !hasLocal;
  });
  console.log(`Rows needing backfill: ${todo.length}`);
  if (todo.length === 0) return;

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();

  console.log("Probing Futbin home for Cloudflare clearance...");
  const home = await page.goto("https://www.futbin.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  if (!home || home.status() >= 400) {
    console.error(
      `Cloudflare challenge active (home ${home?.status()}). Run headful first:\n` +
        `  node KNOWLEDGE/extracted/_scrape_futbin_headful.js`,
    );
    await ctx.close();
    process.exit(1);
  }
  console.log(`Home OK (${home.status()}). Starting backfill...`);

  let done = 0,
    skipped = 0,
    failed = 0;
  const startedAt = Date.now();
  const targetRows = limit ? todo.slice(0, limit) : todo;

  for (const row of targetRows) {
    const attrs = { ...(row.attributes ?? {}) };
    const resId = attrs.futbin_resource_id;
    if (!resId) {
      skipped++;
      continue;
    }
    const updates = {};
    const tasks = [];
    if (attrs.card_image_url && !attrs.card_image_local) {
      tasks.push(["card_image", attrs.card_image_url, "face"]);
    }
    if (attrs.card_bg_url && !attrs.card_bg_local) {
      tasks.push(["card_bg", attrs.card_bg_url, "bg"]);
    }
    for (const [attrKey, url, kind] of tasks) {
      const fetched = await inPageFetchBytes(page, url);
      if (!fetched || fetched.status !== 200 || !fetched.b64) {
        failed++;
        console.warn(
          `  [${resId}/${kind}] fetch failed status=${fetched?.status} err=${fetched?.error ?? "?"}`,
        );
        continue;
      }
      const bytes = Buffer.from(fetched.b64, "base64");
      try {
        const publicUrl = await uploadAsset(
          sb,
          resId,
          kind,
          bytes,
          fetched.type,
        );
        updates[`${attrKey}_local`] = publicUrl;
      } catch (err) {
        failed++;
        console.warn(`  [${resId}/${kind}] upload failed: ${err.message}`);
      }
    }
    if (Object.keys(updates).length) {
      const merged = { ...attrs, ...updates };
      const { error: uerr } = await sb
        .from("fc26_players")
        .update({ attributes: merged })
        .eq("id", row.id);
      if (uerr) {
        failed++;
        console.warn(`  [${resId}] db update failed: ${uerr.message}`);
      } else {
        done++;
        if (done % 10 === 0) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
          const rate = (done / Number(elapsed)).toFixed(2);
          console.log(`  ${done}/${targetRows.length} (${elapsed}s, ${rate}/s)`);
        }
      }
    }
  }

  await ctx.close();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `\nDone. updated=${done} skipped=${skipped} failed=${failed} in ${elapsed}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
