import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/perms";

type GetActorOpts = {
  userId: string;
};

export async function getActorFromSession(
  supabase: SupabaseClient,
  opts?: GetActorOpts
): Promise<Actor | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  if (!opts) {
    return { userId: null, roles: [] };
  }

  const { data: rolesData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", opts.userId)
    .is("deleted_at", null);

  const roles = (rolesData ?? []).map((r: { role: string }) => r.role);
  return { userId: opts.userId, roles };
}
