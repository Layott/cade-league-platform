import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SID = "8018f9e3-2018-4532-a6c0-6418463be0db";
const { data: sess, error: e1 } = await sb.from("stream_sessions").select("id, match_day_id").eq("id", SID).is("deleted_at", null).maybeSingle();
console.log("session:", sess, "err:", e1);
const MD = sess?.match_day_id;
const { data: matches, error: e3 } = await sb.from("matches").select("id, scheduled_time, status, home_player:home_player_id (gamer_tag, users:users!players_user_id_fkey ( display_name )), away_player:away_player_id (gamer_tag, users:users!players_user_id_fkey ( display_name )), match_results (home_score, away_score, result_type, confirmed_at)").eq("match_day_id", MD).is("deleted_at", null);
console.log("matches count:", matches?.length, "err:", e3);
if (matches?.[0]) console.log("first:", JSON.stringify(matches[0], null, 2));
