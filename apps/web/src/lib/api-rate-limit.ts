import { NextResponse } from "next/server";
import {
  type LimitResult,
  authedWriteLimiter,
  publicReadLimiter,
  ipKeyFromRequest,
} from "./rate-limit";

/**
 * Helpers to apply rate limits at the start of an API route handler
 * and return a `429 Too Many Requests` response if the caller is over
 * budget. Use `enforceLimit(...)` for arbitrary keys; use the convenience
 * wrappers for the common (ip-keyed read) + (userId-keyed write) cases.
 *
 * Returns NextResponse to short-circuit — caller should return early.
 */

function tooManyRequestsResponse(res: LimitResult): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", retryAfterSeconds: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil((res.reset - Date.now()) / 1000))),
        "X-RateLimit-Limit": String(res.limit),
        "X-RateLimit-Remaining": String(Math.max(0, res.remaining)),
        "X-RateLimit-Reset": String(Math.max(0, res.reset)),
      },
    },
  );
}

export async function enforceLimit(
  limiter: { limit: (key: string) => Promise<LimitResult> },
  key: string,
): Promise<NextResponse | null> {
  const res = await limiter.limit(key);
  if (!res.success) return tooManyRequestsResponse(res);
  return null;
}

export async function enforcePublicRead(req: Request): Promise<NextResponse | null> {
  return enforceLimit(publicReadLimiter, ipKeyFromRequest(req));
}

export async function enforceAuthedWrite(userId: string): Promise<NextResponse | null> {
  return enforceLimit(authedWriteLimiter, userId);
}
