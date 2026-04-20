import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publishNow } from "@/server/announcements";

// Polled by Vercel Cron / GitHub Actions / manual curl every ~5 minutes.
// Protected by X-Cron-Secret header matching env CRON_SECRET.
export async function GET(req: NextRequest) {
  const headerSecret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || headerSecret !== expected) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Use service role so we bypass RLS and can publish under an admin-like context.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const now = new Date().toISOString();
  const { data: due, error } = await sb
    .from("announcements")
    .select("id")
    .lt("scheduled_publish_at", now)
    .is("published_at", null)
    .is("deleted_at", null)
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve "cron" publisher id — the first admin user, or a zero UUID sentinel.
  const { data: adminRow } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const publisherId: string = adminRow?.user_id ?? "00000000-0000-0000-0000-000000000000";

  const results: Array<{ id: string; delivered: number; error?: string }> = [];
  for (const row of (due ?? []) as { id: string }[]) {
    try {
      const { delivered } = await publishNow(sb, row.id, publisherId);
      results.push({ id: row.id, delivered });
    } catch (e) {
      results.push({ id: row.id, delivered: 0, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
