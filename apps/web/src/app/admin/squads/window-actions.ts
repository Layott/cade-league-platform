"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import {
  setSquadWindowOverride,
  clearSquadWindowOverride,
} from "@/server/squads/window_override";
import { weekStartThursday } from "@/server/squads/week";

/**
 * Server actions powering the admin dashboard's squad-window controls.
 *
 * Admin/loc/referee can force the current week's submission window open
 * or shut. Clearing the override reverts to the time-based default.
 * Every action emits an audit row via the generic attach_audit trigger
 * on public.squad_window_overrides.
 */

export async function forceOpenSquadWindowAction(note?: string) {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const weekStart = weekStartThursday(new Date());
  await setSquadWindowOverride(
    sb,
    { userId, roles },
    weekStart,
    "force_open",
    note ?? null,
  );
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
}

export async function forceCloseSquadWindowAction(note?: string) {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const weekStart = weekStartThursday(new Date());
  await setSquadWindowOverride(
    sb,
    { userId, roles },
    weekStart,
    "force_close",
    note ?? null,
  );
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
}

export async function clearSquadWindowOverrideAction() {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const weekStart = weekStartThursday(new Date());
  await clearSquadWindowOverride(sb, { userId, roles }, weekStart);
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
}
