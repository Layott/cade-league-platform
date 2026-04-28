import { redirect } from "next/navigation";

/** UI Audit Slice 4 (2026-04-28) — moved under Discipline hub. */

export const dynamic = "force-dynamic";

export default async function PrecedentRedirect({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  redirect(`/admin/discipline/precedents/${playerId}`);
}
