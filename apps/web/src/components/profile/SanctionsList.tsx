import { formatWat } from "@/lib/time";
import { AppealButton } from "./AppealButton";

/**
 * Sanction types covered by this component.
 *
 * Plan 41 §6 extends the Plan 11 set. The DB today stores a subset
 * (warning/point_deduction/gd_deduction/forfeit/ban); the new values
 * (formal_warning, suspension, auto_forfeit, fine) are the Plan 41
 * extensions. We accept any of the union so the component doesn't have
 * to be re-amended when the DB enum widens.
 */
export type SanctionType =
  | "warning"
  | "formal_warning"
  | "suspension"
  | "point_deduction"
  | "points_deduction"
  | "gd_deduction"
  | "forfeit"
  | "auto_forfeit"
  | "ban"
  | "fine";

// TODO (plan 41 P41-D): import from server/profile/playerStats or server/sanctions/read
export type Sanction = {
  id: string;
  disciplinaryCaseId: string;
  sanctionType: SanctionType;
  magnitude: number;
  incidentType: string;
  issuedAt: string; // ISO
  effectiveFrom: string | null; // YYYY-MM-DD
  effectiveUntil: string | null; // YYYY-MM-DD
  notes: string | null;
  isAppealWindowOpen: boolean;
  alreadyAppealed: boolean;
};

/**
 * Plan 41 — list every non-soft-deleted disciplinary row for one player.
 *
 * Admin-view (`selfView=false`) hides the Appeal CTA entirely — appeal is
 * a self-only action. Self-view shows Appeal only when both the server
 * says the business-day window is open AND the player hasn't already
 * appealed this sanction.
 */
export function SanctionsList({
  rows,
  selfView,
  now,
}: {
  rows: Sanction[];
  selfView: boolean;
  /**
   * Timestamp reference passed from the server. Rendered as a
   * `data-as-of` attribute so E2E tests can assert the page's logical
   * "now" and so future iterations can add a live countdown without
   * changing the prop shape.
   */
  now: Date;
}) {
  return (
    <section
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="sanctions-list"
      data-as-of={now.toISOString()}
    >
      <header className="flex items-end justify-between gap-3 border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
            Sanctions
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
            Disciplinary history
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--chalk-3)]">
          Clean record. No sanctions on file.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm" data-testid="sanctions-table">
              <thead>
                <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                  <th className="px-4 py-2.5 text-left font-semibold">Issued</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Incident</th>
                  <th className="px-4 py-2.5 text-center font-semibold">
                    Magnitude
                  </th>
                  <th className="px-4 py-2.5 text-left font-semibold">Notes</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    {selfView ? "Appeal" : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, idx) => (
                  <DesktopRow
                    key={s.id}
                    s={s}
                    selfView={selfView}
                    zebra={idx % 2 === 1}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="divide-y divide-[var(--ink-4)] lg:hidden">
            {rows.map((s) => (
              <MobileCard key={s.id} s={s} selfView={selfView} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DesktopRow({
  s,
  selfView,
  zebra,
}: {
  s: Sanction;
  selfView: boolean;
  zebra: boolean;
}) {
  const dateLabel = safeFormatDate(s.issuedAt);
  const showAppeal = selfView && s.isAppealWindowOpen;
  const isAutoForfeit = s.sanctionType === "auto_forfeit";
  return (
    <tr
      className={
        "border-b border-[var(--ink-4)]/70 last:border-b-0 hover:bg-[var(--ink-3)]/60 " +
        (zebra ? "bg-[var(--ink-3)]/30" : "")
      }
      data-testid="sanction-row"
      data-sanction-id={s.id}
    >
      <td className="px-4 py-3 align-middle">
        <span className="font-mono text-xs tabular text-[var(--chalk-1)]">
          {dateLabel}
        </span>
      </td>
      <td className="px-4 py-3 align-middle">
        <SanctionPill type={s.sanctionType} />
      </td>
      <td className="px-4 py-3 align-middle">
        <span className="text-xs text-[var(--chalk-1)]">
          {prettifyIncident(s.incidentType)}
        </span>
      </td>
      <td className="px-4 py-3 text-center align-middle">
        <MagnitudeCell sanction={s} />
      </td>
      <td className="px-4 py-3 align-middle">
        <span className="line-clamp-2 text-xs text-[var(--chalk-2)]">
          {s.notes ?? "—"}
        </span>
      </td>
      <td className="px-4 py-3 text-right align-middle">
        {!selfView ? null : isAutoForfeit ? (
          <span className="inline-flex items-center rounded-sm border border-[#b94852] bg-[#b94852]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#ffa3b0]">
            No appeal
          </span>
        ) : showAppeal ? (
          <AppealButton
            disciplinaryCaseId={s.disciplinaryCaseId}
            alreadyAppealed={s.alreadyAppealed}
          />
        ) : s.alreadyAppealed ? (
          <AppealButton
            disciplinaryCaseId={s.disciplinaryCaseId}
            alreadyAppealed
          />
        ) : (
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Window closed
          </span>
        )}
      </td>
    </tr>
  );
}

function MobileCard({
  s,
  selfView,
}: {
  s: Sanction;
  selfView: boolean;
}) {
  const dateLabel = safeFormatDate(s.issuedAt);
  const showAppeal = selfView && s.isAppealWindowOpen;
  const isAutoForfeit = s.sanctionType === "auto_forfeit";
  return (
    <li
      className="px-5 py-4"
      data-testid="sanction-card"
      data-sanction-id={s.id}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SanctionPill type={s.sanctionType} />
            <span className="font-mono text-[11px] tabular text-[var(--chalk-2)]">
              {dateLabel}
            </span>
          </div>
          <div className="mt-2 font-display text-sm font-semibold text-[var(--chalk-0)]">
            {prettifyIncident(s.incidentType)}
          </div>
          {s.notes ? (
            <p className="mt-1 line-clamp-3 text-xs text-[var(--chalk-2)]">
              {s.notes}
            </p>
          ) : null}
        </div>
        <MagnitudeCell sanction={s} />
      </div>
      {selfView ? (
        <div className="mt-3 flex justify-end">
          {isAutoForfeit ? (
            <span className="inline-flex items-center rounded-sm border border-[#b94852] bg-[#b94852]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#ffa3b0]">
              No appeal
            </span>
          ) : showAppeal || s.alreadyAppealed ? (
            <AppealButton
              disciplinaryCaseId={s.disciplinaryCaseId}
              alreadyAppealed={s.alreadyAppealed}
            />
          ) : (
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Window closed
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

function MagnitudeCell({ sanction: s }: { sanction: Sanction }) {
  if (s.magnitude <= 0) {
    return <span className="text-[var(--chalk-3)]">—</span>;
  }
  const unit = unitForType(s.sanctionType);
  return (
    <span className="tabular font-display text-sm font-semibold text-[var(--chalk-0)]">
      {s.magnitude}
      <span className="ml-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        {unit}
      </span>
    </span>
  );
}

function unitForType(t: SanctionType): string {
  switch (t) {
    case "point_deduction":
    case "points_deduction":
      return "pts";
    case "gd_deduction":
      return "gd";
    case "suspension":
    case "ban":
      return "days";
    case "fine":
      return "ngn";
    default:
      return "";
  }
}

/**
 * Pill colour rules (spec §6):
 *  - warning               → amber
 *  - formal_warning        → amber, stroked (inset ring)
 *  - suspension            → rose
 *  - points_deduction      → rose
 *  - gd_deduction          → rose
 *  - forfeit               → rose-dark
 *  - auto_forfeit          → rose-dark (paired with "No appeal")
 *  - fine                  → neutral
 *
 * Extras to cover the Plan 11 DB vocab already in use:
 *  - point_deduction       → rose (alias of points_deduction)
 *  - ban                   → rose (behaves like suspension)
 */
function SanctionPill({ type }: { type: SanctionType }) {
  const cfg = PILL_CONFIG[type] ?? PILL_CONFIG.warning;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] " +
        cfg.cls
      }
      data-sanction-pill={type}
    >
      {cfg.label}
    </span>
  );
}

const AMBER =
  "border-[var(--amber)]/50 bg-[var(--amber)]/10 text-[var(--amber)]";
const AMBER_STROKE =
  "border-[var(--amber)] bg-[var(--amber)]/15 text-[var(--amber)] ring-1 ring-inset ring-[var(--amber)]/40";
const ROSE =
  "border-[#ff8794]/50 bg-[#ff8794]/10 text-[#ffa3b0]";
const ROSE_DARK =
  "border-[#b94852] bg-[#b94852]/20 text-[#ffa3b0]";
const NEUTRAL =
  "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-1)]";

const PILL_CONFIG: Record<SanctionType, { cls: string; label: string }> = {
  warning: { cls: AMBER, label: "Warning" },
  formal_warning: { cls: AMBER_STROKE, label: "Formal warning" },
  suspension: { cls: ROSE, label: "Suspension" },
  point_deduction: { cls: ROSE, label: "Points −" },
  points_deduction: { cls: ROSE, label: "Points −" },
  gd_deduction: { cls: ROSE, label: "GD −" },
  forfeit: { cls: ROSE_DARK, label: "Forfeit" },
  auto_forfeit: { cls: ROSE_DARK, label: "Auto forfeit" },
  ban: { cls: ROSE, label: "Ban" },
  fine: { cls: NEUTRAL, label: "Fine" },
};

function prettifyIncident(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeFormatDate(iso: string): string {
  try {
    return formatWat(iso, "yyyy-MM-dd");
  } catch {
    return iso.slice(0, 10);
  }
}
