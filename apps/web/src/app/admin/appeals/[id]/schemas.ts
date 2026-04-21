import { z } from "zod";

/**
 * Plan 13B — /admin/appeals/[id] form schemas. Split from `actions.ts`
 * because Next.js rejects non-async exports from "use server" modules.
 * Panel size required: exactly 3 members per spec §5.3 for Phase 1; the
 * server module still accepts 1..5 for forward-compat.
 */

export const assignPanelFormSchema = z
  .object({
    appealId: z.string().uuid(),
    member1: z.string().uuid("pick panel member 1"),
    member2: z.string().uuid("pick panel member 2"),
    member3: z.string().uuid("pick panel member 3"),
  })
  .superRefine((d, ctx) => {
    const members = [d.member1, d.member2, d.member3];
    const uniq = new Set(members);
    if (uniq.size !== 3) {
      ctx.addIssue({
        code: "custom",
        message: "panel members must be distinct",
        path: ["member3"],
      });
    }
  });
export type AssignPanelForm = z.infer<typeof assignPanelFormSchema>;

export function parseAssignPanelForm(fd: FormData): AssignPanelForm {
  return assignPanelFormSchema.parse({
    appealId: fd.get("appealId"),
    member1: fd.get("member1"),
    member2: fd.get("member2"),
    member3: fd.get("member3"),
  });
}

export const ruleAppealFormSchema = z.object({
  appealId: z.string().uuid(),
  ruling: z.string().trim().min(1, "ruling required").max(4000),
});
export type RuleAppealForm = z.infer<typeof ruleAppealFormSchema>;

export function parseRuleAppealForm(fd: FormData): RuleAppealForm {
  return ruleAppealFormSchema.parse({
    appealId: fd.get("appealId"),
    ruling: fd.get("ruling"),
  });
}
