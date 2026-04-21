import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { listByMatchDay } from "@/server/attendance";
import { markAction, editAction, undoAction } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import {
  FormField,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["present", "late", "absent"] as const;

function statusToneClass(
  active: boolean,
  status: "present" | "late" | "absent",
): string {
  if (active) {
    if (status === "present")
      return "border-[var(--signal)] bg-[var(--signal)] text-[var(--signal-ink)]";
    if (status === "late")
      return "border-[var(--amber)] bg-[var(--amber)] text-[#2a1a00]";
    return "border-[var(--flare)] bg-[var(--flare)] text-white";
  }
  if (status === "present")
    return "border-[var(--ink-4)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]";
  if (status === "late")
    return "border-[var(--ink-4)] text-[var(--chalk-2)] hover:border-[var(--amber)] hover:text-[var(--amber)]";
  return "border-[var(--ink-4)] text-[var(--chalk-2)] hover:border-[var(--flare)] hover:text-[var(--flare)]";
}

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const roster = await listByMatchDay(sb, id);

  const { data: md } = await sb
    .from("match_days")
    .select("match_date, match_start_time, arrival_cutoff_time, venue_name")
    .eq("id", id)
    .maybeSingle();

  return (
    <div className="space-y-8" data-testid="attendance-page">
      <SectionHeader
        eyebrow="Roster check"
        title="Attendance"
        description={
          md ? (
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              <span>
                <span className="text-[var(--chalk-1)] tabular">
                  {md.match_date}
                </span>
              </span>
              <span className="text-[var(--ink-5)]">·</span>
              <span>
                Call{" "}
                <span className="text-[var(--chalk-1)] tabular">
                  {String(md.arrival_cutoff_time).slice(0, 5)}
                </span>
              </span>
              <span className="text-[var(--ink-5)]">·</span>
              <span>
                KO{" "}
                <span className="text-[var(--chalk-1)] tabular">
                  {String(md.match_start_time).slice(0, 5)}
                </span>
              </span>
              {md.venue_name ? (
                <>
                  <span className="text-[var(--ink-5)]">·</span>
                  <span>{md.venue_name}</span>
                </>
              ) : null}
            </span>
          ) : undefined
        }
        action={
          <Link href={`/admin/match-days/${id}`}>
            <SecondaryButton type="button">← Back to fixtures</SecondaryButton>
          </Link>
        }
      />

      <div className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
        <table className="w-full text-sm text-[var(--chalk-1)]">
          <thead>
            <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                #
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Player
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Marked
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Penalty
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row, idx) => (
              <tr
                key={row.player_id}
                className={
                  "border-b border-[var(--ink-4)]/70 align-top last:border-b-0 " +
                  (idx % 2 === 1 ? "bg-[var(--ink-3)]/30" : "")
                }
                data-testid={`att-row-${row.player_id}`}
              >
                <td className="px-4 py-3 tabular text-[var(--chalk-2)]">
                  {row.jersey_number ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="font-display text-[15px] font-semibold text-[var(--chalk-0)]">
                    {row.display_name}
                  </div>
                  {row.gamer_tag ? (
                    <div className="text-[11px] font-mono text-[var(--chalk-3)]">
                      {row.gamer_tag}
                    </div>
                  ) : null}
                  <Link
                    href={`/admin/precedents/${row.player_id}`}
                    className="mt-1 inline-block text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)] hover:text-[var(--signal)]"
                    data-testid={`att-precedents-${row.player_id}`}
                  >
                    Precedents →
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {row.status ? (
                    <StatusPill
                      status={row.status}
                      data-testid={`att-status-${row.player_id}`}
                    >
                      {row.status}
                    </StatusPill>
                  ) : (
                    <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                      unmarked
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[11px]">
                  {row.marked_at ? (
                    <div className="space-y-0.5">
                      <div className="font-mono tabular text-[var(--chalk-1)]">
                        {formatWat(row.marked_at, "HH:mm:ss")}
                      </div>
                      <div className="text-[var(--chalk-3)]">
                        {row.marked_by_name ?? "—"}
                      </div>
                    </div>
                  ) : (
                    <span className="text-[var(--chalk-3)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[11px]">
                  {row.auto_action_id ? (
                    <span className="text-[var(--flare)] uppercase tracking-[0.18em] font-semibold">
                      linked
                    </span>
                  ) : row.status && row.status !== "present" ? (
                    <span className="text-[var(--chalk-3)] uppercase tracking-[0.18em]">
                      revoked
                    </span>
                  ) : (
                    <span className="text-[var(--chalk-3)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!row.mark_id ? (
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_OPTIONS.map((s) => (
                        <form action={markAction} key={s}>
                          <input type="hidden" name="matchDayId" value={id} />
                          <input
                            type="hidden"
                            name="playerId"
                            value={row.player_id}
                          />
                          <input type="hidden" name="status" value={s} />
                          <button
                            data-testid={`att-btn-${s}-${row.player_id}`}
                            type="submit"
                            className={
                              "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors " +
                              statusToneClass(false, s)
                            }
                          >
                            {s[0].toUpperCase() + s.slice(1)}
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start gap-3">
                      <details className="relative">
                        <summary
                          data-testid={`att-edit-${row.player_id}`}
                          className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
                        >
                          Edit
                        </summary>
                        <form
                          action={editAction}
                          className="absolute z-10 mt-2 w-72 space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.8)]"
                        >
                          <input type="hidden" name="markId" value={row.mark_id} />
                          <input type="hidden" name="matchDayId" value={id} />
                          <FormField label="New status">
                            <select
                              name="newStatus"
                              aria-label="New status"
                              className={selectClass}
                              defaultValue={row.status ?? "present"}
                            >
                              <option value="present">Present</option>
                              <option value="late">Late</option>
                              <option value="absent">Absent</option>
                            </select>
                          </FormField>
                          <FormField label="Reason" hint="Required, min. 3 chars">
                            <textarea
                              name="reason"
                              required
                              minLength={3}
                              data-testid={`att-reason-${row.player_id}`}
                              className={textareaClass}
                              rows={2}
                            />
                          </FormField>
                          <PrimaryButton type="submit" size="sm" className="w-full">
                            Save edit
                          </PrimaryButton>
                        </form>
                      </details>
                      {row.auto_action_id ? (
                        <form action={undoAction}>
                          <input
                            type="hidden"
                            name="markId"
                            value={row.mark_id}
                          />
                          <input type="hidden" name="matchDayId" value={id} />
                          <button
                            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:underline"
                            type="submit"
                          >
                            Undo penalty
                          </button>
                        </form>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {roster.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-[var(--chalk-3)]"
                >
                  No participants in this season.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
