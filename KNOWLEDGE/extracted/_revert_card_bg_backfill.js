#!/usr/bin/env node
// Undo the bad card_bg_url backfill from 2026-04-23 22:15 that wrote
// unsigned URLs Futbin's imgix CDN rejects (sig_invalid). Clears
// card_bg_url from any row where the URL matches the unsigned synthesis
// pattern. Real scraper-captured URLs include `?fm=png&ixlib=...&s=HMAC`
// and will NOT match this prefix, so they survive.
//
// Dry run by default. --apply to execute.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", "apps", "web", ".env.local");
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

(async () => {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Page rows whose card_bg_url looks like our bad synthesis (unsigned,
  // no query string). Real captures include `?fm=png&...&s=HMAC`.
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from("fc26_players")
      .select("id, attributes")
      .eq("source_dataset", "futbin.com")
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    process.stdout.write(`\rfetched ${all.length}...`);
  }
  process.stdout.write("\n");

  const toClear = [];
  for (const r of all) {
    const url = r.attributes?.card_bg_url;
    if (!url) continue;
    // Unsigned synthesis looks like:
    //   https://cdn3.futbin.com/content/fifa26/img/cards/tiny/{variant}.png
    // (no query string at all). Real captures have `?fm=png&...`.
    if (url.includes("/cards/tiny/") && !url.includes("?")) {
      toClear.push(r);
    }
  }
  console.log(`candidates (unsigned synthesis URL in DB): ${toClear.length}`);

  if (!apply) {
    console.log("\nsample (first 5 URLs to clear):");
    for (const r of toClear.slice(0, 5)) {
      console.log(`  ${r.id}  ${r.attributes.card_bg_url}`);
    }
    console.log("\nDRY RUN. Re-run with --apply to clear.");
    return;
  }

  const BATCH = 50;
  let done = 0;
  let errs = 0;
  for (let i = 0; i < toClear.length; i += BATCH) {
    const slice = toClear.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((r) => {
        const nextAttrs = { ...r.attributes };
        delete nextAttrs.card_bg_url;
        return sb.from("fc26_players").update({ attributes: nextAttrs }).eq("id", r.id);
      }),
    );
    for (const res of results) if (res.error) { errs++; console.error(res.error.message); }
    done += slice.length;
    process.stdout.write(`\rcleared ${done}/${toClear.length}  errors=${errs}`);
  }
  process.stdout.write("\n");
  console.log("done");
})();
