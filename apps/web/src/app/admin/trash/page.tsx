import { redirect } from "next/navigation";
import { TRASH_ENTITY_KEYS } from "@/server/trash/entities";

export default function TrashIndexPage() {
  const first = TRASH_ENTITY_KEYS[0];
  redirect(`/admin/trash/${first}`);
}
