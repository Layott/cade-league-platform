import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import {
  currentWeekStart,
  getStatusForPlayerWeek,
  listForPlayerWeek,
  type ContentPostRow,
} from "@/server/content";
import { formatWat } from "@/lib/time";
import { submitPostAction } from "./actions";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/player/content");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player/content");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "content.submit");
    await requirePermAsync(svc, { userId: pub.id, roles }, "content.read.own");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: content");
    throw e;
  }

  const { data: player } = await svc
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) throw new Error("No player linked to your account.");
  return { sb: svc, userId: pub.id, playerId: (player as { id: string }).id };
}

// Last N Mondays including the current week start.
function recentWeekOptions(count = 3): string[] {
  const cur = currentWeekStart();
  const out: string[] = [cur];
  const [y, m, d] = cur.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 1; i < count; i++) {
    anchor.setUTCDate(anchor.getUTCDate() - 7);
    out.push(anchor.toISOString().slice(0, 10));
  }
  return out;
}

export default async function PlayerContentPage() {
  const { sb, playerId } = await resolveGate();
  const weekStart = currentWeekStart();
  const [status, posts] = await Promise.all([
    getStatusForPlayerWeek(sb, playerId, weekStart),
    listForPlayerWeek(sb, playerId, weekStart),
  ]);

  const cols: DataTableColumn<ContentPostRow>[] = [
    {
      key: "url",
      label: "URL",
      render: (p) => (
        <a
          href={p.post_url}
          target="_blank"
          rel="noopener"
          className="text-xs text-[var(--signal)] hover:underline"
        >
          open
        </a>
      ),
    },
    {
      key: "platform",
      label: "Platform",
      render: (p) => <StatusPill status={p.platform} tone="muted" />,
    },
    {
      key: "status",
      label: "Status",
      render: (p) => <StatusPill status={p.verification_status} />,
    },
    {
      key: "reason",
      label: "Rejection reason",
      render: (p) => (
        <span className="line-clamp-2 text-xs text-[var(--chalk-2)]">
          {p.rejection_reason ?? "—"}
        </span>
      ),
    },
    {
      key: "submitted",
      label: "Submitted",
      render: (p) => (
        <span className="font-mono text-[11px] text-[var(--chalk-3)]">
          {formatWat(p.submitted_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Week of ${weekStart}`}
        title="Content obligation"
        description="Weekly: at least one verified post on at least two platforms."
      />

      <section
        data-testid="content-obligation-card"
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              This week
            </div>
            <div className="mt-1 font-display text-xl text-[var(--chalk-0)]">
              {status.post_count} post{status.post_count === 1 ? "" : "s"} ·{" "}
              {status.verified_platforms} verified platform
              {status.verified_platforms === 1 ? "" : "s"}
            </div>
          </div>
          <StatusPill
            tone={status.met ? "signal" : "flare"}
            data-testid="content-met-chip"
          >
            {status.met ? "Met" : "Unmet"}
          </StatusPill>
        </div>
      </section>

      <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
        <h2 className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Submit a post
        </h2>
        <form
          action={submitPostAction}
          className="mt-3 space-y-3"
          data-testid="content-submit-form"
        >
          <input type="hidden" name="playerId" value={playerId} />
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Week">
              <select
                name="weekStart"
                defaultValue={weekStart}
                className={selectClass}
                data-testid="content-week"
              >
                {recentWeekOptions(3).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Platform">
              <select
                name="platform"
                required
                defaultValue="instagram"
                className={selectClass}
                data-testid="content-platform"
              >
                <option value="instagram">Instagram</option>
                <option value="twitter">Twitter / X</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </select>
            </FormField>
            <FormField label="Post URL (https://)">
              <input
                type="url"
                name="postUrl"
                required
                pattern="https://.*"
                className={inputClass}
                data-testid="content-url"
              />
            </FormField>
          </div>
          <PrimaryButton type="submit" data-testid="content-submit-btn">
            Submit post
          </PrimaryButton>
        </form>
      </section>

      <DataTable
        columns={cols}
        rows={posts}
        rowKey={(p) => p.id}
        testId="player-content-posts"
        rowAttrs={(p) => ({ "data-testid": `player-post-row-${p.id}` })}
        emptyLabel="No posts this week"
        emptyHint="Submit above — we'll review within 48h."
      />
    </div>
  );
}
