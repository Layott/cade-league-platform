import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { featureFlags } from "@/lib/feature-flags";
import { mintPsdSignedUrl } from "@/server/overlays/builder/photopea-signed-url";
import { PhotopeaIframe } from "@/components/admin/broadcast/v2/builder/PhotopeaIframe";
import { savePsdFromPhotopeaAction } from "./actions";

/**
 * Wave 2B — `/admin/broadcast/v2/builder/[slug]/psd?assetId=<id>` page.
 *
 * Server component. Perm-gates on `overlay.design.manage`, validates
 * `?assetId` against the live PSD asset, mints a 60-s signed URL,
 * and hands both off to the sandboxed Photopea iframe.
 *
 * Feature-flag gated on `overlayBuilder.photopeaEnabled`. When the
 * flag is off the page 404s — never expose the iframe via a leaked
 * URL outside of explicitly-enabled environments.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ assetId?: string }>;
};

export default async function PsdPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  // 1. Feature-flag gate. When the photopea flag is off we 404 to
  //    hide the surface from anyone who learns the route URL.
  if (
    !featureFlags.overlayBuilder.enabled ||
    !featureFlags.overlayBuilder.photopeaEnabled
  ) {
    notFound();
  }

  // 2. Validate path + query.
  const { slug } = await params;
  const { assetId } = await searchParams;
  if (!slug || !assetId || !UUID_RE.test(assetId)) {
    notFound();
  }

  // 3. Auth + perm gate (re-checked here even though the action also
  //    gates; protects the iframe URL itself).
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth?.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "overlay.design.manage",
    );
  } catch (e) {
    if (e instanceof PermissionError) notFound();
    throw e;
  }

  // 4. Mint the signed URL for the iframe bootstrap.
  let psdSignedUrl: string;
  try {
    psdSignedUrl = await mintPsdSignedUrl(sb, { assetId });
  } catch {
    notFound();
  }

  return (
    <div className="fixed inset-0 z-50">
      <PhotopeaIframe
        assetId={assetId}
        psdSignedUrl={psdSignedUrl}
        saveAction={savePsdFromPhotopeaAction}
      />
    </div>
  );
}
