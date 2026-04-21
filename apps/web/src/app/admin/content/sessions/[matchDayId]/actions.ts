"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import {
  markAttendance,
  scheduleMakeup,
  markMakeupAttendance,
} from "@/server/content";

/**
 * Plan 13B — batch save action for content sessions. Iterates per-row and
 * continues on per-row failure (spec §5.4: partially-idempotent accepted
 * for admin-only surface). Returns nothing; UI revalidates to surface
 * errors via server render.
 */

const sessionRowSchema = z.object({
  sessionId: z.string().uuid(),
  attended: z.enum(["0", "1"]).transform((v) => v === "1"),
  makeupAt: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  makeupAttended: z.enum(["0", "1"]).transform((v) => v === "1"),
});

export async function saveSessionsAction(formData: FormData): Promise<void> {
  const { sb } = await gate("content.verify");
  const matchDayId = String(formData.get("matchDayId") ?? "");
  if (!matchDayId) throw new Error("matchDayId required");

  const ids = (formData.getAll("sessionIds[]") as string[]).filter(Boolean);

  for (const sessionId of ids) {
    try {
      const row = sessionRowSchema.parse({
        sessionId,
        attended: formData.get(`attended.${sessionId}`) ?? "0",
        makeupAt: formData.get(`makeupAt.${sessionId}`) ?? "",
        makeupAttended: formData.get(`makeupAttended.${sessionId}`) ?? "0",
      });
      await markAttendance(sb, {
        sessionId: row.sessionId,
        attended: row.attended,
      });
      if (!row.attended && row.makeupAt) {
        await scheduleMakeup(sb, {
          sessionId: row.sessionId,
          makeupSessionScheduledAt: row.makeupAt,
        });
      }
      if (row.makeupAttended) {
        await markMakeupAttendance(sb, {
          sessionId: row.sessionId,
          attended: true,
        });
      }
    } catch {
      // Continue on per-row failure. Admin will re-save. Server module
      // is idempotent so retries are safe.
    }
  }
  revalidatePath(`/admin/content/sessions/${matchDayId}`);
}
