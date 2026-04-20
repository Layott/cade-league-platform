import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokeSession } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { DangerButton } from "@/components/admin/buttons";

type Row = {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  started_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export default async function SessionsPage() {
  const sb = await getServerSupabase();

  const {
    data: { user: currentUser },
  } = await sb.auth.getUser();
  let currentUserPublicId: string | null = null;
  if (currentUser) {
    const { data: pub } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", currentUser.id)
      .maybeSingle();
    currentUserPublicId = pub?.id ?? null;
  }

  const { data: sessions } = await sb
    .from("sessions")
    .select(
      "id, user_id, ip_address, user_agent, started_at, last_seen_at, revoked_at",
    )
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(100);

  const rows = (sessions ?? []) as Row[];

  const columns: DataTableColumn<Row>[] = [
    {
      key: "started",
      label: "Started",
      render: (s) => (
        <span className="font-mono text-[12px] text-[var(--chalk-1)] tabular">
          {formatWat(s.started_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "user",
      label: "User",
      render: (s) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-2)]">
          {s.user_id.slice(0, 8)}…
          {s.user_id === currentUserPublicId ? (
            <span className="ml-2 rounded-sm border border-[var(--signal)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--signal)]">
              you
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "ip",
      label: "IP",
      render: (s) => (
        <span className="font-mono text-[12px] text-[var(--chalk-2)] tabular">
          {s.ip_address ?? "—"}
        </span>
      ),
    },
    {
      key: "ua",
      label: "User agent",
      render: (s) => (
        <span
          className="block max-w-[240px] truncate text-[11px] text-[var(--chalk-3)]"
          title={s.user_agent ?? ""}
        >
          {s.user_agent ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (s) => (
        <StatusPill status={s.revoked_at ? "revoked" : "active"} />
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (s) =>
        !s.revoked_at ? (
          <form action={revokeSession}>
            <input type="hidden" name="sessionId" value={s.id} />
            <DangerButton type="submit" size="sm">
              Revoke
            </DangerButton>
          </form>
        ) : (
          <span className="text-[var(--chalk-3)] text-xs">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Security"
        title="Recent sessions"
        description="Active sign-ins across all devices. Your own session is tagged. Revoking a session forces the device to re-authenticate."
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        rowAttrs={(s) => ({
          "data-current":
            s.user_id === currentUserPublicId ? "true" : undefined,
        })}
        emptyLabel="No sessions recorded"
        emptyHint="Sessions start appearing once someone signs in."
      />
    </div>
  );
}
