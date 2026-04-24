import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, hasPermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  FormField,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import Link from "next/link";
import { DangerButton, PrimaryButton } from "@/components/admin/buttons";
import { AuditTrail } from "@/components/admin/AuditTrail";
import { DeadlineBadge } from "@/components/admin/DeadlineBadge";
import {
  getById,
  listEffectsForAppeal,
  type AppealRow,
} from "@/server/appeals";
import { trySignedRead } from "@/server/storage/signed";
import { APPEAL_EVIDENCE_BUCKET } from "@/server/storage/paths";
import { formatWat } from "@/lib/time";
import {
  assignPanelAction,
  ruleAppealAction,
  undoAppealRulingAction,
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
    await requirePermAsync(svc, actor, "appeals.read");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: appeals.read");
    throw e;
  }
  const canRule = await hasPermAsync(svc, actor, "appeals.rule");
  return { sb: svc, canRule };
}

export default async function AdminAppealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sb, canRule } = await resolveGate();
  const { id } = await params;
  const appeal: AppealRow | null = await getById(sb, id);
  if (!appeal) return notFound();

  // Fetch linked case.
  const { data: discCase } = await sb
    .from("disciplinary_cases")
    .select("id, incident_type, opened_at, notes, status")
    .eq("id", appeal.disciplinary_case_id)
    .maybeSingle();

  // User lookups (submitter + every panel member).
  const userIds = new Set<string>();
  userIds.add(appeal.submitted_by_user_id);
  appeal.panel_member_user_ids.forEach((u) => userIds.add(u));
  const { data: userRows } = await sb
    .from("users")
    .select("id, display_name, email, deleted_at")
    .in("id", Array.from(userIds));
  const usersById = new Map<
    string,
    { display_name: string | null; email: string; deleted_at: string | null }
  >();
  for (const u of (userRows ?? []) as {
    id: string;
    display_name: string | null;
    email: string;
    deleted_at: string | null;
  }[]) {
    usersById.set(u.id, {
      display_name: u.display_name,
      email: u.email,
      deleted_at: u.deleted_at,
    });
  }
  const submitter = usersById.get(appeal.submitted_by_user_id);

  // Eligible panel candidates = users holding admin or idc role.
  const { data: idcRows } = await sb
    .from("user_roles")
    .select("user_id, role, users:users!user_roles_user_id_fkey(id, display_name, email, deleted_at)")
    .in("role", ["admin", "idc"])
    .is("deleted_at", null);
  type IdcRow = {
    user_id: string;
    users: {
      id: string;
      display_name: string | null;
      email: string;
      deleted_at: string | null;
    } | null;
  };
  const candidateMap = new Map<
    string,
    { id: string; label: string }
  >();
  for (const r of (idcRows ?? []) as unknown as IdcRow[]) {
    if (!r.users || r.users.deleted_at) continue;
    if (candidateMap.has(r.user_id)) continue;
    candidateMap.set(r.user_id, {
      id: r.user_id,
      label: r.users.display_name ?? r.users.email,
    });
  }
  const panelCandidates = Array.from(candidateMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  // Signed URLs for evidence.
  const evidenceUrls: Array<{ path: string; url: string | null }> =
    await Promise.all(
      appeal.evidence_urls.map(async (p) => ({
        path: p,
        url: p.startsWith("http")
          ? p
          : await trySignedRead(sb, APPEAL_EVIDENCE_BUCKET, p, 300),
      })),
    );

  const ruleLocked =
    appeal.status === "ruled" ||
    appeal.status === "withdrawn" ||
    appeal.status === "expired";
  const pastDeadline = new Date(appeal.deadline_at).getTime() < Date.now();

  // Plan 50: when the appeal is ruled UPHELD, list the disciplinary
  // actions this appeal currently holds in a revoked state so the admin
  // can see + undo the cascade. `listEffectsForAppeal` scans by the
  // `[appeal:<id>]` prefix on `revoke_reason` — durable discriminator.
  const effects =
    appeal.status === "ruled" && appeal.outcome === "upheld"
      ? await listEffectsForAppeal(sb, appeal.id)
      : { actions: [], voidedMatches: [] };
  const stillRevokedCount = effects.actions.filter((a) => a.revoked_at).length;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Appeal"
        title={`Appeal ${appeal.id.slice(0, 8)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={appeal.status} />
            <DeadlineBadge
              deadlineIso={appeal.deadline_at}
              status={appeal.status}
              data-testid="appeal-deadline-badge"
            />
            <span className="text-xs text-[var(--chalk-3)]">
              Deadline: {formatWat(appeal.deadline_at, "EEE yyyy-MM-dd HH:mm")}{" "}
              WAT
            </span>
          </span>
        }
      />

      {/* CASE */}
      <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
        <h2 className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Disciplinary case
        </h2>
        {discCase ? (
          <div className="mt-3 space-y-1 text-sm">
            <div className="font-mono text-xs text-[var(--chalk-3)]">
              {discCase.id}
            </div>
            <div className="text-[var(--chalk-0)]">
              {discCase.incident_type} · status{" "}
              <span className="font-mono">{discCase.status}</span>
            </div>
            <div className="font-mono text-xs text-[var(--chalk-2)]">
              {discCase.opened_at
                ? formatWat(discCase.opened_at, "yyyy-MM-dd HH:mm")
                : "—"}
            </div>
            {discCase.notes ? (
              <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--chalk-1)]">
                {discCase.notes}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--chalk-3)]">
            Linked case not found.
          </p>
        )}
      </section>

      {/* APPELLANT */}
      <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
        <h2 className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Appellant
        </h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="text-[var(--chalk-0)]">
            {submitter?.display_name ?? submitter?.email ?? "—"}
          </div>
          <p
            className="whitespace-pre-wrap text-xs text-[var(--chalk-1)]"
            data-testid="appeal-grounds"
          >
            {appeal.grounds}
          </p>
          {evidenceUrls.length > 0 ? (
            <div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                Evidence
              </div>
              <ul className="mt-1 flex flex-col gap-1 text-xs">
                {evidenceUrls.map((e, i) =>
                  e.url ? (
                    <li key={i}>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener"
                        className="font-mono text-[var(--signal)] hover:underline"
                      >
                        Evidence #{i + 1}
                      </a>
                    </li>
                  ) : (
                    <li key={i} className="font-mono text-[var(--chalk-3)]">
                      #{i + 1} unavailable
                    </li>
                  ),
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* PANEL */}
      {canRule ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            IDC panel
          </h2>
          <form
            action={assignPanelAction}
            className="mt-3 space-y-3"
            data-testid="appeal-panel-form"
          >
            <input type="hidden" name="appealId" value={appeal.id} />
            {[0, 1, 2].map((i) => (
              <FormField key={i} label={`Panel member ${i + 1}`}>
                <select
                  name={`member${i + 1}`}
                  defaultValue={appeal.panel_member_user_ids[i] ?? ""}
                  required
                  className={selectClass}
                  data-testid={`panel-member-${i + 1}`}
                >
                  <option value="" disabled>
                    — choose IDC member —
                  </option>
                  {panelCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </FormField>
            ))}
            <PrimaryButton type="submit" data-testid="appeal-panel-save">
              Save panel
            </PrimaryButton>
          </form>
        </section>
      ) : null}

      {/* PANEL SUMMARY (read-only for non-rulers, or current value for rulers) */}
      {appeal.panel_member_user_ids.length > 0 ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Current panel
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {appeal.panel_member_user_ids.map((uid) => {
              const u = usersById.get(uid);
              if (!u) {
                return (
                  <li key={uid} className="text-xs text-[var(--chalk-3)]">
                    [unknown user {uid.slice(0, 8)}]
                  </li>
                );
              }
              return (
                <li key={uid} className="text-[var(--chalk-1)]">
                  {u.display_name ?? u.email}
                  {u.deleted_at ? " (deactivated)" : ""}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* RULE */}
      {canRule ? (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Ruling
          </h2>
          {pastDeadline && !ruleLocked ? (
            <p className="mt-2 text-xs text-[var(--amber)]">
              Deadline has passed — ruling will be tagged [LATE RULING].
            </p>
          ) : null}
          {ruleLocked && appeal.outcome ? (
            <p className="mt-2 text-xs text-[var(--chalk-2)]">
              Ruled{" "}
              <span
                data-testid="appeal-outcome-pill"
                className={
                  appeal.outcome === "upheld"
                    ? "rounded-sm border border-[var(--primary)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--primary)]"
                    : "rounded-sm border border-[var(--ink-5)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-2)]"
                }
              >
                {appeal.outcome}
              </span>{" "}
              on{" "}
              {appeal.ruled_at
                ? formatWat(appeal.ruled_at, "yyyy-MM-dd HH:mm")
                : "—"}
            </p>
          ) : null}
          <form
            action={ruleAppealAction}
            className="mt-3 space-y-3"
            data-testid="appeal-rule-form"
          >
            <input type="hidden" name="appealId" value={appeal.id} />
            <FormField label="Outcome">
              <select
                name="outcome"
                required
                defaultValue={appeal.outcome ?? ""}
                disabled={ruleLocked}
                className={selectClass}
                data-testid="appeal-outcome-select"
              >
                <option value="" disabled>
                  — choose outcome —
                </option>
                <option value="upheld">
                  Upheld — auto-revoke linked punishment(s)
                </option>
                <option value="dismissed">
                  Dismissed — sanction stays in force
                </option>
              </select>
            </FormField>
            <FormField label="Ruling text">
              <textarea
                name="ruling"
                required
                rows={5}
                maxLength={4000}
                className={textareaClass}
                defaultValue={appeal.ruling ?? ""}
                disabled={ruleLocked}
                data-testid="appeal-ruling-text"
              />
            </FormField>
            <PrimaryButton
              type="submit"
              disabled={ruleLocked}
              data-testid="appeal-rule-btn"
            >
              Rule
            </PrimaryButton>
          </form>
        </section>
      ) : null}

      {/* EFFECTS (upheld cascades) + UNDO (Plan 50) */}
      {appeal.status === "ruled" && appeal.outcome === "upheld" ? (
        <section
          className="rounded-sm border border-[var(--primary)]/40 bg-[var(--ink-2)] p-5"
          data-testid="appeal-effects-section"
        >
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-[var(--primary)]">
            Cascaded effects
          </h2>
          {stillRevokedCount > 0 ? (
            <>
              <p
                className="mt-2 text-sm text-[var(--chalk-1)]"
                data-testid="appeal-effects-summary"
              >
                <span className="font-mono text-[var(--signal)]">
                  {stillRevokedCount}
                </span>{" "}
                disciplinary{" "}
                {stillRevokedCount === 1 ? "action" : "actions"} auto-revoked
                by this upheld appeal. Any matches that a ban within this
                cascade had voided were automatically restored and standings
                recomputed.
              </p>
              <ul className="mt-3 space-y-1 font-mono text-[11px] tabular text-[var(--chalk-1)]">
                {effects.actions.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/admin/punishments/${a.id}`}
                      className="hover:text-[var(--signal)]"
                    >
                      {a.sanction_type} · {a.id.slice(0, 8)}…
                    </Link>
                    {a.effective_from ? (
                      <span className="text-[var(--chalk-3)]">
                        {" "}
                        · window {a.effective_from}
                        {a.effective_until ? `→${a.effective_until}` : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canRule ? (
                <form
                  action={undoAppealRulingAction}
                  className="mt-4"
                  data-testid="appeal-undo-form"
                >
                  <input type="hidden" name="appealId" value={appeal.id} />
                  <DangerButton
                    type="submit"
                    data-testid="appeal-undo-btn"
                  >
                    Undo appeal ruling
                  </DangerButton>
                  <p className="mt-2 text-[11px] text-[var(--chalk-3)]">
                    Un-revokes the cascaded punishments and resets this
                    appeal to <span className="font-mono">under_review</span>{" "}
                    so the panel can rule again. Ban-triggered voids will be
                    re-propagated automatically by the DB.
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--chalk-3)]">
              No cascaded revokes found — either the linked case had no
              live actions at ruling time, or an admin has already reversed
              every revoke on its own via the punishment detail page.
            </p>
          )}
        </section>
      ) : null}

      <AuditTrail entityType="appeals" entityId={appeal.id} />
    </div>
  );
}
