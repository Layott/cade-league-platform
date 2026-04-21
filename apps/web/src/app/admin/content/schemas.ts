import { z } from "zod";

export const verifyPostFormSchema = z.object({
  postId: z.string().uuid(),
});
export const rejectPostFormSchema = z.object({
  postId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(10, "reason must be at least 10 characters")
    .max(1000),
});
export type VerifyPostForm = z.infer<typeof verifyPostFormSchema>;
export type RejectPostForm = z.infer<typeof rejectPostFormSchema>;

export function parseVerifyPostForm(fd: FormData): VerifyPostForm {
  return verifyPostFormSchema.parse({ postId: fd.get("postId") });
}
export function parseRejectPostForm(fd: FormData): RejectPostForm {
  return rejectPostFormSchema.parse({
    postId: fd.get("postId"),
    reason: fd.get("reason"),
  });
}
