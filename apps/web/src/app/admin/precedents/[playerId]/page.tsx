import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { getPrecedents, type PrecedentRow } from "@/server/precedents";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { FormField, textareaClass, selectClass } from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import { adjustPrecedentAction } from "./actions";

export const dynamic = "force-dynamic";

async function resolveAdmin() {
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
  await requirePermAsync(sb, { userId: pub.id, roles }, "punishments.read");
  return { sb, actorId: pub.id as string };
}

const CATEGORY_LABEL: Record<string, string> = {
  late_arrival: "Late arrival",
  absent: "Absence",
  unauthorized_access: "Unauthorized access",
  equipment: "Equipment",
  social_media: "Social media",
  betting: "Betting",
  match_fixing: "Match fixing",
  dress_code: "Dress code",
  forfeit: "Forfeit",
  other: "Other",
};

export default async function PrecedentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { playerId } = await params;
  const { error } = await searchParams;
  const { sb } = await resolveAdmin();

  const { data: player } = await sb
    .from("players")
    .select("id, gamer_tag, users:user_id ( id, display_name )")
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) notFound();

  type PlayerRow = {
    id: string;
    gamer_tag: string;
    users: { id: string; display_name: string } | null;
  };
  const p = player as unknown as PlayerRow;
  const displayName = p.users?.display_name ?? "(no name)";

  const precedents = await getPrecedents(sb, playerId);
  const sorted: PrecedentRow[] = [...precedents].sort((a, b) => {
    if (a.offense_count !== b.offense_count) return b.offense_count - a.offense_count;
    return a.category.localeCompare(b.category);
  });

  const columns: DataTableColumn<PrecedentRow>[] = [
    {
      key: "category",
      label: "Category",
      render: (row) => (
        <StatusPill status={row.category}>
          {CATEGORY_LABEL[row.category] ?? row.category}
        </StatusPill>
      ),
    },
    {
      key: "count",
      label: "Count",
      align: "right",
      render: (row) => (
        <span className="font-mono text-base tabular text-[var(--chalk-0)]">
          {row.offense_count}
        </span>
      ),
    },
    {
      key: "last",
      label: "Last offence",
      render: (row) => (
        <span className="font-mono text-[12px] tabular text-[var(--chalk-2)]">
          {row.last_offense_at
            ? formatWat(row.last_offense_at, "yyyy-MM-dd · HH:mm")
            : "—"}
        </span>
      ),
    },
    {
      key: "case",
      label: "Last case",
      render: (row) =>
        row.last_case_id ? (
          <span className="font-mono text-xs text-[var(--signal)]">
            {row.last_case_id.slice(0, 8)}…
          </span>
        ) : (
          <span className="text-xs text-[var(--chalk-3)]">—</span>
        ),
    },
    {
      key: "adjust",
      label: "Adjust",
      align: "right",
      render: (row) => (
        <details className="inline-block text-left">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)] hover:text-[var(--chalk-0)]">
            Adjust ±1
          </summary>
          <form
            action={adjustPrecedentAction}
            className="mt-3 w-64 space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3"
          >
            <input type="hidden" name="playerId" value={playerId} />
            <input type="hidden" name="category" value={row.category} />
            <FormField label="Delta">
              <select name="delta" className={selectClass} defaultValue="+1">
                <option value="+1">+1 (add offence)</option>
                <option value="-1">−1 (remove offence)</option>
              </select>
            </FormField>
            <FormField
              label="Reason"
              hint="Required, minimum 6 characters. Logged to audit trail."
            >
              <textarea
                name="reason"
                required
                minLength={6}
                rows={2}
                placeholder="Why is this count being adjusted?"
                className={textareaClass}
              />
            </FormField>
            <PrimaryButton type="submit">Apply</PrimaryButton>
          </form>
        </details>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Precedents"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{displayName}</span>
            <span className="font-mono text-sm text-[var(--chalk-3)]">@{p.gamer_tag}</span>
          </span>
        }
        description="Per-category offence counts. Rule 5.4 ladder consults these on every new mark — adjust with care."
        action={
          <Link href="/admin/punishments">
            <SecondaryButton type="button">← Punishments</SecondaryButton>
          </Link>
        }
      />

      {error ? (
        <div className="rounded-sm border border-[rgba(255,91,59,0.35)] bg-[rgba(255,91,59,0.08)] p-3 text-sm text-[var(--flare)]">
          {decodeURIComponent(error)}
        </div>
      ) : null}

      <DataTable<PrecedentRow>
        columns={columns}
        rows={sorted}
        rowKey={(r) => r.category}
        emptyLabel="No precedents yet"
        emptyHint="This player has a clean record. Auto-upserts will appear here as marks accumulate."
        testId="precedents-table"
      />
    </div>
  );
}
