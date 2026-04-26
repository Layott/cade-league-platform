import { redirect } from "next/navigation";

/**
 * Plan 52 — `/admin/broadcast` is now the legacy index path. The
 * canonical broadcast surface is `/admin/broadcast/v2` (the v2 control
 * room shipped in Plan 51). Anything that still links here gets bounced
 * forward, with the optional `?matchDayId=<id>` query passed through so
 * the v2 landing page lands on the same match-day filter the caller asked
 * for.
 *
 * The redirect is permanent at the product level, but Next.js
 * `redirect()` issues a 307 (temporary) to keep the request method
 * intact — sufficient for the GET-only landing path. Nav components
 * (`AdminSubnav`, `NavDrawer`, the admin tile + hero links) have been
 * updated to point at the v2 URL directly so this redirect is a
 * stale-bookmark / external-link safety net rather than a hot path.
 */

export const dynamic = "force-dynamic";

export default async function BroadcastIndexRedirect({
  searchParams,
}: {
  searchParams: Promise<{ matchDayId?: string }>;
}) {
  const sp = await searchParams;
  const target = sp.matchDayId
    ? `/admin/broadcast/v2?matchDayId=${encodeURIComponent(sp.matchDayId)}`
    : "/admin/broadcast/v2";
  redirect(target);
}
