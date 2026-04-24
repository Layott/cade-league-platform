import { z } from "zod";

export const submitDisputeFormSchema = z
  .object({
    subjectType: z.enum(["match", "sanction", "registration", "other"]),
    subjectId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined))
      .refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "must be uuid"),
    title: z
      .string()
      .trim()
      .min(3, "title must be at least 3 characters")
      .max(200, "title must be at most 200 characters"),
    description: z
      .string()
      .trim()
      .min(20, "description must be at least 20 characters")
      .max(4000),
    evidencePaths: z.array(z.string()).max(3).default([]),
  })
  .refine(
    (v) =>
      (v.subjectType !== "match" && v.subjectType !== "sanction") ||
      (typeof v.subjectId === "string" && v.subjectId.length > 0),
    {
      message: "pick a match or sanction from the dropdown",
      path: ["subjectId"],
    },
  );
export type SubmitDisputeForm = z.infer<typeof submitDisputeFormSchema>;

export function parseSubmitDisputeForm(fd: FormData): SubmitDisputeForm {
  const evidencePaths = (fd.getAll("evidencePaths[]") as string[]).filter(
    Boolean,
  );
  return submitDisputeFormSchema.parse({
    subjectType: fd.get("subjectType"),
    subjectId: fd.get("subjectId"),
    title: fd.get("title"),
    description: fd.get("description"),
    evidencePaths,
  });
}
