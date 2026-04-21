import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { getMatchDay } from "@/server/matches/match-days";
import { listByMatchDay } from "@/server/matches/matches";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";
import { FormField } from "@/components/admin/FormField";
import { uploadScreenshotAction } from "./actions";

export const dynamic = "force-dynamic";

type MatchRow = Awaited<ReturnType<typeof listByMatchDay>>[number];
type PlayerJoined = {
  id: string;
  gamer_tag: string;
  users: { id: string; display_name: string | null } | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function playerLabel(p: PlayerJoined | null | undefined): string {
  if (!p) return "?";
  return p.users?.display_name ?? p.gamer_tag ?? "?";
}

type ScreenshotRow = {
  id: string;
  match_id: string;
  storage_path: string;
  parse_status: string;
  parsed_by_engine: string | null;
  uploaded_at: string;
  confirmed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
};

export default async function StatsUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: matchDayId } = await params;

  // Double-gate: the actions also check, but we fail fast here with a
  // readable redirect to /login for unauth.
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
  await requirePermAsync(sb, { userId: pub.id as string, roles }, "stats.screenshot.upload");

  const matchDay = await getMatchDay(sb, matchDayId);
  const matches = (await listByMatchDay(sb, matchDayId)) as MatchRow[];
  const matchIds = matches.map((m) => m.id);

  // Fetch all screenshots for every match in this match_day.
  let screenshots: ScreenshotRow[] = [];
  if (matchIds.length > 0) {
    const { data } = await sb
      .from("match_stat_screenshots")
      .select(
        "id, match_id, storage_path, parse_status, parsed_by_engine, uploaded_at, confirmed_at, rejection_reason, notes",
      )
      .in("match_id", matchIds)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });
    screenshots = (data ?? []) as ScreenshotRow[];
  }
  const screenshotsByMatch = new Map<string, ScreenshotRow[]>();
  for (const s of screenshots) {
    const list = screenshotsByMatch.get(s.match_id) ?? [];
    list.push(s);
    screenshotsByMatch.set(s.match_id, list);
  }

  const ocrDisabled = process.env.OCR_DISABLED === "1";

  return (
    <div className="space-y-10" data-testid="stats-upload-page">
      <SectionHeader
        eyebrow="Stats enrichment"
        title="Match stat screenshots"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            <span>
              <span className="text-[var(--chalk-1)] tabular">
                {matchDay.match_date}
              </span>
            </span>
            <span className="text-[var(--ink-5)]">·</span>
            <span>{matchDay.venue_name}</span>
            {ocrDisabled ? (
              <>
                <span className="text-[var(--ink-5)]">·</span>
                <StatusPill tone="amber">OCR DISABLED — manual entry</StatusPill>
              </>
            ) : null}
          </span>
        }
        action={
          <Link href={`/admin/match-days/${matchDayId}`}>
            <SecondaryButton type="button">← Back to fixtures</SecondaryButton>
          </Link>
        }
      />

      {matches.length === 0 ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]">
          No fixtures in this match day yet. Draft them first, then upload
          stat screenshots here.
        </div>
      ) : (
        <ul className="space-y-6">
          {matches.map((m) => {
            const home = firstOrNull(
              (m as unknown as { home_player: PlayerJoined | PlayerJoined[] | null })
                .home_player,
            );
            const away = firstOrNull(
              (m as unknown as { away_player: PlayerJoined | PlayerJoined[] | null })
                .away_player,
            );
            const shots = screenshotsByMatch.get(m.id) ?? [];
            return (
              <li
                key={m.id}
                data-testid={`stats-match-${m.id}`}
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="font-display text-base font-semibold text-[var(--chalk-0)]">
                    {playerLabel(home)}{" "}
                    <span className="mx-2 text-[var(--ink-5)]">vs</span>{" "}
                    {playerLabel(away)}
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] tabular">
                    {shots.length} upload{shots.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_1fr]">
                  {/* Upload dropzone */}
                  <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)]/60 p-4">
                    <form
                      action={uploadScreenshotAction}
                      encType="multipart/form-data"
                      className="space-y-3"
                      data-testid={`stats-upload-dropzone-${m.id}`}
                    >
                      <input type="hidden" name="matchDayId" value={matchDayId} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <FormField
                        label="Screenshot"
                        hint="PNG / JPG / WEBP, max 10 MB"
                      >
                        <input
                          name="file"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          required
                          data-testid={`stats-upload-file-${m.id}`}
                          className="block w-full text-[11px] text-[var(--chalk-1)] file:mr-3 file:rounded-sm file:border file:border-[var(--ink-4)] file:bg-[var(--ink-2)] file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.18em] file:text-[var(--chalk-1)] hover:file:border-[var(--signal)] hover:file:text-[var(--signal)]"
                        />
                      </FormField>
                      <PrimaryButton
                        type="submit"
                        size="sm"
                        data-testid={`stats-upload-submit-${m.id}`}
                      >
                        Upload + parse
                      </PrimaryButton>
                    </form>
                  </div>

                  {/* Screenshot list */}
                  <div className="space-y-2">
                    {shots.length === 0 ? (
                      <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]/40 p-4 text-center text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                        No uploads yet
                      </div>
                    ) : (
                      shots.map((s) => (
                        <Link
                          key={s.id}
                          href={`/admin/match-days/${matchDayId}/stats-upload/${s.id}/review`}
                          data-testid={`stats-screenshot-row-${s.id}`}
                          className="flex items-center justify-between gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]/60 px-3 py-2.5 transition-colors hover:border-[var(--signal)] hover:bg-[var(--ink-1)]"
                        >
                          <div className="space-y-0.5">
                            <div className="font-mono text-[10px] text-[var(--chalk-3)] tabular">
                              {formatWat(s.uploaded_at, "yyyy-MM-dd HH:mm")}
                            </div>
                            {s.parsed_by_engine ? (
                              <div className="text-[9px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                                via {s.parsed_by_engine}
                              </div>
                            ) : null}
                            {s.notes ? (
                              <div className="text-[9px] text-[var(--chalk-3)] italic max-w-xs truncate">
                                {s.notes}
                              </div>
                            ) : null}
                          </div>
                          <StatusPill
                            status={s.parse_status}
                            data-testid={`stats-screenshot-status-${s.id}`}
                          />
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
