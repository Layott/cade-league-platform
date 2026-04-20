import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokeAction } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { DangerButton, SecondaryButton } from "@/components/admin/buttons";
import { FormField, textareaClass } from "@/components/admin/FormField";

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
      `,
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
  const name = row.disciplinary_cases.players.users.display_name;
  const tag = row.disciplinary_cases.players.gamer_tag;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Case file"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{name}</span>
            <StatusPill status={row.sanction_type} className="ml-1" />
            <StatusPill
              status={row.revoked_at ? "revoked" : "active"}
            />
          </span>
        }
        description={
          <span className="text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            {tag} · {row.disciplinary_cases.incident_type.replace(/_/g, " ")}
          </span>
        }
        action={
          <Link href="/admin/punishments">
            <SecondaryButton type="button">← Back to list</SecondaryButton>
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard
          label="Imposed"
          value={formatWat(row.imposed_at, "yyyy-MM-dd · HH:mm")}
        />
        <InfoCard label="Magnitude" value={String(row.magnitude)} tabular />
        <InfoCard label="Effective from" value={row.effective_from} tabular />
        <InfoCard
          label="Effective until"
          value={row.effective_until ?? "—"}
          tabular={!!row.effective_until}
        />
        <InfoCard
          label="Public visible"
          value={row.public_visible ? "Yes" : "No"}
          tone={row.public_visible ? "signal" : "muted"}
        />
        <InfoCard
          label="Status"
          value={row.revoked_at ? "Revoked" : "Active"}
          tone={row.revoked_at ? "muted" : "signal"}
        />
      </div>

      {row.notes ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
            Notes
          </div>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--chalk-1)]">
            {row.notes}
          </p>
        </section>
      ) : null}

      {row.revoked_at ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
            Revoked
          </div>
          <div className="mt-2 font-mono text-[12px] tabular text-[var(--chalk-1)]">
            {formatWat(row.revoked_at, "yyyy-MM-dd · HH:mm")}
          </div>
          {row.revoke_reason ? (
            <p className="mt-2 text-sm text-[var(--chalk-1)]">
              {row.revoke_reason}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--flare)]">
            Revoke this sanction
          </div>
          <p className="mt-1 text-xs text-[var(--chalk-3)]">
            Requires a written reason. Action is logged to the audit trail.
          </p>
          <form action={revokeAction} className="mt-4 space-y-3">
            <input type="hidden" name="actionId" value={row.id} />
            <FormField label="Reason">
              <textarea
                name="reason"
                required
                placeholder="Explain why this sanction is being withdrawn…"
                className={textareaClass}
                rows={3}
              />
            </FormField>
            <DangerButton type="submit">Revoke</DangerButton>
          </form>
        </section>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  tabular,
  tone,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  tone?: "signal" | "muted";
}) {
  return (
    <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div
        className={
          "mt-1 font-display text-base font-semibold " +
          (tone === "signal"
            ? "text-[var(--signal)]"
            : tone === "muted"
              ? "text-[var(--chalk-2)]"
              : "text-[var(--chalk-0)]") +
          (tabular ? " tabular font-mono" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
