import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate-limit infrastructure (Plan 39 hardening, 2026-04-28).
 *
 * Backed by Upstash Redis via Vercel Marketplace. The env vars
 * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are auto-
 * provisioned when the integration is installed. Without them this
 * module returns a soft-fail limiter that ALWAYS allows — keeps dev
 * + CI usable without Redis but means production MUST set the vars.
 *
 * Three named limiters wrap the shared Redis instance:
 *
 *   `authLimiter` — 5 attempts per 15 min. Used for login, password
 *     reset, account creation. Bound on a compound `${ip}:${email}` key
 *     so an attacker can't trivially bypass by rotating IPs against
 *     one account.
 *
 *   `authedWriteLimiter` — 30 writes per minute, keyed on the
 *     authenticated public user id. Defense against rage-clicks and
 *     scripted abuse from a logged-in actor.
 *
 *   `publicReadLimiter` — 120 reads per minute, keyed on IP. For
 *     unauthenticated overlay feeds + ambient endpoints.
 */

export type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

const ALWAYS_ALLOW: LimitResult = {
  success: true,
  limit: Number.POSITIVE_INFINITY,
  remaining: Number.POSITIVE_INFINITY,
  reset: 0,
};

let warnedNoRedis = false;
function warnNoRedisOnce(): void {
  if (warnedNoRedis) return;
  warnedNoRedis = true;
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — limits soft-fail to allow. Provision Upstash on Vercel Marketplace before going to prod.",
  );
}

function getRedis(): Redis | null {
  // Vercel Marketplace Upstash provisions vars under the KV_* prefix
  // (KV_REST_API_URL, KV_REST_API_TOKEN). Self-hosted Upstash exposes
  // them as UPSTASH_REDIS_REST_*. Accept both.
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    warnNoRedisOnce();
    return null;
  }
  return new Redis({ url, token });
}

function makeLimiter(
  prefix: string,
  factory: (r: Redis) => Ratelimit,
): { limit: (key: string) => Promise<LimitResult> } {
  let cached: Ratelimit | null = null;
  return {
    async limit(key: string): Promise<LimitResult> {
      if (!cached) {
        const r = getRedis();
        if (!r) return ALWAYS_ALLOW;
        cached = factory(r);
      }
      try {
        const res = await cached.limit(`${prefix}:${key}`);
        return {
          success: res.success,
          limit: res.limit,
          remaining: res.remaining,
          reset: res.reset,
        };
      } catch (err) {
        // Soft-fail on Redis hiccup. Better to allow legitimate traffic
        // through than to lock users out due to transient infra. Logs so
        // ops can see the rate of soft-fails.
        console.error("[rate-limit] redis error, soft-failing open", err);
        return ALWAYS_ALLOW;
      }
    },
  };
}

export const authLimiter = makeLimiter("auth", (r) =>
  new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    analytics: true,
    prefix: "rl:auth",
  }),
);

export const authedWriteLimiter = makeLimiter("write", (r) =>
  new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    analytics: true,
    prefix: "rl:write",
  }),
);

export const publicReadLimiter = makeLimiter("read", (r) =>
  new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(120, "1 m"),
    analytics: true,
    prefix: "rl:read",
  }),
);

/**
 * Helper to derive a stable IP key from a Next request / fetch request.
 * Falls back to a placeholder when proxies don't forward (rare on
 * Vercel; X-Forwarded-For is always set for HTTP traffic).
 */
export function ipKeyFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  if (first) return first;
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}
