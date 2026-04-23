import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  issueAutoWarningForMissed,
  whoMissedDeadline,
  weekStartThursday,
  thursdayDeadline,
} from "@/server/squads";
import { checkCronSecret } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 10 — hourly cron. Polled by Vercel Cron
 * (`Authorization: Bearer $CRON_SECRET`) / GitHub Actions / manual curl
 * (`X-Cron-Secret: …`). Idempotent at the case level
 * (issueAutoWarningForMissed checks marker).
 */
export async function GET(req: NextRequest) {
  if (!checkCronSecret(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const sb = getServiceRoleSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();
  if (!season) {
    return NextResponse.json({ skipped: "no active season" });
  }

  const now = new Date();
  const weekStart = weekStartThursday(now);
  const deadline = thursdayDeadline(weekStart);
  if (now.getTime() < deadline.getTime()) {
    return NextResponse.json({
      skipped: "deadline not passed",
      weekStart,
      deadline: deadline.toISOString(),
    });
  }

  // Reporter id — first admin user, else sentinel.
  const { data: adminRow } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const reporterUserId: string =
    adminRow?.user_id ?? "00000000-0000-0000-0000-000000000000";

  const missed = await whoMissedDeadline(sb, season.id, weekStart);
  const results: Array<{ playerId: string; created: boolean; error?: string }> = [];
  for (const playerId of missed) {
    try {
      const r = await issueAutoWarningForMissed(sb, {
        playerId,
        seasonId: season.id,
        weekStart,
        reporterUserId,
      });
      results.push({ playerId, created: r.created });
    } catch (e) {
      results.push({ playerId, created: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    weekStart,
    missed: missed.length,
    processed: results.length,
    created: results.filter((r) => r.created).length,
    results,
  });
}
