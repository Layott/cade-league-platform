"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import {
  setMatchDayScheduleOverride,
  clearMatchDayScheduleOverride,
} from "@/server/squads/schedule_overrides";

/**
 * Server actions powering the per-match-day SCHEDULE override controls
 * on /admin/squads. Admin can shift the Thursday submission deadline +
 * Friday change-window times for a specific match day; the Friday
 * 21:00-22:00 default stays automatic when no override is saved.
 *
 * `gate("squads.window.manage")` handles auth + perm + rate-limit; the
 * underlying server module re-checks the perm too.
 */

function readMatchDayId(formData: FormData): string {
  const raw = formData.get("matchDayId");
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("matchDayId is required");
  }
  if (!/^[0-9a-fA-F-]{32,40}$/.test(raw)) {
    throw new Error("matchDayId must be a uuid");
  }
  return raw;
}

function readNullableTimestamp(
  formData: FormData,
  field: string,
): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Accept either 'YYYY-MM-DDTHH:mm' (HTML datetime-local) or full ISO.
  // Normalize datetime-local (which is naive — no tz) to WAT (Africa/Lagos
  // is +01:00 year-round) so the saved timestamptz reflects what the
  // admin typed in their tz-naive picker.
  let iso = trimmed;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    iso = `${trimmed}:00+01:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    iso = `${trimmed}+01:00`;
  }
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return new Date(ms).toISOString();
}

function readNotes(formData: FormData): string | null {
  const raw = formData.get("notes");
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 400);
}

export async function setScheduleOverrideAction(formData: FormData) {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const matchDayId = readMatchDayId(formData);
  const submissionDeadlineAt = readNullableTimestamp(
    formData,
    "submissionDeadlineAt",
  );
  const changeWindowOpenAt = readNullableTimestamp(
    formData,
    "changeWindowOpenAt",
  );
  const changeWindowCloseAt = readNullableTimestamp(
    formData,
    "changeWindowCloseAt",
  );
  const notes = readNotes(formData);
  await setMatchDayScheduleOverride(
    sb,
    { userId, roles },
    matchDayId,
    {
      submissionDeadlineAt,
      changeWindowOpenAt,
      changeWindowCloseAt,
      notes,
    },
  );
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
  revalidatePath("/player/squad/change");
}

export async function clearScheduleOverrideAction(formData: FormData) {
  const { sb, userId, roles } = await gate("squads.window.manage");
  const matchDayId = readMatchDayId(formData);
  await clearMatchDayScheduleOverride(sb, { userId, roles }, matchDayId);
  revalidatePath("/admin");
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
  revalidatePath("/player/squad/change");
}
