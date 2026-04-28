"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import {
  setMatchDayWindow,
  clearMatchDayWindow,
} from "@/server/squads/match_day_window";

/**
 * Server actions powering the per-match-day squad-window controls in the
 * admin /admin/squads page.
 *
 * Each action reads `match_day_id` (uuid) + optional `state`/`note` from a
 * FormData payload so the controls can submit through standard form posts.
 * The `gate("squads.window.manage")` helper handles auth + perm + rate-
 * limit; the underlying server module re-checks the perm too.
 *
 * Cache busting: revalidate the admin squads page (where the panel lives)
 * + the player squad page (which reads the resolver to render its CTAs).
 */

function readMatchDayId(formData: FormData): string {
  const raw = formData.get("matchDayId");
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("matchDayId is required");
  }
  // Belt-and-braces uuid shape check — the server module would also reject
  // a malformed id but failing fast here gives a clearer error to the UI.
  if (!/^[0-9a-fA-F-]{32,40}$/.test(raw)) {
    throw new Error("matchDayId must be a uuid");
  }
  return raw;
}

function readNote(formData: FormData): string | null {
  const raw = formData.get("note");
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 200);
}

export async function setMatchDayWindowAction(formData: FormData) {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const matchDayId = readMatchDayId(formData);
  const stateRaw = formData.get("state");
  if (stateRaw !== "force_open" && stateRaw !== "force_close") {
    throw new Error("state must be 'force_open' or 'force_close'");
  }
  const note = readNote(formData);
  await setMatchDayWindow(sb, { userId, roles }, matchDayId, stateRaw, note);
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
}

export async function clearMatchDayWindowAction(formData: FormData) {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const matchDayId = readMatchDayId(formData);
  await clearMatchDayWindow(sb, { userId, roles }, matchDayId);
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
}
