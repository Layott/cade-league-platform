import { redirect } from "next/navigation";

/**
 * UI Audit Slice 3 (2026-04-28) — `/admin/youtube-channels` is now the
 * legacy path. The canonical surface is `/admin/broadcast/v2/youtube`,
 * mounted as a sub-tab of the broadcast hub. Anything still pointing
 * here gets bounced forward.
 *
 * Pattern matches `/admin/broadcast/page.tsx` (Plan 52 broadcast v1 → v2
 * redirect). Nav surfaces have been updated to point at the new URL
 * directly so this redirect is a stale-bookmark safety net.
 */

export const dynamic = "force-dynamic";

export default async function YoutubeChannelsRedirect() {
  redirect("/admin/broadcast/v2/youtube");
}
