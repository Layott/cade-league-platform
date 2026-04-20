import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PunishmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `
      id, sanction_type, magnitude, imposed_at, effective_from, effective_until,
      notes, revoked_at, revoke_reason, public_visible,
      disciplinary_cases!inner (
        id, incident_type, match_id,
        players!inner (
          id, gamer_tag,
          users!inner ( display_name )
        )
      )
      `
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) notFound();

  type Row = {
    id: string;
    sanction_type: string;
    magnitude: number;
    imposed_at: string;
    effective_from: string;
    effective_until: string | null;
    notes: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
    public_visible: boolean;
    disciplinary_cases: {
      id: string;
      incident_type: string;
      match_id: string | null;
      players: {
        id: string;
        gamer_tag: string;
        users: { display_name: string };
      };
    };
  };
  const row = data as unknown as Row;

  return (
    <div className="space-y-6">
      <Link href="/admin/punishments" className="text-sm text-slate-500 hover:underline">
        ← Back to list
      </Link>

      <h2 className="text-2xl font-bold">
        {row.sanction_type} · {row.disciplinary_cases.players.users.display_name}
      </h2>

      <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
        <dt className="text-slate-500">Imposed</dt>
        <dd>{formatWat(row.imposed_at, "yyyy-MM-dd HH:mm")}</dd>
        <dt className="text-slate-500">Incident</dt>
        <dd>{row.disciplinary_cases.incident_type}</dd>
        <dt className="text-slate-500">Magnitude</dt>
        <dd>{row.magnitude}</dd>
        <dt className="text-slate-500">Effective from</dt>
        <dd>{row.effective_from}</dd>
        <dt className="text-slate-500">Effective until</dt>
        <dd>{row.effective_until ?? "—"}</dd>
        <dt className="text-slate-500">Public visible</dt>
        <dd>{row.public_visible ? "yes" : "no"}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd>{row.revoked_at ? "revoked" : "active"}</dd>
        {row.revoked_at ? (
          <>
            <dt className="text-slate-500">Revoked at</dt>
            <dd>{formatWat(row.revoked_at, "yyyy-MM-dd HH:mm")}</dd>
            <dt className="text-slate-500">Revoke reason</dt>
            <dd>{row.revoke_reason ?? "—"}</dd>
          </>
        ) : null}
        <dt className="text-slate-500">Notes</dt>
        <dd className="whitespace-pre-line">{row.notes ?? "—"}</dd>
      </dl>

      {!row.revoked_at ? (
        <form action={revokeAction} className="space-y-3 border-t pt-6">
          <h3 className="font-semibold">Revoke this punishment</h3>
          <input type="hidden" name="actionId" value={row.id} />
          <textarea
            name="reason"
            required
            placeholder="Reason for revoking (required)"
            className="w-full border rounded px-3 py-2 text-sm"
            rows={2}
          />
          <button type="submit" className="bg-red-600 text-white rounded px-3 py-2 text-sm">
            Revoke
          </button>
        </form>
      ) : null}
    </div>
  );
}
