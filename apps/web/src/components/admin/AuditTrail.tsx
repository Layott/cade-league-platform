import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { formatWat } from "@/lib/time";

/**
 * Plan 13B — Collapsed audit trail for a single entity. Rendered at the
 * bottom of every detail page (orgs, disputes, appeals). Reads via
 * service-role because `audit_events` is admin-only and we've already
 * gated the page with `requirePermAsync`.
 *
 * Falls back to `Audit unavailable` if the query fails — never 500s the
 * host page.
 */

type AuditRow = {
  id: string;
  action: string;
  created_at: string;
  actor_user_id: string | null;
};

export async function AuditTrail({
  entityType,
  entityId,
  limit = 20,
}: {
  entityType: string;
  entityId: string;
  limit?: number;
}) {
  let rows: AuditRow[] = [];
  try {
    const svc = getServiceRoleSupabase();
    const { data } = await svc
      .from("audit_events")
      .select("id, action, created_at, actor_user_id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit);
    rows = (data ?? []) as AuditRow[];
  } catch {
    rows = [];
  }

  return (
    <details
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-3"
      data-testid="audit-trail"
    >
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] hover:text-[var(--signal)]">
        Audit trail ({rows.length})
      </summary>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--chalk-3)]">
          No audit rows recorded.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-xs text-[var(--chalk-2)]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3">
              <span className="font-mono tabular text-[var(--chalk-3)]">
                {formatWat(r.created_at, "yyyy-MM-dd HH:mm")}
              </span>
              <span className="text-[var(--chalk-0)]">{r.action}</span>
              <span className="font-mono text-[10px] text-[var(--chalk-3)]">
                {r.actor_user_id ? r.actor_user_id.slice(0, 8) : "system"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
