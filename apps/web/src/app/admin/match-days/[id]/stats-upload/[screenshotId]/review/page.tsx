import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { createSignedRead, emptyParsedMatchStats, type ParsedMatchStats } from "@/server/stats_ocr";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import {
  confirmReviewAction,
  rejectReviewAction,
  rerunOcrAction,
} from "../../actions";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

type ScreenshotRow = {
  id: string;
  match_id: string;
  storage_path: string;
  parse_status: string;
  parsed_json: ParsedMatchStats | null;
  parsed_by_engine: string | null;
  uploaded_at: string;
  confirmed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
};

type PlayerOption = { id: string; label: string };

const STAT_FIELDS: Array<{
  key: keyof ParsedMatchStats["homeStats"];
  label: string;
  max?: number;
}> = [
  { key: "possessionPct", label: "Possession %", max: 100 },
  { key: "shots", label: "Shots" },
  { key: "shotsOnTarget", label: "Shots on target" },
  { key: "passes", label: "Passes" },
  { key: "passAccuracyPct", label: "Pass acc %", max: 100 },
  { key: "tackles", label: "Tackles" },
  { key: "interceptions", label: "Interceptions" },
  { key: "fouls", label: "Fouls" },
  { key: "ballRecoveries", label: "Ball recoveries" },
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
];

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; screenshotId: string }>;
}) {
  const { id: matchDayId, screenshotId } = await params;

  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  await requirePermAsync(
    sb,
    { userId: pub.id as string, roles },
    "stats.screenshot.review",
  );

  const { data: screenshot } = await sb
    .from("match_stat_screenshots")
    .select(
      "id, match_id, storage_path, parse_status, parsed_json, parsed_by_engine, uploaded_at, confirmed_at, rejection_reason, notes",
    )
    .eq("id", screenshotId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!screenshot) notFound();
  const row = screenshot as ScreenshotRow;

  // Fetch match + season for player resolution options.
  const { data: match } = await sb
    .from("matches")
    .select("id, home_player_id, away_player_id, match_day_id, match_days:match_day_id(season_id)")
    .eq("id", row.match_id)
    .maybeSingle();
  const seasonId =
    (match?.match_days as { season_id?: string } | { season_id?: string }[] | null) &&
    (Array.isArray(match?.match_days)
      ? (match!.match_days as { season_id?: string }[])[0]?.season_id
      : (match!.match_days as { season_id?: string }).season_id);

  let playerOptions: PlayerOption[] = [];
  if (seasonId) {
    // Plan 13A introduced players.coach_id + players.team_manager_id FKs to
    // users — so `users:user_id(...)` alone is ambiguous. Disambiguate via
    // the explicit constraint name.
    const { data: participants } = await sb
      .from("season_participants")
      .select(
        "player_id, player:player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) )",
      )
      .eq("season_id", seasonId)
      .is("deleted_at", null);

    type ParticipantRow = {
      player_id: string;
      player: {
        id: string;
        gamer_tag: string;
        users: { display_name: string | null } | null;
      } | null;
    };
    playerOptions = ((participants ?? []) as unknown as ParticipantRow[]).map(
      (p) => ({
        id: p.player_id,
        label:
          p.player?.users?.display_name ??
          p.player?.gamer_tag ??
          "unknown",
      }),
    );
  }

  const signedUrl = await createSignedRead(sb, row.storage_path, 300).catch(
    () => null,
  );
  const parsedJson =
    row.parsed_json ?? emptyParsedMatchStats();

  const isTerminal =
    row.parse_status === "confirmed" || row.parse_status === "rejected";
  const isManualEntry =
    row.parse_status === "pending" || row.parse_status === "failed";

  // Default selected player = match's current home/away (if already set).
  const defaultHomeId =
    (match as { home_player_id?: string } | null)?.home_player_id ?? "";
  const defaultAwayId =
    (match as { away_player_id?: string } | null)?.away_player_id ?? "";

  return (
    <div className="space-y-8" data-testid="stats-review-page">
      <SectionHeader
        eyebrow="Stats review"
        title="Review parsed screenshot"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            <span>Uploaded {formatWat(row.uploaded_at, "yyyy-MM-dd HH:mm")}</span>
            <span className="text-[var(--ink-5)]">·</span>
            {row.parsed_by_engine ? (
              <span>via {row.parsed_by_engine}</span>
            ) : (
              <span>no engine</span>
            )}
            <span className="text-[var(--ink-5)]">·</span>
            <StatusPill status={row.parse_status} />
          </span>
        }
        action={
          <Link
            href={`/admin/match-days/${matchDayId}/stats-upload`}
            data-testid="stats-review-back"
          >
            <SecondaryButton type="button">← Back to upload list</SecondaryButton>
          </Link>
        }
      />

      {isManualEntry ? (
        <div className="rounded-sm border border-[rgba(255,176,32,0.35)] bg-[rgba(255,176,32,0.06)] p-4 text-[11px] leading-relaxed text-[var(--amber)]">
          <span className="uppercase tracking-[0.22em] font-semibold">
            Manual entry
          </span>
          <span className="block mt-1">
            No parser output to review —
            {row.parse_status === "pending"
              ? " OCR_DISABLED or not yet run."
              : " parse failed."}{" "}
            Fill in the form by hand.{" "}
            {row.notes ? <em className="opacity-80">{row.notes}</em> : null}
          </span>
        </div>
      ) : null}

      {row.rejection_reason ? (
        <div className="rounded-sm border border-[rgba(255,91,59,0.35)] bg-[rgba(255,91,59,0.06)] p-4 text-[11px] text-[var(--flare)]">
          <strong className="uppercase tracking-[0.22em]">Rejected:</strong>{" "}
          {row.rejection_reason}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: image */}
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
          {signedUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={signedUrl}
              alt="Match stat screenshot"
              data-testid="stats-review-image"
              className="h-auto w-full rounded-sm border border-[var(--ink-4)] bg-black"
            />
          ) : (
            <div
              data-testid="stats-review-image-missing"
              className="flex aspect-video items-center justify-center rounded-sm border border-dashed border-[var(--ink-4)] text-sm text-[var(--chalk-3)]"
            >
              Could not load image (signed URL failed).
            </div>
          )}
        </div>

        {/* Right: form */}
        <form
          action={confirmReviewAction}
          className="space-y-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
        >
          <input type="hidden" name="screenshotId" value={row.id} />
          <input type="hidden" name="matchDayId" value={matchDayId} />

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Home player">
              <select
                name="homePlayerId"
                required
                defaultValue={defaultHomeId}
                className={selectClass}
                data-testid="stats-review-home-player-select"
                disabled={isTerminal}
              >
                <option value="">—</option>
                {playerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Away player">
              <select
                name="awayPlayerId"
                required
                defaultValue={defaultAwayId}
                className={selectClass}
                data-testid="stats-review-away-player-select"
                disabled={isTerminal}
              >
                <option value="">—</option>
                {playerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <ReviewForm
            parsedJson={parsedJson}
            isTerminal={isTerminal}
          />

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--ink-4)]">
            {!isTerminal ? (
              <>
                <PrimaryButton
                  type="submit"
                  size="sm"
                  data-testid="stats-review-confirm"
                >
                  Confirm &amp; write stats
                </PrimaryButton>
              </>
            ) : (
              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                Review locked — terminal state
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Reject + Re-run — sit below the grid so they're visually de-emphasised */}
      {!isTerminal ? (
        <div className="flex flex-wrap items-start gap-4">
          <form
            action={rejectReviewAction}
            className="flex-1 space-y-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          >
            <input type="hidden" name="screenshotId" value={row.id} />
            <input type="hidden" name="matchDayId" value={matchDayId} />
            <FormField label="Reject reason" hint="3–500 chars">
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                className={textareaClass}
                data-testid="stats-review-reject-reason"
              />
            </FormField>
            <DangerButton
              type="submit"
              size="sm"
              data-testid="stats-review-reject"
            >
              Reject
            </DangerButton>
          </form>

          <form action={rerunOcrAction} className="shrink-0">
            <input type="hidden" name="screenshotId" value={row.id} />
            <input type="hidden" name="matchDayId" value={matchDayId} />
            <SecondaryButton
              type="submit"
              size="sm"
              data-testid="stats-review-rerun"
            >
              Re-run OCR
            </SecondaryButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ReviewForm({
  parsedJson,
  isTerminal,
}: {
  parsedJson: ParsedMatchStats;
  isTerminal: boolean;
}) {
  // Because we want to capture every admin edit into a single correctedJson
  // hidden field, rely on a thin client wrapper. Server-rendered defaults
  // mirror parsedJson; a read-only data attribute carries the original.
  return (
    <>
      <ReviewFormClient
        parsedJson={parsedJson}
        disabled={isTerminal}
      />
    </>
  );
}

/**
 * Tiny client component — re-computes the correctedJson hidden input on
 * every keystroke so the form POSTs a single, already-serialized JSON blob
 * the server action can JSON.parse without re-assembling nested fields.
 */
function ReviewFormClient({
  parsedJson,
  disabled,
}: {
  parsedJson: ParsedMatchStats;
  disabled: boolean;
}) {
  const homeStats = parsedJson.homeStats;
  const awayStats = parsedJson.awayStats;
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Home score">
          <input
            type="number"
            name="homeScore"
            min={0}
            defaultValue={parsedJson.homeScore ?? ""}
            className={inputClass + " tabular"}
            data-testid="stats-review-field-home-score"
            disabled={disabled}
          />
        </FormField>
        <FormField label="Away score">
          <input
            type="number"
            name="awayScore"
            min={0}
            defaultValue={parsedJson.awayScore ?? ""}
            className={inputClass + " tabular"}
            data-testid="stats-review-field-away-score"
            disabled={disabled}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <StatsColumn
          side="home"
          block={homeStats}
          disabled={disabled}
        />
        <StatsColumn
          side="away"
          block={awayStats}
          disabled={disabled}
        />
      </div>

      <FormField label="Source notes" hint="Free-text memo from parser">
        <textarea
          name="sourceNotes"
          rows={2}
          defaultValue={parsedJson.sourceNotes ?? ""}
          className={textareaClass}
          data-testid="stats-review-field-sourceNotes"
          disabled={disabled}
        />
      </FormField>

      {/* Client-side glue: on submit, build correctedJson from the individual inputs */}
      <input
        type="hidden"
        name="correctedJson"
        data-testid="stats-review-corrected-json"
      />
      <ReviewFormJsonGlue />
    </>
  );
}

function StatsColumn({
  side,
  block,
  disabled,
}: {
  side: "home" | "away";
  block: ParsedMatchStats["homeStats"];
  disabled: boolean;
}) {
  return (
    <fieldset
      className="space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]/40 p-4"
      disabled={disabled}
    >
      <legend className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {side}
      </legend>
      {STAT_FIELDS.map((f) => (
        <div key={f.key} className="grid grid-cols-[120px_1fr] items-center gap-3">
          <label className="text-[11px] text-[var(--chalk-2)]">{f.label}</label>
          <input
            type="number"
            name={`${side}Stats.${String(f.key)}`}
            min={0}
            max={f.max}
            defaultValue={block[f.key] ?? ""}
            className={inputClass + " tabular"}
            data-testid={`stats-review-field-${side}-${String(f.key)}`}
            disabled={disabled}
          />
        </div>
      ))}
    </fieldset>
  );
}

/**
 * Client-only glue: walks the form, builds a ParsedMatchStats shape, and
 * writes it into the hidden `correctedJson` input before submit.
 */
function ReviewFormJsonGlue() {
  return (
    <script
      // `suppressHydrationWarning` because this script touches the DOM on
      // submit — the hidden input re-populates client-side.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `
          (function(){
            function collect(form){
              function n(name){
                var el = form.elements.namedItem(name);
                if(!el) return null;
                var v = el.value;
                if (v === "" || v == null) return null;
                var p = parseInt(v, 10);
                return Number.isFinite(p) ? p : null;
              }
              function str(name){
                var el = form.elements.namedItem(name);
                if(!el) return "";
                return el.value ?? "";
              }
              var keys = ['possessionPct','shots','shotsOnTarget','passes','passAccuracyPct','tackles','interceptions','fouls','ballRecoveries','goals','assists'];
              function block(side){
                var out = {};
                for (var i=0;i<keys.length;i++){
                  out[keys[i]] = n(side+'Stats.'+keys[i]);
                }
                return out;
              }
              return {
                homePlayerDisplayName: null,
                awayPlayerDisplayName: null,
                homeScore: n('homeScore'),
                awayScore: n('awayScore'),
                homeStats: block('home'),
                awayStats: block('away'),
                sourceNotes: str('sourceNotes') || ""
              };
            }
            document.querySelectorAll('form').forEach(function(form){
              form.addEventListener('submit', function(){
                var hidden = form.querySelector('input[name="correctedJson"]');
                if (!hidden) return;
                try {
                  hidden.value = JSON.stringify(collect(form));
                } catch(e) {}
              });
            });
          })();
        `,
      }}
    />
  );
}
