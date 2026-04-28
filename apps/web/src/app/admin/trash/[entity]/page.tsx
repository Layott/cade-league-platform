import { redirect } from "next/navigation";

/** UI Audit Slice 4 (2026-04-28) — moved under System hub. */

export const dynamic = "force-dynamic";

export default async function TrashEntityRedirect({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  redirect(`/admin/system/trash/${entity}`);
}
