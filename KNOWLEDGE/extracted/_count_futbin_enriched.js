// Count how many rows have futbin_resource_id in attributes,
// sliced by source_dataset and completeness of other futbin fields.
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
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const buckets = {};      // key: source_dataset → totals
  const PAGE = 1000;
  let scanned = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.from("fc26_players")
      .select("source_dataset, value_coins_estimate, item_type, attributes")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data?.length) break;
    for (const r of data) {
      const ds = r.source_dataset || "(null)";
      buckets[ds] = buckets[ds] || { rows: 0, withFutbinRid: 0, priced: 0, withImage: 0, withFutbinStats: 0 };
      const b = buckets[ds];
      b.rows++;
      if (r.attributes?.futbin_resource_id) b.withFutbinRid++;
      if (r.value_coins_estimate) b.priced++;
      if (r.attributes?.card_image_url) b.withImage++;
      if (r.attributes?.mains?.pac != null) b.withFutbinStats++;
    }
    scanned += data.length;
    if (data.length < PAGE) break;
    process.stdout.write(`\rscanned ${scanned}...`);
  }
  process.stdout.write("\n\n");

  // Totals
  let grandRows = 0, grandRid = 0, grandPriced = 0, grandImg = 0;
  console.log("by source_dataset:");
  for (const [ds, b] of Object.entries(buckets).sort((a,b) => b[1].rows - a[1].rows)) {
    console.log(`  ${ds}`);
    console.log(`    rows             ${b.rows}`);
    console.log(`    futbin_rid       ${b.withFutbinRid}`);
    console.log(`    priced           ${b.priced}`);
    console.log(`    card image       ${b.withImage}`);
    console.log(`    futbin stats     ${b.withFutbinStats}`);
    grandRows += b.rows; grandRid += b.withFutbinRid; grandPriced += b.priced; grandImg += b.withImage;
  }
  console.log("\nGRAND:");
  console.log(`  total rows            ${grandRows}`);
  console.log(`  with futbin_rid       ${grandRid}   ← these are Futbin-sourced/enriched cards`);
  console.log(`  priced                ${grandPriced}`);
  console.log(`  card image            ${grandImg}`);
})();
