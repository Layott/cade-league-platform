import { getServerSupabase } from "@/lib/supabase/server";
import { listPublic } from "@/server/punishments";
import { formatWat } from "@/lib/time";
import Link from "next/link";
import { PageHeader } from "@/components/public/PageHeader";
import { EmptyState } from "@/components/public/EmptyState";

export const revalidate = 60;

export const metadata = { title: "Discipline" };

type SanctionStyle = { label: string; bg: string; text: string };

const SANCTION_STYLES: Record<string, SanctionStyle> = {
  warning: {
    label: "Warning",
    bg: "bg-[var(--amber)]/15 border-[var(--amber)]/60",
    text: "text-[var(--amber)]",
  },
  point_deduction: {
    label: "Point Deduction",
    bg: "bg-[var(--flare)]/15 border-[var(--flare)]/60",
    text: "text-[var(--flare)]",
  },
  gd_deduction: {
    label: "GD Deduction",
    bg: "bg-[var(--flare)]/15 border-[var(--flare)]/60",
    text: "text-[var(--flare)]",
  },
  forfeit: {
    label: "Forfeit",
    bg: "bg-[var(--flare)]/15 border-[var(--flare)]/60",
    text: "text-[var(--flare)]",
  },
  ban: {
    label: "Ban",
    bg: "bg-[var(--flare)]/25 border-[var(--flare)]",
    text: "text-[var(--flare)]",
  },
};

function styleFor(type: string): SanctionStyle {
  return (
    SANCTION_STYLES[type] ?? {
      label: type.replace(/_/g, " "),
      bg: "bg-[var(--ink-3)] border-[var(--ink-5)]",
      text: "text-[var(--chalk-1)]",
    }
  );
}

function titleCase(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function PublicPunishmentsPage() {
  const sb = await getServerSupabase();
  const rows = await listPublic(sb, 100);

  return (
    <div>
      <PageHeader
        eyebrow="League discipline"
        title="Sanctions Register"
        description="Every public sanction issued under competition rules — visible for the integrity of the season. Revoked and private actions are hidden."
        right={
          <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-4">
            <Metric label="Active cases" value={rows.length.toString()} />
          </div>
        }
      />

      <div className="mx-auto max-w-4xl px-5 py-10">
        {rows.length === 0 ? (
          <EmptyState
            title="Clean slate"
            hint="No public sanctions are currently active. Warnings and deductions will surface here when issued by the referee."
          />
        ) : (
          <ul
            className="space-y-3"
            data-testid="public-punishments-list"
          >
            {rows.map((r) => {
              const s = styleFor(r.sanction_type);
              return (
                <li key={r.id}>
                  <article
                    className={
                      "relative grid grid-cols-[auto_1fr_auto] items-start gap-5 overflow-hidden rounded-sm border bg-[var(--ink-2)] p-5 transition-colors hover:border-[var(--signal)] " +
                      "border-[var(--ink-4)]"
                    }
                  >
                    <div
                      aria-hidden
                      className={
                        "absolute inset-y-0 left-0 w-1 " +
                        (s.text === "text-[var(--flare)]"
                          ? "bg-[var(--flare)]"
                          : s.text === "text-[var(--amber)]"
                            ? "bg-[var(--amber)]"
                            : "bg-[var(--ink-5)]")
                      }
                    />

                    <div
                      className={
                        "flex flex-col items-center justify-center rounded-sm border px-3 py-2 " +
                        s.bg
                      }
                    >
                      <div
                        className={
                          "text-[9px] font-bold uppercase tracking-[0.22em] " +
                          s.text
                        }
                      >
                        {s.label}
                      </div>
                      {r.magnitude > 0 ? (
                        <div
                          className={
                            "tabular mt-1 font-display text-2xl font-bold leading-none " +
                            s.text
                          }
                        >
                          −{r.magnitude}
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Link
                          href={`/players/${r.player.id}`}
                          className="font-display text-lg font-bold leading-tight text-[var(--chalk-0)] hover:text-[var(--signal)]"
                        >
                          {r.player.display_name}
                        </Link>
                        <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                          @{r.player.gamer_tag}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-2)]">
                        Incident · {titleCase(r.incident_type)}
                      </div>
                      {r.notes ? (
                        <p className="mt-3 whitespace-pre-line text-sm text-[var(--chalk-1)]">
                          {r.notes}
                        </p>
                      ) : null}
                    </div>

                    <time className="tabular text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                      {formatWat(r.imposed_at, "dd MMM yyyy")}
                    </time>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div className="tabular mt-1 font-display text-2xl font-bold leading-none text-[var(--chalk-0)]">
        {value}
      </div>
    </div>
  );
}
