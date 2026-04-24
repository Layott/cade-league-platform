import { formatWat } from "@/lib/time";

/**
 * Linkage audit slice (2026-04-24) — render a player's attendance_marks
 * grouped by match_day. Used on:
 *
 *   - `/profile` (player self-view) — mounts without an admin gate.
 *   - `/players/[id]` — admin-gated at the page level via
 *     `requirePermAsync(svc, actor, "attendance.mark")`.
 *
 * Rows pass in pre-flattened from the server read; the component stays
 * pure-render. Empty state returns an inline "No attendance yet this
 * season." message — do NOT swallow the whole section (UI invariant
 * helps the player confirm the widget is rendering at all).
 */

export type AttendanceRow = {
  id: string;
  matchDayId: string;
  matchDate: string; // YYYY-MM-DD
  status: "present" | "late" | "absent";
  markedAt: string; // ISO
  overrideReason: string | null;
};

export function AttendancePanel({
  rows,
  title = "Attendance",
  emptyHint = "No attendance marks yet this season.",
  testId = "attendance-panel",
}: {
  rows: AttendanceRow[];
  title?: string;
  emptyHint?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
    >
      <header className="flex items-end justify-between gap-3 border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
            Attendance
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
            {title}
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          {rows.length} {rows.length === 1 ? "mark" : "marks"}
        </span>
      </header>
      {rows.length === 0 ? (
        <div
          data-testid={`${testId}-empty`}
          className="px-5 py-10 text-center text-sm text-[var(--chalk-3)]"
        >
          {emptyHint}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--ink-4)]">
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`attendance-row-${r.matchDayId}`}
              className="flex items-center gap-4 px-5 py-3"
            >
              <span className="w-24 font-mono text-[11px] tabular text-[var(--chalk-1)]">
                {r.matchDate}
              </span>
              <AttendancePill status={r.status} />
              <span className="ml-auto font-mono text-[10px] text-[var(--chalk-3)] tabular">
                {safeTime(r.markedAt)}
              </span>
              {r.overrideReason ? (
                <span
                  title={r.overrideReason}
                  className="max-w-[14rem] truncate text-[11px] italic text-[var(--chalk-2)]"
                >
                  Note: {r.overrideReason}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttendancePill({ status }: { status: AttendanceRow["status"] }) {
  const cfg =
    status === "present"
      ? {
          cls:
            "border-[var(--signal)]/50 bg-[var(--signal)]/10 text-[var(--signal)]",
          label: "Present",
        }
      : status === "late"
        ? {
            cls:
              "border-[var(--amber)]/50 bg-[var(--amber)]/10 text-[var(--amber)]",
            label: "Late",
          }
        : {
            cls: "border-[#ff8794]/50 bg-[#ff8794]/10 text-[#ffa3b0]",
            label: "Absent",
          };
  return (
    <span
      data-attendance-pill={status}
      className={
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] " +
        cfg.cls
      }
    >
      {cfg.label}
    </span>
  );
}

function safeTime(iso: string): string {
  try {
    return formatWat(iso, "HH:mm");
  } catch {
    return iso.slice(11, 16);
  }
}
