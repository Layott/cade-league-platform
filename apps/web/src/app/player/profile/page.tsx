import { redirect } from "next/navigation";

/**
 * 2026-04-28 — Bug #26 redirect stub.
 *
 * `/player/profile` 307s to `/profile` (the canonical rich self-view
 * under the `(auth)` route group). The PlayerSubnav + NavDrawer + admin
 * referer links already point directly at `/profile`, but their JSDoc
 * comments said `/player/profile is preserved as a redirect stub for
 * stale bookmarks` — except the stub was never created, so external
 * deep links + anything still hitting `/player/profile` got a 404.
 *
 * Same redirect-only pattern as the sibling `/player/disputes` →
 * `/player/cases?tab=disputes` shim (UI Audit Slice 2, 2026-04-28) and
 * Plan 52's `/admin/broadcast/<sessionId>` → `/admin/broadcast/v2/...`
 * shim. Next.js's `redirect` from `next/navigation` defaults to a 307
 * (temporary) redirect from a server component, which preserves the
 * request method on POST callers + signals to crawlers that the
 * destination is the canonical route.
 */

export const dynamic = "force-dynamic";

export default async function PlayerProfileRedirect(): Promise<never> {
  redirect("/profile");
}
