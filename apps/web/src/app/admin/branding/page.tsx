import { redirect } from "next/navigation";

/**
 * UI Audit Slice 3 (2026-04-28) — `/admin/branding` is now the legacy
 * path. The canonical surface is `/admin/broadcast/v2/branding`, mounted
 * as a sub-tab of the broadcast hub. Anything still pointing here gets
 * bounced forward.
 *
 * Pattern matches `/admin/broadcast/page.tsx` (Plan 52 broadcast v1 → v2
 * redirect). Nav surfaces (`AdminSubnav`, `NavDrawer`, the admin tile
 * grid) have been updated to point at the new URL directly so this
 * redirect is a stale-bookmark / external-link safety net.
 */

export const dynamic = "force-dynamic";

export default async function BrandingRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const target = sp.tab
    ? `/admin/broadcast/v2/branding?tab=${encodeURIComponent(sp.tab)}`
    : "/admin/broadcast/v2/branding";
  redirect(target);
}
