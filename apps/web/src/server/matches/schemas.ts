import { z } from "zod";

export const createMatchDaySchema = z.object({
  seasonId: z.string().uuid(),
  matchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  arrivalCutoffTime: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM"),
  matchStartTime: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM"),
  venueName: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateMatchDayInput = z.infer<typeof createMatchDaySchema>;

export const createMatchSchema = z
  .object({
    matchDayId: z.string().uuid(),
    homePlayerId: z.string().uuid(),
    awayPlayerId: z.string().uuid(),
    scheduledTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.homePlayerId !== v.awayPlayerId, {
    message: "home and away cannot be the same player",
    path: ["awayPlayerId"],
  });
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

const scoreField = z.coerce.number().int().nonnegative().max(99);
const possessionField = z.coerce.number().int().min(0).max(100).optional();

export const enterResultSchema = z.object({
  matchId: z.string().uuid(),
  homeScore: scoreField,
  awayScore: scoreField,
  homePossession: possessionField,
  awayPossession: possessionField,
  resultType: z.enum(["normal", "forfeit", "void"]).default("normal"),
  notes: z.string().trim().max(2000).optional(),
});
export type EnterResultInput = z.infer<typeof enterResultSchema>;

export const confirmResultSchema = z.object({
  matchId: z.string().uuid(),
});
export type ConfirmResultInput = z.infer<typeof confirmResultSchema>;
