import { redirect } from "next/navigation";

/** UI Audit Slice 4 (2026-04-28) — moved under Discipline hub. */

export const dynamic = "force-dynamic";

export default async function DisputeDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/discipline/disputes/${id}`);
}
