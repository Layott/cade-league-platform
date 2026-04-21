"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { verify, reject } from "@/server/content";
import { parseVerifyPostForm, parseRejectPostForm } from "./schemas";

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
