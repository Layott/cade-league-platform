import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { listDeleted } from "@/server/trash";
import { TRASH_ENTITIES, isTrashEntityType } from "@/server/trash/entities";
import { RestoreButton } from "@/components/admin/RestoreButton";
import { PurgeButtonStub } from "@/components/admin/PurgeButtonStub";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "deleted_at" || key === "published_at" || key === "effective_from") {
    try {
      return formatWat(String(value), "yyyy-MM-dd HH:mm");
    } catch {
      return String(value);
    }
  }
  if (key === "scheduled_time") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export default async function TrashEntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  if (!isTrashEntityType(entity)) notFound();

  // Perm gate. Middleware admits multiple staff roles to /admin/*; only
  // those holding `trash.restore` should see deleted rows (which include
  // PII for users / players / disciplinary cases).
  const userSb = await getServerSupabase();
  const { data: auth } = await userSb.auth.getUser();
  if (!auth?.user) notFound();
  const { data: pub } = await userSb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) notFound();
  const { data: roleRows } = await userSb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const def = TRASH_ENTITIES[entity];
  const sb = getServiceRoleSupabase();
  await requirePermAsync(sb, { userId: pub.id, roles }, "trash.restore");
  const { rows, missingTable } = await listDeleted(sb, entity);

  return (
    <section className="space-y-4" data-testid="trash-entity-section">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg font-bold text-[var(--chalk-0)]">
          {def.label}
        </h3>
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          {missingTable ? "schema pending" : `${rows.length} row(s)`}
        </span>
      </div>

      {missingTable ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]">
          Schema not yet migrated. Table{" "}
          <code className="rounded-sm bg-[var(--ink-3)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--chalk-1)]">
            {def.table}
          </code>{" "}
          does not exist yet.
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]"
          data-testid="trash-empty"
        >
          Nothing deleted in{" "}
          <b className="text-[var(--chalk-1)]">{def.label}</b>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
          <table
            className="w-full text-sm text-[var(--chalk-1)]"
            data-testid="trash-table"
          >
            <thead>
              <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                {def.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="px-4 py-2.5 text-left font-semibold"
                  >
                    {c.label}
                  </th>
                ))}
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right font-semibold"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const rowId = String(row.id ?? "");
                return (
                  <tr
                    key={rowId}
                    className={
                      "border-b border-[var(--ink-4)]/70 last:border-b-0 " +
                      (idx % 2 === 1 ? "bg-[var(--ink-3)]/30" : "")
                    }
                    data-testid="trash-row"
                    data-entity={entity}
                    data-id={rowId}
                  >
                    {def.columns.map((c) => (
                      <td
                        key={c.key}
                        className={
                          "px-4 py-3 " +
                          (c.key === "deleted_at" ||
                          c.key === "published_at" ||
                          c.key === "effective_from" ||
                          c.key === "scheduled_time"
                            ? "font-mono text-[12px] tabular text-[var(--chalk-2)]"
                            : "text-[var(--chalk-1)]")
                        }
                      >
                        {formatCell(c.key, row[c.key])}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-4">
                        <RestoreButton entityType={entity} id={rowId} />
                        <PurgeButtonStub />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
