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
  PrimaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { textareaClass } from "@/components/admin/FormField";
import { listPending, type ContentPostRow } from "@/server/content";
import { formatWat } from "@/lib/time";
import { verifyPostAction, rejectPostAction } from "./actions";

export const dynamic = "force-dynamic";

async function resolveGate() {
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
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "content.verify");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: content.verify");
    throw e;
  }
  return svc;
}

export default async function AdminContentQueuePage() {
  const sb = await resolveGate();
  const pending = await listPending(sb, 100);

  // Resolve player display names.
  const playerIds = Array.from(new Set(pending.map((p) => p.player_id)));
  const playerMap = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: rows } = await sb
      .from("players")
      .select("id, gamer_tag, users:users!players_user_id_fkey(display_name)")
      .in("id", playerIds);
    type Row = {
      id: string;
      gamer_tag: string;
      users: { display_name: string } | null;
    };
    for (const r of (rows ?? []) as unknown as Row[]) {
      playerMap.set(r.id, r.users?.display_name ?? r.gamer_tag);
    }
  }

  const cols: DataTableColumn<ContentPostRow>[] = [
    {
      key: "submitted",
      label: "Submitted",
      render: (p) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-1)]">
          {formatWat(p.submitted_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "player",
      label: "Player",
      render: (p) => (
        <span className="text-[var(--chalk-0)]">
          {playerMap.get(p.player_id) ?? p.player_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "week",
      label: "Week",
      render: (p) => (
        <span className="font-mono text-xs text-[var(--chalk-2)]">
          {p.week_start}
        </span>
      ),
    },
    {
      key: "platform",
      label: "Platform",
      render: (p) => <StatusPill status={p.platform} tone="muted" />,
    },
    {
      key: "url",
      label: "URL",
      render: (p) => (
        <a
          href={p.post_url}
          target="_blank"
          rel="noopener"
          className="text-xs text-[var(--signal)] underline-offset-4 hover:underline"
        >
          open
        </a>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (p) => (
        <details
          className="inline-block"
          data-testid={`content-actions-${p.id}`}
        >
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]">
            Actions
          </summary>
          <div className="mt-2 flex flex-col items-end gap-2">
            <form action={verifyPostAction}>
              <input type="hidden" name="postId" value={p.id} />
              <PrimaryButton
                size="sm"
                type="submit"
                data-testid={`content-verify-${p.id}`}
              >
                Verify
              </PrimaryButton>
            </form>
            <form
              action={rejectPostAction}
              className="flex flex-col items-end gap-2"
            >
              <input type="hidden" name="postId" value={p.id} />
              <textarea
                name="reason"
                required
                minLength={10}
                rows={2}
                className={textareaClass + " w-64"}
                placeholder="rejection reason (≥10 chars)"
                data-testid={`content-reject-reason-${p.id}`}
              />
              <DangerButton
                size="sm"
                type="submit"
                data-testid={`content-reject-${p.id}`}
              >
                Reject
              </DangerButton>
            </form>
          </div>
        </details>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Content"
        title="Verification queue"
        description="Pending posts. Verify real posts on the stated platform; reject with a brief reason if the URL is broken, wrong platform, or duplicate."
      />
      <DataTable
        columns={cols}
        rows={pending}
        rowKey={(p) => p.id}
        testId="content-queue"
        rowAttrs={(p) => ({ "data-testid": `content-row-${p.id}` })}
        emptyLabel="Queue empty"
        emptyHint="All submissions processed. Players have 7 days to meet weekly obligations."
      />
    </div>
  );
}
