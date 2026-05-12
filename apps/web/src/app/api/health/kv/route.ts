import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { checkCronSecret } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Throwaway KV smoke endpoint — proves Upstash Redis is wired on the
 * deployment. Performs a real set/get/del round-trip on a unique key.
 * Gated by CRON_SECRET so it's not publicly enumerable.
 *
 * Delete after Vercel account migration verified (see MIGRATION.md §1.6).
 */
export async function GET(req: NextRequest) {
  if (!checkCronSecret(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return NextResponse.json(
      {
        kv: "missing",
        reason: "KV_REST_API_URL / KV_REST_API_TOKEN not set on this deployment",
        envSeen: {
          KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
          KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
          UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
          UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
        },
      },
      { status: 200 },
    );
  }

  const redis = new Redis({ url, token });
  const key = `health:kv:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const expected = `ok-${Date.now()}`;
  const t0 = Date.now();

  try {
    await redis.set(key, expected, { ex: 30 });
    const got = await redis.get(key);
    await redis.del(key);
    const roundtripMs = Date.now() - t0;
    return NextResponse.json({
      kv: got === expected ? "ok" : "mismatch",
      roundtripMs,
      got,
      expected,
    });
  } catch (err) {
    return NextResponse.json(
      { kv: "error", error: (err as Error).message ?? String(err) },
      { status: 500 },
    );
  }
}
