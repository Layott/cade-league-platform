import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { publishNow } from "@/server/announcements";
import { checkCronSecret } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Polled by Vercel Cron (`Authorization: Bearer $CRON_SECRET`) / GitHub
// Actions / manual curl (`X-Cron-Secret: …`) every ~5 minutes.
export async function GET(req: NextRequest) {
  if (!checkCronSecret(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Service role bypasses RLS so cron can publish under an admin-like context.
  const sb = getServiceRoleSupabase();

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

  // Resolve a "cron" publisher id — the first admin user, or a zero UUID sentinel.
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
