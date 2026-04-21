import { z } from "zod";

export const submitPostSchema = z.object({
  playerId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be YYYY-MM-DD"),
  platform: z.enum(["twitter", "instagram", "tiktok", "youtube"]),
  postUrl: z.string().trim().url(),
});
export type SubmitPostInput = z.infer<typeof submitPostSchema>;

export const verifyPostSchema = z.object({
  postId: z.string().uuid(),
  verifiedByUserId: z.string().uuid(),
});
export type VerifyPostInput = z.infer<typeof verifyPostSchema>;

export const rejectPostSchema = z.object({
  postId: z.string().uuid(),
  verifiedByUserId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});
export type RejectPostInput = z.infer<typeof rejectPostSchema>;

export const scheduleSessionSchema = z.object({
  matchDayId: z.string().uuid(),
  playerId: z.string().uuid(),
  scheduledTime: z.string(), // ISO timestamp
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type ScheduleSessionInput = z.infer<typeof scheduleSessionSchema>;

export const markSessionAttendanceSchema = z.object({
  sessionId: z.string().uuid(),
  attended: z.boolean(),
});
export type MarkSessionAttendanceInput = z.infer<typeof markSessionAttendanceSchema>;

export const scheduleMakeupSchema = z.object({
  sessionId: z.string().uuid(),
  makeupSessionScheduledAt: z.string(),
});
export type ScheduleMakeupInput = z.infer<typeof scheduleMakeupSchema>;

export const markMakeupAttendanceSchema = z.object({
  sessionId: z.string().uuid(),
  attended: z.boolean(),
});
export type MarkMakeupAttendanceInput = z.infer<typeof markMakeupAttendanceSchema>;
