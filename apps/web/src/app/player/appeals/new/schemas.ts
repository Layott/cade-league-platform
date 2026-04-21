import { z } from "zod";

export const submitAppealFormSchema = z.object({
  caseId: z.string().uuid("caseId required"),
  grounds: z
    .string()
    .trim()
    .min(40, "grounds must be at least 40 characters")
    .max(4000),
  evidencePaths: z.array(z.string()).max(3).default([]),
});
export type SubmitAppealForm = z.infer<typeof submitAppealFormSchema>;

export function parseSubmitAppealForm(fd: FormData): SubmitAppealForm {
  const evidencePaths = (fd.getAll("evidencePaths[]") as string[]).filter(
    Boolean,
  );
  return submitAppealFormSchema.parse({
    caseId: fd.get("caseId"),
    grounds: fd.get("grounds"),
    evidencePaths,
  });
}
