"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { issue } from "@/server/punishments";
import { notify } from "@/server/notifications";

export async function createPunishment(formData: FormData) {
  const sb = await getServerSupabase();
  const { data: authData } = await sb.auth.getUser();
  if (!authData.user) redirect("/login");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", authData.user.id)
    .single();
  if (!pub) redirect("/login");

  const { data: rolesRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const service = getServiceRoleSupabase();
  await requirePermAsync(
    service,
    { userId: pub.id, roles },
    "punishments.issue",
  );

  const playerId = String(formData.get("playerId"));
  const sanctionType = formData.get("sanctionType") as
    | "warning"
    | "point_deduction"
    | "gd_deduction"
    | "forfeit"
    | "ban";
  const incidentType = formData.get("incidentType") as
    | "late_arrival"
    | "absent"
    | "forfeit"
    | "equipment"
    | "social_media"
    | "unauthorized_access"
    | "betting"
    | "match_fixing"
    | "dress_code"
    | "other";
  const magnitude = Number(formData.get("magnitude") ?? 0);
  const effectiveFrom = (formData.get("effectiveFrom") as string) || undefined;
  const effectiveUntil = (formData.get("effectiveUntil") as string) || null;

  const { actionId } = await issue(service, pub.id, {
    playerId,
    matchId: (formData.get("matchId") as string) || null,
    incidentType,
    sanctionType,
    magnitude,
    effectiveFrom,
    effectiveUntil,
    publicVisible: formData.get("publicVisible") === "on",
    notes: (formData.get("notes") as string) || undefined,
  });

  // Notify the player. Bans get a richer body mentioning the window.
  try {
    const { data: playerRow } = await service
      .from("players")
      .select("user_id")
      .eq("id", playerId)
      .is("deleted_at", null)
      .maybeSingle();
    const userId = (playerRow as { user_id: string } | null)?.user_id;
    if (userId) {
      const bodyParts: string[] = [];
      bodyParts.push(
        `A ${humanSanction(sanctionType, magnitude)} has been issued for ${humanIncident(incidentType)}.`,
      );
      if (sanctionType === "ban" && effectiveFrom && effectiveUntil) {
        bodyParts.push(
          `Ban runs ${effectiveFrom} through ${effectiveUntil}. Any scheduled matches in that window are being voided.`,
        );
      }
      bodyParts.push("You may file an appeal from /player/appeals.");
      await notify(service, {
        userId,
        kind: "punishment_issued",
        title: "A punishment has been issued",
        body: bodyParts.join(" "),
        href: "/profile",
        metadata: {
          actionId,
          playerId,
          sanctionType,
          incidentType,
          magnitude,
          effectiveFrom: effectiveFrom ?? null,
          effectiveUntil: effectiveUntil ?? null,
        },
      });
    }
  } catch (err) {
    console.error(`[notifications] punishment_issued fan-out failed: ${String(err)}`);
  }

  revalidatePath("/admin/punishments");
  revalidatePath("/punishments");
  revalidatePath("/profile");
  revalidatePath(`/players/${playerId}`);
  redirect("/admin/punishments");
}

function humanSanction(kind: string, magnitude: number): string {
  switch (kind) {
    case "warning":
      return "warning";
    case "point_deduction":
      return `${magnitude}-point deduction`;
    case "gd_deduction":
      return `${magnitude}-goal GD deduction`;
    case "forfeit":
      return "forfeit";
    case "ban":
      return "ban";
    default:
      return `${kind} sanction`;
  }
}

function humanIncident(kind: string): string {
  return kind.replace(/_/g, " ");
}
