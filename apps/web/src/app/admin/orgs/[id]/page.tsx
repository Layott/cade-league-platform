import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton, DangerButton } from "@/components/admin/buttons";
import { FormField, selectClass } from "@/components/admin/FormField";
import { AuditTrail } from "@/components/admin/AuditTrail";
import {
  getOrgById,
  listPlayersForOrg,
  listContractsForOrg,
  listEntries,
  type LedgerEntry,
  type OrgContractRow,
} from "@/server/orgs";
import { formatWat } from "@/lib/time";
import { trySignedRead } from "@/server/storage/signed";
import {
  ORG_CONTRACTS_BUCKET,
} from "@/server/storage/paths";
import {
  softDeleteOrgAction,
  linkPlayerAction,
  unlinkPlayerAction,
  linkCoachAction,
  linkTeamManagerAction,
} from "./actions";

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
    await requirePermAsync(svc, { userId: pub.id, roles }, "orgs.read");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: orgs.read");
    throw e;
  }
  return svc;
}

function fmtCoins(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(n));
}

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sb = await resolveGate();
  const { id } = await params;
  const org = await getOrgById(sb, id);
  if (!org) return notFound();

  // Plan 31 — load coach + team-manager candidates (any user) so the
  // detail page can offer linking after a player has been added to the
  // org. Pulled inline so we don't pay the cost on the public side.
  const [players, contracts, ledger, unlinkedRoster, staffCandidates] =
    await Promise.all([
      listPlayersForOrg(sb, org.id),
      listContractsForOrg(sb, org.id),
      listEntries(sb, org.id, 50),
      sb
        .from("players")
        .select("id, gamer_tag, users:users!players_user_id_fkey!inner(display_name)")
        .is("organization_id", null)
        .is("deleted_at", null)
        .limit(100),
      sb
        .from("users")
        .select("id, display_name, email")
        .is("deleted_at", null)
        .order("display_name", { ascending: true })
        .limit(200),
    ]);

  type StaffCandidate = { id: string; display_name: string | null; email: string };
  const staffOptions = ((staffCandidates.data ?? []) as StaffCandidate[]).map(
    (u) => ({ id: u.id, label: u.display_name ?? u.email }),
  );

  // Plan 31 — fetch the linked coach + team-manager IDs for each org
  // player so the UI can show current assignment + offer "clear".
  const playerIds = players.map((p) => p.id);
  const { data: playerStaff } = playerIds.length
    ? await sb
        .from("players")
        .select("id, coach_id, team_manager_id")
        .in("id", playerIds)
    : { data: [] as Array<{ id: string; coach_id: string | null; team_manager_id: string | null }> };
  const staffByPlayer = new Map<
    string,
    { coachId: string | null; teamManagerId: string | null }
  >();
  for (const r of (playerStaff ?? []) as Array<{
    id: string;
    coach_id: string | null;
    team_manager_id: string | null;
  }>) {
    staffByPlayer.set(r.id, {
      coachId: r.coach_id,
      teamManagerId: r.team_manager_id,
    });
  }

  type UnlinkedRow = {
    id: string;
    gamer_tag: string;
    users: { display_name: string };
  };
  const unlinked = ((unlinkedRoster.data ?? []) as unknown as UnlinkedRow[]).map(
    (r) => ({ id: r.id, label: r.users.display_name ?? r.gamer_tag }),
  );

  // Sign each active contract row (Phase 1 admin-only, so signing is fine).
  const signedContracts: Array<
    OrgContractRow & { signedUrl: string | null }
  > = await Promise.all(
    contracts.map(async (c) => ({
      ...c,
      signedUrl: await trySignedRead(sb, ORG_CONTRACTS_BUCKET, c.contract_url, 300),
    })),
  );

  // Drift sanity check (spec §13 risk 7).
  const sumCoins = ledger.reduce(
    (acc, e) =>
      acc + (e.direction === "credit" ? e.amount_coins : -e.amount_coins),
    0,
  );
  const showLedgerAll = ledger.length < 50; // partial listing → skip drift warning
  const hasDrift =
    showLedgerAll && sumCoins !== org.caution_fee_balance_coins;

  const playerCols: DataTableColumn<(typeof players)[number]>[] = [
    {
      key: "tag",
      label: "Gamer tag",
      render: (p) => (
        <span className="font-display text-sm font-semibold text-[var(--chalk-0)]">
          {p.gamer_tag}
        </span>
      ),
    },
    {
      key: "name",
      label: "Display name",
      render: (p) => (
        <span className="text-[var(--chalk-1)]">{p.display_name}</span>
      ),
    },
    {
      key: "coach",
      label: "Coach (Plan 31)",
      render: (p) => {
        const cur = staffByPlayer.get(p.id)?.coachId ?? "";
        return (
          <form action={linkCoachAction} className="flex items-center gap-2">
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="playerId" value={p.id} />
            <select
              name="coachUserId"
              defaultValue={cur}
              className={selectClass}
              data-testid={`coach-select-${p.id}`}
            >
              <option value="">— none —</option>
              {staffOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:underline"
              data-testid={`coach-save-${p.id}`}
            >
              Save
            </button>
          </form>
        );
      },
    },
    {
      key: "manager",
      label: "Team manager (Plan 31)",
      render: (p) => {
        const cur = staffByPlayer.get(p.id)?.teamManagerId ?? "";
        return (
          <form
            action={linkTeamManagerAction}
            className="flex items-center gap-2"
          >
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="playerId" value={p.id} />
            <select
              name="teamManagerUserId"
              defaultValue={cur}
              className={selectClass}
              data-testid={`manager-select-${p.id}`}
            >
              <option value="">— none —</option>
              {staffOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:underline"
              data-testid={`manager-save-${p.id}`}
            >
              Save
            </button>
          </form>
        );
      },
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (p) => (
        <form action={unlinkPlayerAction}>
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="playerId" value={p.id} />
          <button
            type="submit"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)] hover:text-[var(--flare)]"
            data-testid={`unlink-${p.id}`}
          >
            Unlink
          </button>
        </form>
      ),
    },
  ];

  const contractCols: DataTableColumn<(typeof signedContracts)[number]>[] = [
    {
      key: "player",
      label: "Player",
      render: (c) => (
        <span className="font-mono text-xs text-[var(--chalk-2)]">
          {c.player_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "season",
      label: "Season",
      render: (c) => (
        <span className="font-mono text-xs text-[var(--chalk-3)]">
          {c.season_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (c) => <StatusPill status={c.status} />,
    },
    {
      key: "window",
      label: "Valid window",
      render: (c) => (
        <span className="text-xs text-[var(--chalk-1)]">
          {c.valid_from} → {c.valid_until}
        </span>
      ),
    },
    {
      key: "download",
      label: "",
      align: "right",
      render: (c) =>
        c.signedUrl ? (
          <a
            href={c.signedUrl}
            target="_blank"
            rel="noopener"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:underline"
          >
            Download
          </a>
        ) : (
          <span className="text-[10px] text-[var(--chalk-3)]">—</span>
        ),
    },
  ];

  const ledgerCols: DataTableColumn<LedgerEntry>[] = [
    {
      key: "at",
      label: "Entered (WAT)",
      render: (e) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-1)]">
          {formatWat(e.entered_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (e) => <StatusPill status={e.entry_type} />,
    },
    {
      key: "dir",
      label: "Direction",
      render: (e) => (
        <span
          className={
            "text-xs font-semibold uppercase tracking-[0.18em] " +
            (e.direction === "credit"
              ? "text-[var(--signal)]"
              : "text-[var(--flare)]")
          }
        >
          {e.direction}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (e) => (
        <span className="font-mono tabular text-[var(--chalk-0)]">
          {fmtCoins(e.amount_coins)}
        </span>
      ),
    },
    {
      key: "balance",
      label: "Balance after",
      align: "right",
      render: (e) => (
        <span className="font-mono tabular text-[var(--chalk-0)]">
          {fmtCoins(e.balance_after_coins)}
        </span>
      ),
    },
    {
      key: "ref",
      label: "Reference",
      render: (e) => (
        <span className="text-xs text-[var(--chalk-2)]">
          {e.reference ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-10">
      <SectionHeader
        eyebrow="Organization"
        title={org.name}
        description={
          <span className="flex items-center gap-2">
            <StatusPill status={org.status} />
          </span>
        }
        action={
          <form action={softDeleteOrgAction}>
            <input type="hidden" name="id" value={org.id} />
            <DangerButton type="submit" data-testid="org-suspend-btn">
              Suspend org
            </DangerButton>
          </form>
        }
      />

      {hasDrift ? (
        <div className="rounded-sm border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.08)] px-4 py-3 text-sm text-[var(--flare)]">
          ⚠ Balance drift detected: ledger sum {fmtCoins(sumCoins)} ≠ stored{" "}
          {fmtCoins(org.caution_fee_balance_coins)}. Book an adjustment to
          reconcile.
        </div>
      ) : null}

      {/* INFO — Plan 31: CAC removed; logo is now the org's identity asset. */}
      <section id="info" className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Info
        </h2>
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 text-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-start">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={org.logo_url}
                alt={`${org.name} logo`}
                className="h-24 w-24 flex-none rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] object-contain"
                data-testid="org-logo-img"
              />
            ) : (
              <div
                className="flex h-24 w-24 flex-none items-center justify-center rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)] font-display text-2xl font-bold text-[var(--chalk-3)]"
                data-testid="org-logo-empty"
                aria-hidden
              >
                {org.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <dl className="flex-1 grid gap-4 md:grid-cols-2">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Name
                </dt>
                <dd className="text-[var(--chalk-0)]">{org.name}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Balance (coins)
                </dt>
                <dd className="font-mono tabular text-[var(--chalk-0)]">
                  {fmtCoins(org.caution_fee_balance_coins)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Created
                </dt>
                <dd className="font-mono text-xs text-[var(--chalk-2)]">
                  {formatWat(org.created_at, "yyyy-MM-dd HH:mm")} WAT
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* PLAYERS */}
      <section id="players" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Players ({players.length})
          </h2>
        </div>
        <DataTable
          columns={playerCols}
          rows={players}
          rowKey={(p) => p.id}
          testId="org-players-table"
          emptyLabel="No players linked"
          emptyHint="Use the form below to link a player to this org."
        />
        <form
          action={linkPlayerAction}
          className="flex items-end gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          data-testid="org-link-form"
        >
          <input type="hidden" name="orgId" value={org.id} />
          <FormField label="Link a player" className="flex-1">
            <select
              name="playerId"
              required
              defaultValue=""
              className={selectClass}
              data-testid="org-link-player-select"
            >
              <option value="" disabled>
                — choose an unlinked player —
              </option>
              {unlinked.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </FormField>
          <PrimaryButton type="submit" data-testid="org-link-submit">
            Link player
          </PrimaryButton>
        </form>
      </section>

      {/* CONTRACTS */}
      <section id="contracts" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Contracts ({contracts.length})
          </h2>
          <Link href={`/admin/orgs/${org.id}/contracts/new`}>
            <PrimaryButton size="sm">+ New contract</PrimaryButton>
          </Link>
        </div>
        <DataTable
          columns={contractCols}
          rows={signedContracts}
          rowKey={(c) => c.id}
          testId="org-contracts-table"
          emptyLabel="No contracts on file"
        />
      </section>

      {/* LEDGER */}
      <section id="ledger" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Ledger ({ledger.length})
          </h2>
          <Link href={`/admin/orgs/${org.id}/ledger/new`}>
            <PrimaryButton size="sm" data-testid="ledger-new-btn">
              + Record entry
            </PrimaryButton>
          </Link>
        </div>
        <DataTable
          columns={ledgerCols}
          rows={ledger}
          rowKey={(e) => e.id}
          testId="org-ledger-table"
          rowAttrs={(e) => ({ "data-testid": `ledger-row-${e.id}` })}
          emptyLabel="No ledger entries yet"
        />
        <p className="text-xs text-[var(--chalk-3)]">
          Ledger entries are permanent. Use an{" "}
          <span className="font-mono">adjustment</span> entry to correct a
          mistake — there is no edit or delete UI.
        </p>
      </section>

      <AuditTrail entityType="organizations" entityId={org.id} />
    </div>
  );
}
