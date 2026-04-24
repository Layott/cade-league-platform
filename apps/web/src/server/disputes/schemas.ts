import { z } from "zod";

export const submitDisputeSchema = z
  .object({
    raisedByUserId: z.string().uuid(),
    subjectType: z.enum(["match", "sanction", "registration", "other"]),
    subjectId: z.string().uuid().optional().nullable(),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(1).max(4000),
    evidenceUrls: z.array(z.string().url()).max(20).default([]),
  })
  .refine(
    (v) =>
      (v.subjectType !== "match" && v.subjectType !== "sanction") ||
      (typeof v.subjectId === "string" && v.subjectId.length > 0),
    {
      message: "subjectId is required for match and sanction disputes",
      path: ["subjectId"],
    },
  );
export type SubmitDisputeInput = z.infer<typeof submitDisputeSchema>;

export const assignDisputeSchema = z.object({
  disputeId: z.string().uuid(),
  assignedToUserId: z.string().uuid(),
});
export type AssignDisputeInput = z.infer<typeof assignDisputeSchema>;

export const ruleDisputeSchema = z.object({
  disputeId: z.string().uuid(),
  ruling: z.string().trim().min(1).max(4000),
});
export type RuleDisputeInput = z.infer<typeof ruleDisputeSchema>;

export const withdrawDisputeSchema = z.object({
  disputeId: z.string().uuid(),
  requestedByUserId: z.string().uuid(),
});
export type WithdrawDisputeInput = z.infer<typeof withdrawDisputeSchema>;
