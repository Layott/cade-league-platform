"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { bulkSaveMatrix } from "@/server/roles";
import { bulkSaveMatrixSchema } from "@/server/roles/schemas";

async function resolveAdminActor() {
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
  // Second gate — never trust the page gate alone (spec §8 Risk 3).
  await requirePermAsync(sb, { userId: pub.id, roles }, "roles.edit");
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
  return { sb, actorUserId: pub.id as string };
}

export async function saveMatrixAction(formData: FormData) {
  const raw = formData.get("diff");
  if (typeof raw !== "string") throw new Error("missing diff payload");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("diff payload is not valid JSON");
  }

  const input = bulkSaveMatrixSchema.parse(parsed);
  const { sb, actorUserId } = await resolveAdminActor();
  await bulkSaveMatrix(sb, input, actorUserId);
  revalidatePath("/admin/roles");
}
