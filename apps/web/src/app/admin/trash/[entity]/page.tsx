import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
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
    // scheduled_time may be a time-of-day string; render raw.
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

  const def = TRASH_ENTITIES[entity];
  const sb = await getServerSupabase();
  const { rows, missingTable } = await listDeleted(sb, entity);

  return (
    <section className="space-y-3" data-testid="trash-entity-section">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{def.label}</h3>
        <span className="text-xs text-gray-500">
          {missingTable ? "schema pending" : `${rows.length} row(s)`}
        </span>
      </div>

      {missingTable ? (
        <div className="border border-dashed rounded-md p-6 text-center text-gray-500 text-sm">
          Schema not yet migrated. Table{" "}
          <code className="font-mono">{def.table}</code> does not exist yet.
        </div>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 text-sm py-6" data-testid="trash-empty">
          Nothing deleted in <b>{def.label}</b>.
        </p>
      ) : (
        <table
          className="w-full text-sm border bg-white"
          data-testid="trash-table"
        >
          <thead className="bg-slate-100">
            <tr>
              {def.columns.map((c) => (
                <th key={c.key} className="text-left p-2">
                  {c.label}
                </th>
              ))}
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowId = String(row.id ?? "");
              return (
                <tr
                  key={rowId}
                  className="border-t"
                  data-testid="trash-row"
                  data-entity={entity}
                  data-id={rowId}
                >
                  {def.columns.map((c) => (
                    <td key={c.key} className="p-2">
                      {formatCell(c.key, row[c.key])}
                    </td>
                  ))}
                  <td className="p-2 flex gap-3 items-center">
                    <RestoreButton entityType={entity} id={rowId} />
                    <PurgeButtonStub />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
