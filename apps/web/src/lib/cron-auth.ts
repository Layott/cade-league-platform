import { timingSafeEqual } from "crypto";

/**
 * Constant-time secret comparison so a remote attacker cannot leak the
 * expected secret via response-time differential analysis. Length
 * mismatch returns false without calling `timingSafeEqual` (which
 * throws on length mismatch).
 */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Shared cron-auth gate. Accepts either:
 *   - `X-Cron-Secret: <secret>` (legacy manual curl / GitHub Actions invokers)
 *   - `Authorization: Bearer <secret>` (Vercel Cron's default)
 *
 * Both forms must match `process.env.CRON_SECRET`. Returns true when
 * authorised; caller returns 401/403 when false.
 */
export function checkCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret && secretsMatch(headerSecret, expected)) return true;

  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const bearer = auth.slice("Bearer ".length).trim();
    if (secretsMatch(bearer, expected)) return true;
  }

  return false;
}
