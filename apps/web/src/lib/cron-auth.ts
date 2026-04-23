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
  if (headerSecret && headerSecret === expected) return true;

  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const bearer = auth.slice("Bearer ".length).trim();
    if (bearer === expected) return true;
  }

  return false;
}
