"use server";

import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { submitPost } from "@/server/content";
import { parseSubmitPostForm } from "./schemas";

export async function submitPostAction(formData: FormData): Promise<void> {
  const { sb } = await gate("content.submit");
  const input = parseSubmitPostForm(formData);
  await submitPost(sb, input);
  revalidatePath("/player/content");
  revalidatePath("/admin/content");
}
