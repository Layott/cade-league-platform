"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import {
  setPlayerSquadOverride,
  clearPlayerSquadOverride,
} from "@/server/squads/player_override";
import { weekStartThursday } from "@/server/squads/week";

/**
 * Server actions powering per-player squad-window overrides on the admin
 * squads list. Ban / force-open / clear for a specific player in the
 * current week. Audit row emitted by the generic attach_audit trigger
 * on public.player_squad_overrides.
 */

export async function banPlayerForWeekAction(playerId: string, note?: string) {
  const { sb, userId, roles } = await gate("squads.player_override.manage");
  const weekStart = weekStartThursday(new Date());
  await setPlayerSquadOverride(
    sb,
    { userId, roles },
    playerId,
    weekStart,
    "ban",
    note ?? null,
  );
  revalidatePath("/admin/squads");
  revalidatePath("/admin");
  revalidatePath("/player/squad");
}

export async function forceOpenPlayerForWeekAction(playerId: string, note?: string) {
  const { sb, userId, roles } = await gate("squads.player_override.manage");
  const weekStart = weekStartThursday(new Date());
  await setPlayerSquadOverride(
    sb,
    { userId, roles },
    playerId,
    weekStart,
    "force_open",
    note ?? null,
  );
  revalidatePath("/admin/squads");
  revalidatePath("/admin");
  revalidatePath("/player/squad");
}

export async function clearPlayerOverrideAction(playerId: string) {
  const { sb, userId, roles } = await gate("squads.player_override.manage");
  const weekStart = weekStartThursday(new Date());
  await clearPlayerSquadOverride(sb, { userId, roles }, playerId, weekStart);
  revalidatePath("/admin/squads");
  revalidatePath("/admin");
  revalidatePath("/player/squad");
}
