import { z } from "zod";

export const createShootSchema = z.object({
  seasonId: z.string().uuid(),
  shootDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["photo", "video", "interview"]),
  location: z.string().trim().max(500).optional().nullable(),
  status: z.enum(["scheduled", "completed", "cancelled"]).default("scheduled"),
});
export type CreateShootInput = z.infer<typeof createShootSchema>;

export const updateShootSchema = z.object({
  id: z.string().uuid(),
  shootDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["photo", "video", "interview"]).optional(),
  location: z.string().trim().max(500).optional().nullable(),
  status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
});
export type UpdateShootInput = z.infer<typeof updateShootSchema>;

export const markShootAttendanceSchema = z.object({
  shootId: z.string().uuid(),
  playerId: z.string().uuid(),
  attended: z.boolean(),
  actorUserId: z.string().uuid(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type MarkShootAttendanceInput = z.infer<typeof markShootAttendanceSchema>;
