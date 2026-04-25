import Link from "next/link";
import { resolveTabGate } from "../_components/helpers";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Adjustments tab.
 *
 * Per spec §8 Q6: this tab is a deep-link card pointing to the canonical
 * `/admin/punishments` console. Below the card we show the 5 most recent
 * disciplinary_actions as a quick reference so the admin doesn't have to
 * round-trip just to confirm a sanction landed.
 *
 * The actions table has no direct player_id — it joins through
 * `disciplinary_cases.player_id`. Magnitude semantics depend on
 * sanction_type: point_deduction = pts subtracted, gd_deduction = GD
 * subtracted, ban/forfeit/warning = no numeric impact.
 */

type RecentAction = {
  id: string;
  sanction_type: string;
  magnitude: number;
  imposed_at: string;
  player_label: string;
};

export default async function AdjustmentsPage() {
  const { svc } = await resolveTabGate("tournament.read");

  const { data, error } = await svc
    .from("disciplinary_actions")
    .select(
      `
      id, sanction_type, magnitude, imposed_at, revoked_at,
      case:case_id (
        id,
        player:player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) )
      )
      `,
    )
    .is("deleted_at", null)
    .is("revoked_at", null)
    .order("imposed_at", { ascending: false })
    .limit(5);

  // disciplinary_actions table may have RLS gates that 401/403 for non-admin
  // viewers — degrade gracefully into "no recent" rather than throwing the
  // whole tab.
  type Raw = {
    id: string;
    sanction_type: string;
    magnitude: number | null;
    imposed_at: string;
    case:
      | {
          player:
            | {
                id: string;
                gamer_tag: string;
                users: { display_name: string | null } | null;
              }
            | {
                id: string;
                gamer_tag: string;
                users: { display_name: string | null } | null;
              }[]
            | null;
        }
      | {
          player:
            | {
                id: string;
                gamer_tag: string;
                users: { display_name: string | null } | null;
              }
            | {
                id: string;
                gamer_tag: string;
                users: { display_name: string | null } | null;
              }[]
            | null;
        }[]
      | null;
  };

  const firstOrNull = <T,>(v: T | T[] | null | undefined): T | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0] ?? null;
    return v;
  };

  const rows: RecentAction[] = error
    ? []
    : ((data ?? []) as unknown as Raw[]).map((r) => {
        const c = firstOrNull(r.case);
        const p = firstOrNull(c?.player ?? null);
        return {
          id: r.id,
          sanction_type: r.sanction_type,
          magnitude: r.magnitude ?? 0,
          imposed_at: r.imposed_at,
          player_label:
            p?.users?.display_name ?? p?.gamer_tag ?? "(unknown)",
        };
      });

  return (
    <section className="space-y-6" data-testid="tournament-tab-adjustments">
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Adjustments
        </div>
        <p className="text-[12px] text-[var(--chalk-2)]">
          Numeric adjustments to standings (point/GD deductions, bans) live in
          the canonical Punishments console. This tab is a shortcut + recent
          summary.
        </p>
      </header>

      <Link
        href="/admin/punishments"
        className="block rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 transition-colors hover:border-[var(--signal)] hover:bg-[var(--ink-3)]"
        data-testid="adjustments-cta"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="font-display text-[15px] font-semibold text-[var(--chalk-0)]">
              Open Punishments console →
            </div>
            <p className="text-[12px] text-[var(--chalk-2)]">
              Issue point/GD deductions, bans, and warnings. The disciplinary
              system writes to{" "}
              <code className="text-[var(--chalk-1)]">disciplinary_actions</code>{" "}
              and recomputes standings automatically.
            </p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
            /admin/punishments
          </span>
        </div>
      </Link>

      <section className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Recent ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-6 text-center text-[12px] text-[var(--chalk-3)]">
            No recent disciplinary actions.
          </div>
        ) : (
          <ul
            className="divide-y divide-[var(--ink-4)] overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
            data-testid="adjustments-recent"
          >
            {rows.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3"
              >
                <div className="space-y-0.5">
                  <div className="font-display text-[13px] font-semibold text-[var(--chalk-0)]">
                    {r.player_label}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    {r.sanction_type.replace(/_/g, " ")}
                  </div>
                </div>
                <div className="font-mono text-[11px] tabular text-[var(--chalk-2)]">
                  {magnitudeLabel(r.sanction_type, r.magnitude)}
                </div>
                <div className="font-mono text-[10px] tabular text-[var(--chalk-3)]">
                  {formatWat(r.imposed_at, "yyyy-MM-dd HH:mm")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function magnitudeLabel(type: string, magnitude: number): string {
  if (type === "point_deduction") return `-${magnitude}pts`;
  if (type === "gd_deduction") return `-${magnitude}GD`;
  if (type === "ban") return `${magnitude}-day ban`;
  if (type === "forfeit") return `forfeit`;
  if (type === "warning") return `warning`;
  return `${magnitude}`;
}
