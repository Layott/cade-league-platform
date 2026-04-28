import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getCurrentSquadStatus } from "@/server/profile/squadStatus";
import { getHomepageData } from "@/server/homepage";
import { getPlayerDashboard } from "@/server/players/dashboard";
import { SquadDueCard } from "@/components/profile/SquadDueCard";
import { UpcomingMatchDayCard } from "@/components/public/home/UpcomingMatchDayCard";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * UI Audit Slice 2 (2026-04-28) — `/player` dashboard rebuild.
 *
 * Replaces the original 3-link-tile stub (Squad / Disputes / Appeals
 * — all duplicates of the subnav) with substance:
 *   1. Squad-due card (kept) — top-of-page priority signal.
 *   2. Caution-fee balance — current balance for the player's org.
 *      Shows a hint when the player isn't linked to an org yet.
 *   3. Open cases — count of disputes + appeals in submitted /
 *      under_review. Direct link to the merged /player/cases hub.
 *   4. Active sanction — most-recent live disciplinary_action that
 *      is currently in force. Links to /punishments (public ledger).
 *   5. Upcoming match day — re-uses the homepage card so the player
 *      sees venue + cutoff without leaving /player.
 *
 * All data is real or a clear empty-state. No placeholders.
 */
export default async function PlayerDashboardPage() {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player");

  // Resolve public users row + linked player.
  const { data: pub } = await sb
    .from("users")
    .select("id, display_name")
    .eq("supabase_auth_id", user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player");

  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();

  // Service-role client for reads that touch RLS-protected tables
  // (caution_ledger_entries, disciplinary_actions joined to cases).
  // The /player surface is auth-gated above; we already proved the
  // viewer is the linked player, so service-role is appropriate.
  const svc = getServiceRoleSupabase();
  const now = new Date();

  // Squad-due status (kept as-is from prior page).
  const status = player
    ? await getCurrentSquadStatus(svc, player.id, now)
    : null;

  // Dashboard signal block — only renders when the viewer has a
  // linked player row. Staff viewers get the squad card only (so they
  // can verify behavior without needing a player linkage).
  const dashboard = player
    ? await getPlayerDashboard(svc, {
        playerId: player.id,
        userId: pub.id as string,
        now,
      })
    : null;

  // Re-use the homepage feed for the next match day. The data shape
  // is shared so we don't duplicate the query.
  const homepage = await getHomepageData(svc);

  return (
    <div className="space-y-6" data-testid="player-dashboard">
      <SectionHeader
        eyebrow="Dashboard"
        title={`Welcome${pub.display_name ? `, ${pub.display_name}` : ""}`}
        description="Your weekly squad, open cases, sanctions, and the next match day at a glance."
      />

      {status ? <SquadDueCard status={status} /> : null}

      {dashboard ? (
        <div className="grid gap-4 md:grid-cols-3">
          <CautionBalanceCard balance={dashboard.orgBalance} />
          <OpenCasesCard openCases={dashboard.openCases} />
          <ActiveSanctionCard sanction={dashboard.activeSanction} />
        </div>
      ) : null}

      <section
        aria-labelledby="player-next-match-heading"
        data-testid="player-next-match"
        className="space-y-3"
      >
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--secondary)]">
            Match day
          </div>
          <h2
            id="player-next-match-heading"
            className="font-display text-xl font-bold tracking-tight text-[var(--chalk-0)]"
          >
            Upcoming match day
          </h2>
        </div>
        <UpcomingMatchDayCard matchDay={homepage.nextMatchDay} />
      </section>
    </div>
  );
}

/* ---------------- Card 2 — Caution balance ---------------- */
function CautionBalanceCard({
  balance,
}: {
  balance: { organizationName: string; balanceCoins: number } | null;
}) {
  return (
    <article
      className="flex h-full flex-col justify-between gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      data-testid="player-dashboard-caution-card"
    >
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
          Caution balance
        </div>
        <div className="font-display text-base font-semibold text-[var(--chalk-0)]">
          Org-tracked deposit
        </div>
      </header>
      {balance ? (
        <div className="space-y-2">
          <div className="font-display text-3xl font-bold tabular text-[var(--signal)]">
            {fmtCoins(balance.balanceCoins)}
          </div>
          <div className="text-xs text-[var(--chalk-2)]">
            {balance.organizationName}
            <span className="ml-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              coins
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-[var(--chalk-2)]">
            You aren&apos;t linked to an org yet.
          </div>
          <div className="text-xs text-[var(--chalk-3)]">
            Caution-fee balances are tracked at the organization level.
            Reach out to your team manager if this looks wrong.
          </div>
        </div>
      )}
    </article>
  );
}

/* ---------------- Card 3 — Open cases ---------------- */
function OpenCasesCard({
  openCases,
}: {
  openCases: { disputes: number; appeals: number };
}) {
  const total = openCases.disputes + openCases.appeals;
  return (
    <article
      className="flex h-full flex-col justify-between gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      data-testid="player-dashboard-cases-card"
      data-open-disputes={openCases.disputes}
      data-open-appeals={openCases.appeals}
    >
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
          Open cases
        </div>
        <div className="font-display text-base font-semibold text-[var(--chalk-0)]">
          Disputes &amp; appeals
        </div>
      </header>
      <div className="space-y-2">
        <div className="font-display text-3xl font-bold tabular text-[var(--chalk-0)]">
          {total}
        </div>
        <div className="text-xs text-[var(--chalk-2)]">
          <span className="tabular text-[var(--signal)]">{openCases.disputes}</span>{" "}
          dispute{openCases.disputes === 1 ? "" : "s"}
          <span className="mx-1.5 text-[var(--chalk-3)]">·</span>
          <span className="tabular text-[var(--signal)]">{openCases.appeals}</span>{" "}
          appeal{openCases.appeals === 1 ? "" : "s"}
        </div>
        <Link
          href={
            openCases.appeals > 0 && openCases.disputes === 0
              ? "/player/cases?tab=appeals"
              : "/player/cases?tab=disputes"
          }
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--signal)] hover:underline"
          data-testid="player-dashboard-cases-link"
        >
          Open cases hub
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}

/* ---------------- Card 4 — Active sanction ---------------- */
function ActiveSanctionCard({
  sanction,
}: {
  sanction: {
    sanctionType: string;
    incidentType: string;
    effectiveUntil: string | null;
    imposedAt: string;
  } | null;
}) {
  return (
    <article
      className={
        "flex h-full flex-col justify-between gap-4 rounded-sm border p-5 " +
        (sanction
          ? "border-[#b94852] bg-[#b94852]/10"
          : "border-[var(--ink-4)] bg-[var(--ink-2)]")
      }
      data-testid="player-dashboard-sanction-card"
      data-has-sanction={sanction ? "true" : "false"}
    >
      <header className="space-y-1">
        <div
          className={
            "text-[10px] font-semibold uppercase tracking-[0.28em] " +
            (sanction ? "text-[#ffa3b0]" : "text-[var(--chalk-3)]")
          }
        >
          Active sanction
        </div>
        <div className="font-display text-base font-semibold text-[var(--chalk-0)]">
          {sanction ? prettifyType(sanction.sanctionType) : "Clean record"}
        </div>
      </header>
      {sanction ? (
        <div className="space-y-2">
          <div className="text-xs text-[var(--chalk-1)]">
            For{" "}
            <span className="font-semibold text-[var(--chalk-0)]">
              {prettifyType(sanction.incidentType)}
            </span>
            {sanction.effectiveUntil ? (
              <>
                {" · until "}
                <span className="font-mono tabular text-[var(--chalk-0)]">
                  {formatWat(sanction.effectiveUntil + "T00:00:00", "yyyy-MM-dd")}
                </span>
              </>
            ) : (
              <span className="ml-1 text-[10px] uppercase tracking-[0.18em] text-[#ffa3b0]">
                · open-ended
              </span>
            )}
          </div>
          <Link
            href="/punishments"
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ffa3b0] hover:underline"
            data-testid="player-dashboard-sanction-link"
          >
            See public ledger
            <span aria-hidden>→</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-[var(--chalk-2)]">
            No active sanctions on file. Keep it that way.
          </div>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-2)] hover:text-[var(--signal)] hover:underline"
          >
            Disciplinary history
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </article>
  );
}

function prettifyType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtCoins(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(n));
}
