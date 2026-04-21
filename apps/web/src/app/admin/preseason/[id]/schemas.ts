import { z } from "zod";

/**
 * Plan 13B — preseason attendance save schemas.
 */

export const saveAttendanceFormSchema = z.object({
  shootId: z.string().uuid(),
  playerIds: z
    .array(z.string().uuid())
    .min(0)
    .max(200),
});
export type SaveAttendanceForm = z.infer<typeof saveAttendanceFormSchema>;

export function parseSaveAttendanceForm(fd: FormData): SaveAttendanceForm {
  const shootId = String(fd.get("shootId") ?? "");
  const playerIds = (fd.getAll("playerIds[]") as string[]).filter(Boolean);
  return saveAttendanceFormSchema.parse({ shootId, playerIds });
}
