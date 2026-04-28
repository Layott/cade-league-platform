"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { issue, issueSchema } from "@/server/punishments";
import { notify } from "@/server/notifications";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");

  // Parse + validate every payload value via Zod (no `as`-casts on enum
  // strings — Plan 39 sanitize hardening). The shared issueSchema enforces
  // enum membership, magnitude.max(99), and the effective_* ISO regex; we
  // also re-validate the date strings here so optional fields short-circuit
  // before hitting the schema's optional().
  const playerId = z.string().uuid().parse(String(formData.get("playerId") ?? ""));
  const matchIdRaw = String(formData.get("matchId") ?? "").trim();
  const matchId = matchIdRaw ? z.string().uuid().parse(matchIdRaw) : null;

  const effectiveFromRaw = String(formData.get("effectiveFrom") ?? "").trim();
  const effectiveUntilRaw = String(formData.get("effectiveUntil") ?? "").trim();
  const effectiveFrom = effectiveFromRaw
    ? z.string().regex(ISO_DATE_RE).parse(effectiveFromRaw)
    : undefined;
  const effectiveUntil = effectiveUntilRaw
    ? z.string().regex(ISO_DATE_RE).parse(effectiveUntilRaw)
    : null;

  const issueInput = issueSchema.parse({
    playerId,
    matchId,
    incidentType: String(formData.get("incidentType") ?? ""),
    sanctionType: String(formData.get("sanctionType") ?? ""),
    magnitude: formData.get("magnitude") ?? 0,
    effectiveFrom,
    effectiveUntil,
    publicVisible: formData.get("publicVisible") === "on",
    notes: (formData.get("notes") as string) || undefined,
  });
  const { sanctionType, incidentType, magnitude } = issueInput;

  const { actionId } = await issue(service, pub.id, issueInput);

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

  revalidatePath("/admin/discipline/punishments");
  revalidatePath("/punishments");
  revalidatePath("/profile");
  revalidatePath(`/players/${playerId}`);
  redirect("/admin/discipline/punishments");
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
