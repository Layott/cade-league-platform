"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { createShoot } from "@/server/preseason";
import { parseCreateShootForm } from "./schemas";

export async function createShootAction(formData: FormData): Promise<void> {
  const { sb } = await gate("preseason.manage");
  const input = parseCreateShootForm(formData);
  const row = await createShoot(sb, {
    seasonId: input.seasonId,
    shootDate: input.shootDate,
    type: input.type,
    location: input.location ?? null,
    status: "scheduled",
  });
  revalidatePath("/admin/preseason");
  redirect(`/admin/preseason/${row.id}`);
}
