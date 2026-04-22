import Link from "next/link";
import { createMatchDayAction } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { StatusPill } from "@/components/admin/StatusPill";
import { getServiceRoleSupabase } from "@/lib/supabase/service";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMatchDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

function ErrorBanner({
  error,
  date,
  detail,
}: {
  error?: string;
  date?: string;
  detail?: string;
}) {
  if (!error) return null;
  let message = "Unable to create match day. Try again.";
  if (error === "duplicate-date") {
    message = `A match day already exists on ${date ?? "that date"}. Pick a different date or edit the existing one from the list below.`;
  } else if (error === "no-active-season") {
    message =
      "No active season is configured. Check the seasons table — exactly one season must have status='active'.";
  } else if (error === "create-failed" && detail) {
    message = `Create failed: ${detail}`;
  }
  return (
    <div
      role="alert"
      data-testid="md-create-error"
      style={{
        background: "rgba(255,91,59,0.1)",
        border: "1px solid rgba(255,91,59,0.4)",
        color: "var(--flare)",
        padding: "12px 14px",
        borderRadius: 4,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
}

async function loadExistingMatchDays(): Promise<
  { id: string; match_date: string; venue_name: string; status: string; published_at: string | null; match_count: number }[]
> {
  const sb = getServiceRoleSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();
  if (!season) return [];
  const { data } = await sb
    .from("match_days")
    .select("id, match_date, venue_name, status, published_at, matches:matches(count)")
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .order("match_date", { ascending: true });
  return (data ?? []).map((row: { id: string; match_date: string; venue_name: string; status: string; published_at: string | null; matches: { count: number }[] | null }) => ({
    id: row.id,
    match_date: row.match_date,
    venue_name: row.venue_name,
    status: row.status,
    published_at: row.published_at,
    match_count: row.matches?.[0]?.count ?? 0,
  }));
}

export default async function NewMatchDayPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; date?: string; detail?: string }>;
}) {
  const [sp, existing] = await Promise.all([searchParams, loadExistingMatchDays()]);
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="New session"
        title="Lock in a match day"
        description="Set the date, venue and call-time. Fixtures are added from the detail page once the match day exists."
      />

      <ErrorBanner error={sp.error} date={sp.date} detail={sp.detail} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <form
          action={createMatchDayAction}
          className="space-y-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
        >
          <FormField label="Match date">
            <input
              name="matchDate"
              type="date"
              required
              aria-label="Match date"
              className={inputClass}
              defaultValue={sp.date ?? ""}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Arrival cutoff" hint="West Africa Time (WAT)">
              <input
                name="arrivalCutoffTime"
                type="time"
                required
                defaultValue="18:00"
                className={inputClass}
              />
            </FormField>
            <FormField label="Kick-off" hint="West Africa Time (WAT)">
              <input
                name="matchStartTime"
                type="time"
                required
                defaultValue="19:00"
                className={inputClass}
              />
            </FormField>
          </div>
          <FormField label="Venue">
            <input
              name="venueName"
              type="text"
              required
              aria-label="Venue"
              defaultValue="CADE HQ"
              className={inputClass}
            />
          </FormField>
          <FormField label="Notes" hint="Optional. Call-up rules, dress code, etc.">
            <textarea name="notes" rows={3} className={textareaClass} />
          </FormField>

          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton type="submit">Create</PrimaryButton>
            <Link href="/admin/match-days">
              <SecondaryButton type="button">Cancel</SecondaryButton>
            </Link>
          </div>
        </form>

        <aside
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-5"
          data-testid="existing-match-days"
        >
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.28em",
              color: "var(--chalk-3)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Existing match days · {existing.length}
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--chalk-2)",
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            Avoid these dates — the unique constraint on (season, date) blocks
            duplicates. Click a row to open + edit it.
          </p>
          {existing.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--chalk-3)",
                fontStyle: "italic",
              }}
            >
              No match days seeded yet.
            </div>
          ) : (
            <ol
              className="space-y-1.5"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {existing.map((md) => (
                <li key={md.id}>
                  <Link
                    href={`/admin/match-days/${md.id}`}
                    className="block rounded-sm border border-transparent transition-colors"
                    style={{
                      padding: "8px 10px",
                      background: "var(--ink-2)",
                      borderColor: "var(--ink-3)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <span
                          className="font-broadcast-accent"
                          style={{
                            fontSize: 14,
                            color: "var(--chalk-0)",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {formatMatchDate(md.match_date)}
                        </span>
                        <span
                          className="tabular"
                          style={{
                            fontSize: 11,
                            color: "var(--chalk-3)",
                            marginTop: 2,
                          }}
                        >
                          {md.venue_name} · {md.match_count} matches
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill
                          tone={md.published_at ? "signal" : "muted"}
                          uppercase
                        >
                          {md.published_at ? "published" : "draft"}
                        </StatusPill>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
