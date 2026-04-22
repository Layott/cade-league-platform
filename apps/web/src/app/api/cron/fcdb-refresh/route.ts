import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { refresh } from "@/server/fcdb/refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Kaggle source may shell out + download; futdb + sofifa paginate with 1s
// gaps. Give ourselves a generous window before Vercel kills the invocation.
export const maxDuration = 300;

/**
 * Plan 24 — nightly FC 26 catalogue refresh.
 *
 * Polled by Vercel Cron (03:00 WAT = 02:00 UTC, see vercel.json). Protected
 * by the shared X-Cron-Secret header — same pattern as the other crons.
 *
 * Returns 200 + diagnostic JSON on every outcome (success, partial, all
 * sources skipped). Never crashes the route — Vercel's retry logic would
 * otherwise loop on transient upstream failures.
 */
async function handle(req: NextRequest) {
  const headerSecret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || headerSecret !== expected) {
    return new NextResponse("Forbidden", { status: 401 });
  }

  const sb = getServiceRoleSupabase();

  try {
    const result = await refresh(sb);
    return NextResponse.json(
      {
        ok: true,
        source: result.source,
        upserted: result.rows_upserted,
        failed: result.rows_failed,
        duration_ms: result.duration_ms,
        error: result.error ?? null,
      },
      { status: 200 },
    );
  } catch (e) {
    // refresh() is designed not to throw, but defense-in-depth: keep
    // the cron idempotent even if something unexpected blows up.
    return NextResponse.json(
      {
        ok: false,
        source: "none",
        upserted: 0,
        failed: 0,
        duration_ms: 0,
        error: (e as Error).message,
      },
      { status: 200 },
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// Convenience: Vercel Cron currently only sends GET. Support both so a
// manual `curl -X POST` also works.
export async function GET(req: NextRequest) {
  return handle(req);
}
