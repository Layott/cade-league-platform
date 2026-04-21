"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import { verify, reject } from "@/server/content";

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

export async function verifyPostAction(formData: FormData): Promise<void> {
  const { sb, userId } = await gate("content.verify");
  const input = parseVerifyPostForm(formData);
  await verify(sb, {
    postId: input.postId,
    verifiedByUserId: userId,
  });
  revalidatePath("/admin/content");
  revalidatePath("/player/content");
}

export async function rejectPostAction(formData: FormData): Promise<void> {
  const { sb, userId } = await gate("content.verify");
  const input = parseRejectPostForm(formData);
  await reject(sb, {
    postId: input.postId,
    verifiedByUserId: userId,
    reason: input.reason,
  });
  revalidatePath("/admin/content");
  revalidatePath("/player/content");
}
