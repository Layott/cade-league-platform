import { z } from "zod";

export const submitAppealSchema = z.object({
  disciplinaryCaseId: z.string().uuid(),
  submittedByUserId: z.string().uuid(),
  grounds: z.string().trim().min(1).max(4000),
  evidenceUrls: z.array(z.string().url()).max(20).default([]),
});
export type SubmitAppealInput = z.infer<typeof submitAppealSchema>;

export const assignPanelSchema = z.object({
  appealId: z.string().uuid(),
  panelMemberUserIds: z
    .array(z.string().uuid())
    .min(1, "panel must have >=1 member")
    .max(5, "panel cannot exceed 5 members"),
});
export type AssignPanelInput = z.infer<typeof assignPanelSchema>;

export const ruleAppealSchema = z.object({
  appealId: z.string().uuid(),
  ruling: z.string().trim().min(1).max(4000),
});
export type RuleAppealInput = z.infer<typeof ruleAppealSchema>;

export const withdrawAppealSchema = z.object({
  appealId: z.string().uuid(),
  requestedByUserId: z.string().uuid(),
});
export type WithdrawAppealInput = z.infer<typeof withdrawAppealSchema>;
