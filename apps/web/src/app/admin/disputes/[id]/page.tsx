import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  FormField,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import { AuditTrail } from "@/components/admin/AuditTrail";
import { getById, type DisputeRow } from "@/server/disputes";
import { trySignedRead } from "@/server/storage/signed";
import { DISPUTE_EVIDENCE_BUCKET } from "@/server/storage/paths";
import { formatWat } from "@/lib/time";
import { hasPermAsync } from "@/lib/perms-db";
import {
  assignDisputeAction,
  ruleDisputeAction,
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
  const actor = { userId: pub.id, roles };
  try {
    await requirePermAsync(svc, actor, "disputes.read");
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: disputes.read");
    }
    throw e;
  }
  const canRule = await hasPermAsync(svc, actor, "disputes.rule");
  return { sb: svc, canRule };
}

export default async function AdminDisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sb, canRule } = await resolveGate();
  const { id } = await params;
  const dispute: DisputeRow | null = await getById(sb, id);
  if (!dispute) return notFound();

  // Raiser + assigned display names.
  const userIds = new Set<string>();
  userIds.add(dispute.raised_by_user_id);
  if (dispute.assigned_to_user_id) userIds.add(dispute.assigned_to_user_id);
  const { data: userRows } = await sb
    .from("users")
    .select("id, display_name, email")
    .in("id", Array.from(userIds));
  const usersById = new Map<string, { display_name: string | null; email: string }>();
  for (const u of (userRows ?? []) as {
    id: string;
    display_name: string | null;
    email: string;
  }[]) {
    usersById.set(u.id, { display_name: u.display_name, email: u.email });
  }

  const raiser = usersById.get(dispute.raised_by_user_id);
  const assignee = dispute.assigned_to_user_id
    ? usersById.get(dispute.assigned_to_user_id)
    : null;

  // Possible assignees (admin or idc roles — double gate at action layer).
  const { data: admins } = await sb
    .from("user_roles")
    .select("user_id, role, users:users!user_roles_user_id_fkey(id, display_name, email)")
    .in("role", ["admin", "idc", "moderator"])
    .is("deleted_at", null);
  type AdminRow = {
    user_id: string;
    users: { id: string; display_name: string | null; email: string } | null;
  };
  const adminOpts = Array.from(
    new Map(
      ((admins ?? []) as unknown as AdminRow[])
        .filter((r) => !!r.users)
        .map((r) => [
          r.user_id,
          {
            id: r.user_id,
            label: r.users!.display_name ?? r.users!.email,
          },
        ]),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  // Signed URLs for evidence.
  const evidenceUrls: Array<{ path: string; url: string | null }> =
    await Promise.all(
      dispute.evidence_urls.map(async (p) => ({
        path: p,
        url: p.startsWith("http")
          ? p
          : await trySignedRead(sb, DISPUTE_EVIDENCE_BUCKET, p, 300),
      })),
    );

  const resolvedOrWithdrawn =
    dispute.status === "resolved" || dispute.status === "withdrawn";

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Dispute · ${dispute.subject_type}`}
        title={dispute.title ?? `Dispute ${dispute.id.slice(0, 8)}`}
        description={
          <span className="flex items-center gap-2">
            <StatusPill status={dispute.status} />
            <span className="text-xs text-[var(--chalk-3)]">
              opened {formatWat(dispute.opened_at, "yyyy-MM-dd HH:mm")} WAT
            </span>
          </span>
        }
      />

      <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 text-sm">
        <dl className="grid gap-4 md:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Raiser
            </dt>
            <dd className="text-[var(--chalk-0)]">
              {raiser?.display_name ?? raiser?.email ?? dispute.raised_by_user_id.slice(0, 8)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Subject reference
            </dt>
            <dd
              className="font-mono text-xs text-[var(--chalk-1)]"
              data-testid="dispute-subject-id"
            >
              {dispute.subject_id ?? "—"}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Title
            </dt>
            <dd
              className="text-[var(--chalk-0)]"
              data-testid="dispute-title"
            >
              {dispute.title ?? "—"}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Description
            </dt>
            <dd
              className="mt-1 whitespace-pre-wrap text-[var(--chalk-1)]"
              data-testid="dispute-description"
            >
              {dispute.description}
            </dd>
          </div>
          {evidenceUrls.length > 0 ? (
            <div className="md:col-span-2">
              <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                Evidence ({evidenceUrls.length})
              </dt>
              <dd className="mt-1 flex flex-col gap-1 text-xs">
                {evidenceUrls.map((e, i) =>
                  e.url ? (
                    <a
                      key={i}
                      href={e.url}
                      target="_blank"
                      rel="noopener"
                      className="font-mono text-[var(--signal)] hover:underline"
                    >
                      Evidence #{i + 1}
                    </a>
                  ) : (
                    <span key={i} className="font-mono text-[var(--chalk-3)]">
                      #{i + 1} unavailable
                    </span>
                  ),
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {canRule && !resolvedOrWithdrawn ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Assign to reviewer
          </h2>
          <form
            action={assignDisputeAction}
            className="mt-3 flex items-end gap-3"
            data-testid="dispute-assign-form"
          >
            <input type="hidden" name="disputeId" value={dispute.id} />
            <FormField label="Reviewer" className="flex-1">
              <select
                name="assignedToUserId"
                defaultValue={dispute.assigned_to_user_id ?? ""}
                className={selectClass}
                required
                data-testid="dispute-assignee"
              >
                <option value="" disabled>
                  — choose reviewer —
                </option>
                {adminOpts.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </FormField>
            <PrimaryButton type="submit" data-testid="dispute-assign-btn">
              Assign
            </PrimaryButton>
          </form>
        </section>
      ) : null}

      {canRule ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Rule on dispute
          </h2>
          {dispute.status === "resolved" ? (
            <p className="mt-2 text-xs text-[var(--chalk-3)]">
              Already resolved — ruling is locked.
            </p>
          ) : null}
          <form
            action={ruleDisputeAction}
            className="mt-3 space-y-3"
            data-testid="dispute-rule-form"
          >
            <input type="hidden" name="disputeId" value={dispute.id} />
            <FormField label="Ruling">
              <textarea
                name="ruling"
                required
                rows={5}
                maxLength={4000}
                defaultValue={dispute.ruling ?? ""}
                className={textareaClass}
                data-testid="dispute-ruling-text"
                disabled={resolvedOrWithdrawn}
              />
            </FormField>
            <PrimaryButton
              type="submit"
              disabled={resolvedOrWithdrawn}
              data-testid="dispute-rule-btn"
            >
              Rule
            </PrimaryButton>
          </form>
          {assignee ? (
            <p className="mt-3 text-[11px] text-[var(--chalk-3)]">
              Currently assigned to:{" "}
              <span className="text-[var(--chalk-1)]">
                {assignee.display_name ?? assignee.email}
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      <AuditTrail entityType="disputes" entityId={dispute.id} />
    </div>
  );
}
