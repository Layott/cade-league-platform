import type { SupabaseClient } from "@supabase/supabase-js";

export async function getUnreadCountForAuthUser(sb: SupabaseClient): Promise<number> {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return 0;
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .single();
  if (!pub) return 0;

  const { count } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .is("read_at", null);
  return count ?? 0;
}
