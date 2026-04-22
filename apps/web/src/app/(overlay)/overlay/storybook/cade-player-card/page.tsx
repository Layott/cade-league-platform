import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import {
  listPlayerSlugs,
  getPlayerDisplayName,
} from "@/server/overlays/players";
import { CadePlayerCardStory } from "./CadePlayerCardStory";

export const dynamic = "force-dynamic";

/**
 * Plan 22 — admin-gated storybook for the CadePlayerCard component.
 * Renders 7 rarities x 4 sizes plus a row populated from the real
 * 13-player manifest. Gate: broadcast.manage.
 *
 * Path note: the App Router treats `_`-prefixed folders as private, so
 * this page lives under `/overlay/storybook/cade-player-card` rather
 * than the originally proposed `_storybook/`.
 */
async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
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
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "broadcast.manage");
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
}

export default async function CadePlayerCardStoryPage() {
  await resolveAdmin();
  const players = listPlayerSlugs().map((slug) => ({
    slug,
    displayName: getPlayerDisplayName(slug) ?? slug,
    photoUrl: `/players/${slug}/headshot_01.png`,
  }));
  return <CadePlayerCardStory players={players} />;
}
