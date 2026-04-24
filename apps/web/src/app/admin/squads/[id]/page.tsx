import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  getSubmissionWithItems,
  getRuleForSeason,
  evaluateRules,
  createSignedRead,
  reviewSquadAgainstFCDB,
  type ItemForValidation,
  type SquadItemReview,
} from "@/server/squads";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  PrimaryButton,
  DangerButton,
  SecondaryButton,
} from "@/components/admin/buttons";
import { FormField, textareaClass } from "@/components/admin/FormField";
import { ViolationList } from "@/components/squads/ViolationChip";
import {
  FcdbBadge,
  FcdbSummaryChip,
} from "@/components/squads/FcdbBadge";
import {
  approveAction,
  rejectAction,
  acceptFcdbCandidateAction,
  reopenSubmissionAction,
} from "./actions";
import { ReopenSubmissionButton } from "@/components/admin/ReopenSubmissionButton";

export const dynamic = "force-dynamic";

export default async function AdminSquadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const data = await getSubmissionWithItems(sb, id);
  if (!data) notFound();
  const { submission, items } = data;

  const rule = await getRuleForSeason(sb, submission.season_id);
  const ruleForEval = rule
    ? {
        maxBudgetCoins: rule.max_budget_coins,
        minNigerianItems: rule.min_nigerian_items,
        bannedItemTypes: rule.banned_item_types,
      }
    : { maxBudgetCoins: 0, minNigerianItems: 0, bannedItemTypes: [] as string[] };

  const itemsForEval: ItemForValidation[] = items.map((it) => ({
    name: it.name,
    rating: it.rating,
    position: it.position,
    value: it.value,
    itemType: it.item_type as ItemForValidation["itemType"],
    nationalityFlag: it.nationality_flag,
    slotIndex: it.slot_index,
  }));
  const { ok, violations } = evaluateRules(itemsForEval, ruleForEval);

  // Plan 23 — FCDB enrichment. Tolerates empty FCDB (every item flagged
  // unknown with a runbook reason; banner rendered above the table).
  // Failures here MUST NOT break the page — refs still need to approve
  // / reject. Catch + degrade to "no FCDB data" rendering.
  let fcdb: Awaited<ReturnType<typeof reviewSquadAgainstFCDB>> = {
    items: [],
    summary: {
      total: items.length,
      resolved: 0,
      fuzzy: 0,
      ambiguous: 0,
      unknown: items.length,
      fcdbEmpty: true,
    },
  };
  try {
    fcdb = await reviewSquadAgainstFCDB(sb, id);
  } catch {
    // Swallow — UI shows the empty banner. Operator notices via dev log.
  }
  const reviewByItem = new Map<string, SquadItemReview>();
  for (const r of fcdb.items) reviewByItem.set(r.itemId, r);

  // Signed URL for screenshot (5 min). Use service-role in case the admin's
  // session can't read the bucket directly — safe since this is a server
  // component authenticated behind /admin middleware.
  let screenshotUrl: string | null = null;
  try {
    const svc = getServiceRoleSupabase();
    screenshotUrl = await createSignedRead(svc, submission.futbin_screenshot_path, 300);
  } catch {
    screenshotUrl = null;
  }

  // Plan 10 extension — load the live Friday change request (if any) so
  // admins can see the player's proposed formation/slot/swap delta.
  const { data: changeRow } = await sb
    .from("squad_change_requests")
    .select(
      `id, created_at, new_formation, new_slot_positions,
       player_out_name, player_out_item_id,
       player_in_name, player_in_item_type, player_in_rating, player_in_value,
       player_in_nationality_flag,
       authorized_by_ref_user_id,
       ref:users!squad_change_requests_authorized_by_ref_user_id_fkey (display_name)`,
    )
    .eq("submission_id", id)
    .is("deleted_at", null)
    .maybeSingle();

  const itemById = new Map(items.map((it) => [it.id, it]));

  const isPending = submission.validation_status === "pending";

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Week of ${submission.week_start_date}`}
        title={`${submission.player?.display_name ?? "Player"}'s squad`}
        description={`Submitted ${formatWat(submission.submitted_at, "yyyy-MM-dd HH:mm")} WAT`}
        action={
          <div className="flex items-center gap-3">
            <FcdbSummaryChip summary={fcdb.summary} />
            <StatusPill status={submission.validation_status} />
            <Link href="/admin/squads">
              <SecondaryButton>Back</SecondaryButton>
            </Link>
          </div>
        }
      />

      {fcdb.summary.fcdbEmpty ? (
        <div
          data-testid="fcdb-empty-banner"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3 text-xs text-[var(--chalk-2)]"
        >
          <span className="font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)]">
            FCDB empty —
          </span>{" "}
          run{" "}
          <code className="rounded-sm bg-[var(--ink-3)] px-1 py-0.5 font-mono text-[11px]">
            ./scrape-futbin-full.bat
          </code>{" "}
          (Windows) to seed from Futbin and enable per-item validation.
          Submission can still be reviewed manually below.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Futbin screenshot
          </h2>
          {screenshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screenshotUrl}
              alt="Futbin squad screenshot"
              className="w-full rounded-sm border border-[var(--ink-4)]"
              data-testid="squad-screenshot"
            />
          ) : (
            <div className="rounded-sm border border-dashed border-[var(--ink-4)] p-6 text-sm text-[var(--chalk-3)]">
              Screenshot unavailable (signed URL failed).
            </div>
          )}
        </section>

        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Rule check {ok ? "— clean" : "— violations"}
          </h2>
          <ViolationList items={violations} />

          <h3 className="mt-6 mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Items ({items.length})
          </h3>
          <div className="overflow-visible">
            <table
              className="w-full text-xs text-[var(--chalk-1)]"
              data-testid="squad-items-table"
            >
              <thead>
                <tr className="border-b border-[var(--ink-4)]">
                  <th className="px-2 py-1 text-left">Slot</th>
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-right">OVR</th>
                  <th className="px-2 py-1 text-left">Pos</th>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-right">Value</th>
                  <th className="px-2 py-1 text-left">Flag</th>
                  <th className="px-2 py-1 text-left">FCDB</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const review = reviewByItem.get(it.id);
                  return (
                    <tr key={it.id} className="border-b border-[var(--ink-4)]/50">
                      <td className="px-2 py-1 font-mono text-[var(--chalk-3)]">
                        {it.slot_index}
                      </td>
                      <td className="px-2 py-1">{it.name}</td>
                      <td className="px-2 py-1 text-right tabular">{it.rating}</td>
                      <td className="px-2 py-1">{it.position}</td>
                      <td className="px-2 py-1">{it.item_type}</td>
                      <td className="px-2 py-1 text-right tabular">
                        {it.value.toLocaleString()}
                      </td>
                      <td className="px-2 py-1">{it.nationality_flag ?? "—"}</td>
                      <td className="px-2 py-1">
                        {review ? (
                          <FcdbBadge
                            review={review}
                            onPickAction={async (formData) => {
                              "use server";
                              formData.append("submissionId", submission.id);
                              await acceptFcdbCandidateAction(formData);
                            }}
                          />
                        ) : (
                          <span className="text-[var(--chalk-3)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {changeRow ? (
        <section
          data-testid="change-request-panel"
          className="rounded-sm border border-[rgba(107,205,6,0.35)] bg-[rgba(107,205,6,0.04)] p-4"
        >
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">
            Friday change request
          </h2>
          <p className="mb-3 text-xs text-[var(--chalk-3)]">
            Filed {formatWat(changeRow.created_at, "yyyy-MM-dd HH:mm")} WAT ·
            Authorised by{" "}
            <span className="font-semibold text-[var(--chalk-1)]">
              {(() => {
                // Supabase PostgREST embed shape depends on FK metadata —
                // narrow to a null-tolerant display_name read either way.
                const ref = changeRow.ref as unknown as
                  | { display_name: string | null }
                  | Array<{ display_name: string | null }>
                  | null;
                if (!ref) return changeRow.authorized_by_ref_user_id;
                if (Array.isArray(ref)) {
                  return ref[0]?.display_name ?? changeRow.authorized_by_ref_user_id;
                }
                return ref.display_name ?? changeRow.authorized_by_ref_user_id;
              })()}
            </span>
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                Formation
              </div>
              <div
                data-testid="change-formation-value"
                className="mt-1 font-mono text-sm text-[var(--chalk-0)]"
              >
                {changeRow.new_formation ?? "— unchanged"}
              </div>
            </div>
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                Slot rearrangement
              </div>
              <div
                data-testid="change-slot-plan"
                className="mt-1 text-xs text-[var(--chalk-0)]"
              >
                {changeRow.new_slot_positions ? (
                  <ul className="font-mono text-[11px] text-[var(--chalk-1)]">
                    {(
                      changeRow.new_slot_positions as Array<
                        | { kind: "existing"; itemId: string }
                        | { kind: "new" }
                      >
                    ).map((entry, idx) => {
                      if (entry.kind === "new") {
                        return (
                          <li key={idx} className="text-[var(--primary)]">
                            Slot {idx}: NEW ({changeRow.player_in_name ?? "?"})
                          </li>
                        );
                      }
                      const item = itemById.get(entry.itemId);
                      return (
                        <li key={idx}>
                          Slot {idx}:{" "}
                          {item ? (
                            <>
                              {item.name}{" "}
                              <span className="text-[var(--chalk-3)]">
                                (was #{item.slot_index})
                              </span>
                            </>
                          ) : (
                            "(unknown)"
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <span className="text-[var(--chalk-3)]">— unchanged</span>
                )}
              </div>
            </div>
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                Card swap
              </div>
              <div
                data-testid="change-swap-value"
                className="mt-1 text-xs text-[var(--chalk-0)]"
              >
                {changeRow.player_in_name ? (
                  <>
                    <div>
                      <span className="text-[var(--chalk-3)]">OUT:</span>{" "}
                      {changeRow.player_out_name ?? "?"}
                    </div>
                    <div>
                      <span className="text-[var(--primary)]">IN:</span>{" "}
                      {changeRow.player_in_name}{" "}
                      <span className="text-[var(--chalk-3)]">
                        ({changeRow.player_in_rating} ·{" "}
                        {changeRow.player_in_item_type})
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-[var(--chalk-3)]">— no swap</span>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <form
            action={async () => {
              "use server";
              await approveAction(submission.id);
            }}
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          >
            <h3 className="mb-2 font-display text-sm font-semibold text-[var(--chalk-0)]">
              Approve
            </h3>
            <p className="mb-3 text-xs text-[var(--chalk-3)]">
              Locks the submission and publishes it to the player profile.
            </p>
            <PrimaryButton type="submit" data-testid="squad-approve-btn">
              Approve squad
            </PrimaryButton>
          </form>

          <form
            action={rejectAction}
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          >
            <input type="hidden" name="submissionId" value={submission.id} />
            <h3 className="mb-2 font-display text-sm font-semibold text-[var(--chalk-0)]">
              Reject
            </h3>
            <FormField label="Reason" hint="Required. Shared with the player.">
              <textarea
                name="reason"
                required
                minLength={3}
                rows={3}
                className={textareaClass}
                data-testid="squad-reject-reason"
              />
            </FormField>
            <div className="mt-3">
              <DangerButton type="submit" data-testid="squad-reject-btn">
                Reject squad
              </DangerButton>
            </div>
          </form>
        </div>
      ) : (
        <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-xs text-[var(--chalk-2)]">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {submission.validation_status === "rejected" &&
              submission.rejection_reason ? (
                <>
                  <span className="font-semibold uppercase tracking-[0.18em] text-[var(--flare)]">
                    Rejected:
                  </span>{" "}
                  {submission.rejection_reason}
                </>
              ) : (
                <>Decision locked — reopen to let the player resubmit.</>
              )}
            </div>
            {submission.validation_status === "approved" ||
            submission.validation_status === "rejected" ? (
              <ReopenSubmissionButton
                submissionId={submission.id}
                priorStatus={
                  submission.validation_status as "approved" | "rejected"
                }
                reopenAction={reopenSubmissionAction}
              />
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
