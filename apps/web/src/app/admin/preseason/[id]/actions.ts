"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { markAttendance, cancelShoot, completeShoot } from "@/server/preseason";
import { parseSaveAttendanceForm } from "./schemas";

/**
 * Plan 13B — preseason attendance save. Iterates per-player, skipping
 * rows on failure. `markAttendance` is idempotent so retries are safe.
 */

export async function saveAttendanceAction(formData: FormData): Promise<void> {
  const { sb, userId } = await gate("preseason.manage");
  const input = parseSaveAttendanceForm(formData);
  for (const playerId of input.playerIds) {
    const attended = formData.get(`attended.${playerId}`) === "1";
    const notes = String(formData.get(`notes.${playerId}`) ?? "").trim();
    try {
      await markAttendance(sb, {
        shootId: input.shootId,
        playerId,
        attended,
        actorUserId: userId,
        notes: notes.length > 0 ? notes : null,
      });
    } catch {
      // Continue — idempotent; admin re-saves.
    }
  }
  revalidatePath(`/admin/preseason/${input.shootId}`);
}

export async function cancelShootAction(formData: FormData): Promise<void> {
  const { sb } = await gate("preseason.manage");
  const shootId = String(formData.get("shootId") ?? "");
  if (!shootId) throw new Error("shootId required");
  await cancelShoot(sb, shootId);
  revalidatePath(`/admin/preseason/${shootId}`);
  revalidatePath("/admin/preseason");
}

export async function completeShootAction(formData: FormData): Promise<void> {
  const { sb } = await gate("preseason.manage");
  const shootId = String(formData.get("shootId") ?? "");
  if (!shootId) throw new Error("shootId required");
  await completeShoot(sb, shootId);
  revalidatePath(`/admin/preseason/${shootId}`);
  revalidatePath("/admin/preseason");
}
