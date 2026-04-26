import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const NOW = new Date().toISOString();
const { data, error, count } = await sb
  .from("match_days")
  .update({ published_at: NOW })
  .is("published_at", null)
  .is("deleted_at", null)
  .select("*", { count: "exact" });
if (error) throw error;
console.log(`Published ${count ?? data?.length ?? 0} match-days`);
for (const d of data ?? []) console.log(`  ${JSON.stringify(d)}`);
