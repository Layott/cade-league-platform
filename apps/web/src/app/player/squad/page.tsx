import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  getRuleForSeason,
  weekStartThursday,
  thursdayDeadline,
  resolveSquadWindowForMatchDay,
  listSubmissionsForPlayerInSeason,
  getSubmissionForPlayerAndMatchDay,
  getDraft,
  type PlayerSubmissionSummary,
} from "@/server/squads";
import { listMatchDays } from "@/server/matches/match-days";
import { formatWat, weekendStartSaturday, weekendLabel } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  SquadPickerBuilder,
  type InitialSquad,
} from "@/components/squads/SquadPickerBuilder";
import { SquadPitchView } from "@/components/squads/SquadPitchView";
// Bug fix 2026-05-02: helper now lives in a non-`"use client"` module so a
// Server Component can call it. Importing from `SquadPitchView` (which has
// `"use client"`) yields a client reference whose call from the server
// throws `Attempted to call inferFormationFromItems() ...` on
// `/player/squad?...&edit=1`.
import { inferFormationFromItems } from "@/components/squads/formationInference";
import { PlayerSquadLiveRefresh } from "@/components/player/PlayerSquadLiveRefresh";
import {
  SquadMatchDayPicker,
  type SquadMatchDayPickerItem,
} from "@/components/player/SquadMatchDayPicker";
import {
  ApplySquadToOtherMDs,
  type ApplySquadEligibleMatchDay,
} from "@/components/player/ApplySquadToOtherMDs";
import { WeekendApplyPrompt } from "@/components/player/WeekendApplyPrompt";
import {
  requestUploadUrlAction,
  submitPickerAction,
  applySquadToMultipleMatchDaysAction,
} from "./actions";
import {
  saveSquadDraftAction,
  clearSquadDraftAction,
} from "./draft-actions";
import type { CardSearchResult } from "@/server/fcdb/search";
import type { SquadItemRow } from "@/server/squads/list";

export const dynamic = "force-dynamic";

/**
 * Plan 56 — `/player/squad` shows EVERY match day in the active season as a
 * row in a picker. Players can:
 *   - Click a past/current match day they've submitted for → read-only
 *     <SquadPitchView />.
 *   - Click an open (window force-opened OR pre-deadline) match day they
 *     have NOT submitted for → <SquadPickerBuilder /> targeting that match
 *     day.
 *   - Click a closed match day they did not submit for → "Window closed"
 *     info card.
 *   - Click an upcoming match day not yet open → "Not open yet" info card.
 *
 * The `?matchDay=<id>` query param scopes to a single match day. Without it
 * the page renders the bucketed picker (Past / This week / Upcoming).
 *
 * The Thursday deadline + Friday change window logic is unchanged. The
 * weekly resolver only fires when a match day is ambient (not force-opened
 * by an admin); admins reopen specific match days via /admin/squads.
 */

type ResolvedRow = {
  matchDayId: string;
  matchDate: string;
  venueName: string;
  reason: string;
  isOpen: boolean;
  // 2026-05-02 — surfaced from `resolveSquadWindowForMatchDay` so the
  // picker CTA + the detail-view edit gate can distinguish admin
  // force-open from ambient pre-deadline default. Force-open lifts the
  // "only-pending-can-edit" rule so a player whose squad was rejected
  // can fix it without first asking for a manual reopen.
  forceOpen: boolean;
  submission: PlayerSubmissionSummary | null;
};

export default async function PlayerSquadPage({
  searchParams,
}: {
  searchParams?: Promise<{
    matchDay?: string;
    edit?: string;
    submitted?: string;
  }>;
}) {
  const sp: { matchDay?: string; edit?: string; submitted?: string } =
    searchParams ? await searchParams : {};
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/squad");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) redirect("/login?next=/player/squad");

  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Squad"
          title="My squads"
          description="You do not have a player profile linked to your account yet. Contact an admin."
        />
      </div>
    );
  }

  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  if (!season?.id) {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Squad"
          title="My squads"
          description="No active season — once an admin marks a season active you'll see your match days here."
        />
      </div>
    );
  }

  const now = new Date();
  const todayWeekStart = weekStartThursday(now);
  const svc = getServiceRoleSupabase();

  // Load every match day for the active season + the player's submissions
  // in parallel. Match days come back sorted DESC; we'll re-sort ASC for
  // the player view (chronological reads more naturally for a player
  // browsing the season).
  const [days, submissionMap] = await Promise.all([
    listMatchDays(svc, season.id),
    listSubmissionsForPlayerInSeason(svc, player.id, season.id),
  ]);
  const sortedDays = [...days].sort((a, b) =>
    a.match_date < b.match_date ? -1 : a.match_date > b.match_date ? 1 : 0,
  );

  // Resolve window state for each match day. Each call hits Supabase but
  // they're independent — Promise.all keeps the page render wall-clock low.
  const resolved: ResolvedRow[] = await Promise.all(
    sortedDays.map(async (d) => {
      const r = await resolveSquadWindowForMatchDay(svc, d.id, { now });
      const direct = submissionMap.get(d.id);
      const legacy = submissionMap.get(`week:${weekStartThursday(d.match_date)}`);
      return {
        matchDayId: d.id,
        matchDate: d.match_date,
        venueName: d.venue_name,
        reason: r.reason,
        isOpen: r.open,
        // 2026-05-02 — admin-explicit force-open signal (per-match-day or
        // per-week). Lets the picker CTA + detail-view show "Edit squad"
        // even on rejected/approved submissions when admin intent is clear.
        forceOpen: r.forceOpen,
        submission: direct ?? legacy ?? null,
      };
    }),
  );

  // Per-match-day rule for the picker totals bar.
  let rule = null;
  try {
    const raw = await getRuleForSeason(sb, season.id);
    if (raw) {
      rule = {
        maxBudgetCoins: raw.max_budget_coins,
        minNigerianItems: raw.min_nigerian_items,
        bannedItemTypes: raw.banned_item_types,
      };
    }
  } catch {
    rule = null;
  }

  // Selected match day mode — render the detail view (submission OR picker
  // OR closed-info).
  const selected = sp.matchDay
    ? resolved.find((r) => r.matchDayId === sp.matchDay) ?? null
    : null;

  if (selected) {
    // Fetch the live submission's items only when one exists. This avoids
    // pulling 13 weeks worth of items on the picker view.
    const subWithItems = selected.submission
      ? await getSubmissionForPlayerAndMatchDay(
          svc,
          player.id,
          selected.matchDayId,
          weekStartThursday(selected.matchDate),
        )
      : null;

    const matchDayWeekStart = weekStartThursday(selected.matchDate);

    // 2026-05-01 — bug 6 (extended 2026-05-02). Edit mode: when `?edit=1`
    // is set AND a live submission exists AND the window is open AND
    // EITHER the submission is pending OR the window is admin-force-
    // opened, hydrate the picker from the existing submission instead
    // of rendering the read-only summary. Submitting with the same week
    // anchor + matchDayId triggers the soft-delete + re-insert path in
    // submit.ts. The force-open branch lets a player whose squad was
    // rejected/approved revise it during an admin-explicit reopen
    // without first asking for a manual `reopenSubmission` flip.
    const editing =
      sp.edit === "1" &&
      !!subWithItems &&
      selected.isOpen &&
      (subWithItems.submission.validation_status === "pending" ||
        selected.forceOpen);

    // Picker autosave hydration — only relevant when we'll mount the
    // picker (open match day, no live submission). Fetch via the service
    // role client because squad_drafts.player_id points at users.id and
    // the draft row may be queried before any RLS policy is added.
    let initialDraft = null;
    if ((!subWithItems || editing) && selected.isOpen) {
      try {
        initialDraft = await getDraft(
          svc,
          pub.id,
          matchDayWeekStart,
          selected.matchDayId,
        );
      } catch {
        initialDraft = null;
      }
    }

    // Edit mode hydration: build an `initialSquad` payload from the live
    // submission's items so the picker pre-fills formation + slots. We
    // map each `squad_player_items` row into the `CardSearchResult` shape
    // the picker consumes, drawing the FCDB-resolved card snapshot via
    // the joined `fc_player` row when present (Plan 30 picker submissions
    // always carry it). Falls back to a minimal shape so legacy / OCR
    // submissions still hydrate something.
    let initialSquad: InitialSquad | null = null;
    if (editing && subWithItems) {
      initialSquad = buildInitialSquadFromSubmission(subWithItems.items);
    }

    // 2026-05-01 — bug 5. Compute eligible match days the player can clone
    // this squad onto. Filter the season-wide `resolved` list down to:
    //   - exclude the current match day (no self-apply)
    //   - exclude past match days
    //   - include only rows whose window is currently open
    //   - exclude rows with an approved/rejected submission
    //   - allow rows with no submission (will create) OR pending (will replace)
    // Sorted ascending by match_date so the player sees the next weekend first.
    const eligibleApplyTargets: ApplySquadEligibleMatchDay[] = resolved
      .filter((r) => r.matchDayId !== selected.matchDayId)
      .filter((r) => r.matchDate >= todayWeekStart)
      .filter((r) => r.isOpen)
      .filter(
        (r) =>
          !r.submission ||
          r.submission.validationStatus === "pending",
      )
      .sort((a, b) =>
        a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : 0,
      )
      .map((r) => ({
        matchDayId: r.matchDayId,
        matchDate: r.matchDate,
        venueName: r.venueName,
        state:
          r.submission && r.submission.validationStatus === "pending"
            ? "pending_resubmit"
            : "open_no_submission",
      }));

    return (
      <div className="space-y-6">
        <PlayerSquadLiveRefresh
          playerId={player.id}
          weekStartDate={todayWeekStart}
        />
        <SectionHeader
          eyebrow={`Match day · ${selected.matchDate}`}
          title={`Squad for ${selected.matchDate}`}
          description={`Venue: ${selected.venueName}. Deadline: Thursday ${formatWat(thursdayDeadline(matchDayWeekStart), "HH:mm")} WAT (${matchDayWeekStart}).`}
        />
        <div>
          <Link
            href="/player/squad"
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
            data-testid="squad-md-back-link"
          >
            ← Back to all match days
          </Link>
        </div>

        {subWithItems && !editing ? (
          <>
            <section
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
              data-testid="squad-existing-summary"
            >
              <div className="flex items-center gap-3">
                <StatusPill status={subWithItems.submission.validation_status} />
                <span className="text-xs text-[var(--chalk-2)]">
                  Submitted{" "}
                  {formatWat(
                    subWithItems.submission.submitted_at,
                    "yyyy-MM-dd HH:mm",
                  )}{" "}
                  WAT
                </span>
              </div>
              {subWithItems.submission.rejection_reason ? (
                <p className="mt-3 text-sm text-[var(--flare)]">
                  Rejection reason: {subWithItems.submission.rejection_reason}
                </p>
              ) : null}
              <div className="mt-4">
                <SquadPitchView items={subWithItems.items} />
              </div>
              {selected.isOpen &&
              (subWithItems.submission.validation_status === "pending" ||
                selected.forceOpen) ? (
                <div className="mt-4">
                  <Link
                    href={`/player/squad?matchDay=${encodeURIComponent(
                      selected.matchDayId,
                    )}&edit=1`}
                    className="inline-flex items-center justify-center rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--primary-ink)] hover:bg-[#82e21a]"
                    data-testid="squad-detail-edit-link"
                  >
                    Edit squad
                  </Link>
                </div>
              ) : null}
            </section>
            <ApplySquadToOtherMDs
              sourceMatchDayId={selected.matchDayId}
              sourceMatchDate={selected.matchDate}
              eligible={eligibleApplyTargets}
              applyAction={applySquadToMultipleMatchDaysAction}
            />
          </>
        ) : selected.isOpen ? (
          <section data-testid="squad-match-day-picker">
            <div className="mb-3 rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.08)] p-3 text-xs text-[var(--chalk-1)]">
              {editing ? "Editing existing squad for match day " : "Building squad for match day "}
              <span className="font-mono font-semibold text-[var(--chalk-0)]">
                {selected.matchDate}
              </span>{" "}
              · {selected.venueName}.
              {editing
                ? " Saving will replace your current submission."
                : null}
            </div>
            <SquadPickerBuilder
              weekStartDate={matchDayWeekStart}
              rule={rule}
              matchDayId={selected.matchDayId}
              submitAction={submitPickerAction}
              requestUploadUrlAction={requestUploadUrlAction}
              initialDraft={initialDraft}
              initialSquad={initialSquad}
              saveDraftAction={saveSquadDraftAction}
              clearDraftAction={clearSquadDraftAction}
            />
          </section>
        ) : selected.matchDate > todayWeekStart ? (
          <section
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center"
            data-testid="squad-window-not-open-yet"
          >
            <div className="mb-2 font-display text-lg font-bold text-[var(--chalk-0)]">
              Not open yet
            </div>
            <p className="text-sm text-[var(--chalk-2)]">
              Submissions for this match day open by Thursday{" "}
              {formatWat(thursdayDeadline(matchDayWeekStart), "HH:mm")} WAT on{" "}
              <span className="font-mono">{matchDayWeekStart}</span>. Check back
              once an admin opens the window or once the regular weekly cycle
              reaches this match day.
            </p>
          </section>
        ) : (
          <section
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center"
            data-testid="squad-window-closed"
          >
            <div className="mb-2 font-display text-lg font-bold text-[var(--chalk-0)]">
              Squad window closed
            </div>
            <p className="text-sm text-[var(--chalk-2)]">
              The submission deadline for this match day has passed. If you
              missed it, contact an admin to reopen submissions for you.
            </p>
          </section>
        )}
      </div>
    );
  }

  // List view — bucket every match day into past / this_week / upcoming so
  // the player's "next squad to file" sits in the most prominent group.
  const matchDayItems: SquadMatchDayPickerItem[] = resolved.map((r) => {
    const weekAnchor = weekStartThursday(r.matchDate);
    const bucket: SquadMatchDayPickerItem["bucket"] =
      weekAnchor === todayWeekStart
        ? "this_week"
        : r.matchDate < todayWeekStart
          ? "past"
          : "upcoming";

    let status: SquadMatchDayPickerItem["status"];
    if (r.submission) {
      status = "submitted";
    } else if (r.isOpen) {
      status = "open";
    } else if (bucket === "upcoming") {
      // Future match day with no live submission and no open window — the
      // weekly cycle will roll round to it eventually.
      status = "upcoming";
    } else {
      status = "closed";
    }

    return {
      matchDayId: r.matchDayId,
      matchDate: r.matchDate,
      venueName: r.venueName,
      status,
      submittedAt: r.submission?.submittedAt ?? null,
      validationStatus: r.submission?.validationStatus ?? null,
      // 2026-05-01 — bug 6. Carry the raw window-open flag so the picker
      // row can flip "View squad" → "Edit squad" while the deadline is
      // still pending.
      windowOpen: r.isOpen,
      // 2026-05-02 — explicit admin force-open signal. Drives the picker
      // CTA logic: when an admin force-opens a window, ALL statuses
      // (pending / approved / rejected) get an Edit CTA so the player
      // can revise without needing a manual reopen.
      forceOpen: r.forceOpen,
      bucket,
    };
  });

  // 2026-04-30 — Group Sat+Sun match days by weekend.
  // 2026-05-02 (user-reported, item 1) — when BOTH match days in the
  // weekend are open AND neither has a submission yet, render them as
  // SEPARATE rows so the player can pick which specific match day they
  // want to submit for. Otherwise (one already submitted, both closed,
  // both upcoming, etc.) collapse into the single "Weekend · May 2-3"
  // row that ships today.
  const byWeekend = new Map<string, SquadMatchDayPickerItem[]>();
  for (const item of matchDayItems) {
    const wkKey = weekendStartSaturday(item.matchDate);
    const arr = byWeekend.get(wkKey) ?? [];
    arr.push(item);
    byWeekend.set(wkKey, arr);
  }
  const items: SquadMatchDayPickerItem[] = [];
  for (const [satYmd, group] of byWeekend) {
    const sorted = [...group].sort((a, b) =>
      a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : 0,
    );
    const head = sorted[0];
    if (sorted.length === 1) {
      // Single match in this weekend — render as-is (no displayLabel).
      items.push(head);
      continue;
    }
    // Detect the "both open + no submission" pair — keep separate rows so
    // the player chooses Sat OR Sun explicitly. Submission status drives
    // the gate: if EVERY row in the weekend is `status='open'` (which
    // already implies no live submission per the matchDayItems mapper),
    // we skip the collapse.
    const allOpenNoSub = sorted.every((s) => s.status === "open");
    if (allOpenNoSub) {
      for (const row of sorted) {
        items.push(row);
      }
      continue;
    }
    // Otherwise collapse. Status precedence: any open row wins, then any
    // submitted row, then any upcoming, fallback to head.
    const pickStatus = (): SquadMatchDayPickerItem["status"] => {
      if (sorted.some((s) => s.status === "open")) return "open";
      if (sorted.some((s) => s.status === "submitted")) return "submitted";
      if (sorted.some((s) => s.status === "upcoming")) return "upcoming";
      return head.status;
    };
    const subRow =
      sorted.find((s) => s.status === "submitted") ?? head;
    items.push({
      ...head,
      status: pickStatus(),
      submittedAt: subRow.submittedAt ?? null,
      validationStatus: subRow.validationStatus ?? null,
      // 2026-05-01 — Edit-squad CTA needs to know the window state for the
      // collapsed weekend row. Use the head row's open state — Sat+Sun
      // pairs share the same Thursday-anchor week, so `isOpen` agrees.
      windowOpen: head.windowOpen ?? false,
      // 2026-05-02 — same reasoning for forceOpen: Sat+Sun pairs share
      // the same week anchor so the resolver result for the head row is
      // representative of the whole weekend slot.
      forceOpen: head.forceOpen ?? false,
      displayLabel: weekendLabel(satYmd, sorted.map((s) => s.matchDate)),
      secondaryMatchDate: sorted[1]?.matchDate ?? null,
    });
  }

  // 2026-05-02 (user-reported, item 1) — weekend continuation prompt.
  // After a successful submit, the action redirects to
  // `/player/squad?submitted=<mdId>`. Resolve the sibling MD in the same
  // weekend; if it exists, has no live submission for this player, and
  // its window is open, render the WeekendApplyPrompt above the picker
  // so the player can one-click apply the same roster to it.
  let weekendPrompt: {
    sourceMatchDayId: string;
    sourceMatchDate: string;
    sourceDayLabel: string;
    siblingMatchDayId: string;
    siblingMatchDate: string;
    siblingDayLabel: string;
  } | null = null;
  if (sp.submitted) {
    const sourceRow = resolved.find((r) => r.matchDayId === sp.submitted);
    if (sourceRow) {
      const sourceWeekend = weekendStartSaturday(sourceRow.matchDate);
      const sibling = resolved.find(
        (r) =>
          r.matchDayId !== sourceRow.matchDayId &&
          weekendStartSaturday(r.matchDate) === sourceWeekend &&
          r.isOpen &&
          !r.submission,
      );
      if (sibling) {
        weekendPrompt = {
          sourceMatchDayId: sourceRow.matchDayId,
          sourceMatchDate: sourceRow.matchDate,
          sourceDayLabel: formatWat(
            `${sourceRow.matchDate}T12:00:00Z`,
            "EEEE MMMM d",
          ),
          siblingMatchDayId: sibling.matchDayId,
          siblingMatchDate: sibling.matchDate,
          siblingDayLabel: formatWat(
            `${sibling.matchDate}T12:00:00Z`,
            "EEEE MMMM d",
          ),
        };
      }
    }
  }

  // Find the "this week" match day id for the live-refresh ping.
  const thisWeekItem = items.find((i) => i.bucket === "this_week");

  return (
    <div className="space-y-6">
      <PlayerSquadLiveRefresh
        playerId={player.id}
        weekStartDate={todayWeekStart}
      />
      <SectionHeader
        eyebrow="Squad"
        title="My squads"
        description={`Pick a match day to view your submission or file a new squad. Deadline each match day: Thursday ${formatWat(thursdayDeadline(todayWeekStart), "HH:mm")} WAT.`}
      />
      {weekendPrompt ? (
        <WeekendApplyPrompt
          sourceMatchDayId={weekendPrompt.sourceMatchDayId}
          sourceMatchDate={weekendPrompt.sourceMatchDate}
          sourceDayLabel={weekendPrompt.sourceDayLabel}
          siblingMatchDayId={weekendPrompt.siblingMatchDayId}
          siblingMatchDate={weekendPrompt.siblingMatchDate}
          siblingDayLabel={weekendPrompt.siblingDayLabel}
          applyAction={applySquadToMultipleMatchDaysAction}
        />
      ) : null}
      <SquadMatchDayPicker
        items={items}
        currentMatchDayId={thisWeekItem?.matchDayId ?? null}
      />
    </div>
  );
}

/**
 * 2026-05-01 — bug 6 hydration helper. Map the live submission's items into
 * the picker's `InitialSquad` shape (formation key + slot snapshots + subs
 * bench). Slot 0..10 land on the pitch, slot 11..N land on the subs bench
 * preserving their slot order.
 *
 * Each `squad_player_items` row carries the denormalised name + rating + etc
 * plus an optional `fc_player` join from `resolved_fc_player_id`. We prefer
 * the FCDB row's id when present (so re-submission resolves the same FCDB
 * card) and fall back to the item's own id otherwise.
 */
function buildInitialSquadFromSubmission(items: SquadItemRow[]): InitialSquad {
  const starters = items
    .filter((it) => it.slot_index >= 0 && it.slot_index <= 10)
    .sort((a, b) => a.slot_index - b.slot_index);
  const bench = items
    .filter((it) => it.slot_index >= 11)
    .sort((a, b) => a.slot_index - b.slot_index);

  const formation = inferFormationFromItems(
    starters.map((it) => ({
      id: it.id,
      slot_index: it.slot_index,
      name: it.name,
      rating: it.rating,
      position: it.position,
      item_type: it.item_type,
      nationality_flag: it.nationality_flag,
      fc_player: it.fc_player ?? null,
    })),
  );

  const slotsPayload = starters
    .filter((it) => it.fc_player?.id || it.resolved_fc_player_id)
    .map((it) => ({
      slotIndex: it.slot_index,
      card: itemToCard(it),
    }));

  // Picker MAX_SUBS = 7. Pad / trim accordingly.
  const subs: Array<CardSearchResult | null> = Array.from(
    { length: 7 },
    (_, i) => {
      const it = bench.find((b) => b.slot_index === 11 + i);
      return it ? itemToCard(it) : null;
    },
  );

  return {
    formation,
    slots: slotsPayload,
    subs,
  };
}

/**
 * 2026-05-01 — convert a SquadItemRow (with optional fc26_players join) to
 * the CardSearchResult shape the picker consumes. Mirrors the `toCardLike`
 * helper inside SquadPitchView but lives here so the page-level loader has
 * a single dependency-free helper. When the join is missing we still emit a
 * minimum-viable card so re-submission carries the original picks; the
 * picker's submit path resolves `card.id` against `fc26_players` again
 * before insert, so a stale id will surface as a ConflictError.
 */
function itemToCard(it: SquadItemRow): CardSearchResult {
  const fc = it.fc_player ?? null;
  const attrs =
    fc?.attributes && typeof fc.attributes === "object"
      ? (fc.attributes as Record<string, unknown>)
      : null;
  const cardImageUrl =
    attrs && typeof attrs.card_image_url === "string"
      ? (attrs.card_image_url as string)
      : null;
  const cardBgUrl =
    attrs && typeof attrs.card_bg_url === "string"
      ? (attrs.card_bg_url as string)
      : null;
  const futbinVariant =
    attrs && typeof attrs.futbin_variant === "string"
      ? (attrs.futbin_variant as string)
      : null;

  // Prefer the resolved FCDB id; fall back to the item id (legacy).
  const id = fc?.id ?? it.resolved_fc_player_id ?? it.id;
  const rating = fc?.rating ?? it.rating;
  const itemType = fc?.item_type ?? it.item_type;
  const nationIso = fc?.nation_iso ?? it.nationality_flag;
  const nation = fc?.nation ?? null;
  const name = fc?.name ?? it.name;

  return {
    id,
    slug: id, // sufficient for one-per-player dedup on re-submit
    name,
    rating,
    position: it.position,
    positionsAlt: [],
    club: null,
    league: null,
    nation,
    nationIso,
    itemType,
    priceCoins: it.value ?? null,
    cardImageUrl,
    cardBgUrl,
    variant:
      futbinVariant ?? (itemType && itemType !== "normal" ? itemType : null),
    mainStats: null,
    weakFoot: null,
    skillMoves: null,
    metaRating: null,
    futbinNationId: null,
    futbinLeagueId: null,
    futbinClubId: null,
  };
}
