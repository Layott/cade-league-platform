import type { ReactNode } from "react";

/**
 * DataTable renders the house-standard dark admin table:
 *   - sticky-thead, zebra rows, hairline borders
 *   - tiny uppercase column headers (matches eyebrow style)
 *   - empty-state row with brand-voice copy
 *
 * Columns are rendered by a header key + a `render(row)` callback so the
 * caller keeps full control over cell markup. Pass `testId` to attach a
 * stable `data-testid` to the <table> element (E2E).
 */

export type DataTableColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = "Nothing here yet.",
  emptyHint,
  testId,
  rowAttrs,
  className = "",
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  emptyHint?: ReactNode;
  testId?: string;
  rowAttrs?: (row: T) => Record<string, string | undefined>;
  className?: string;
}) {
  return (
    <div
      className={
        "overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] " +
        className
      }
    >
      <table
        className="w-full text-sm text-[var(--chalk-1)]"
        data-testid={testId}
      >
        <thead>
          <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={
                  "px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] " +
                  (c.align === "right"
                    ? "text-right "
                    : c.align === "center"
                      ? "text-center "
                      : "text-left ") +
                  (c.className ?? "")
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center"
              >
                <div className="mx-auto max-w-md space-y-1">
                  <div className="font-display text-base text-[var(--chalk-1)]">
                    {emptyLabel}
                  </div>
                  {emptyHint ? (
                    <div className="text-xs text-[var(--chalk-3)]">
                      {emptyHint}
                    </div>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const extra = rowAttrs?.(row) ?? {};
              return (
                <tr
                  key={rowKey(row)}
                  {...extra}
                  className={
                    "border-b border-[var(--ink-4)]/70 transition-colors last:border-b-0 hover:bg-[var(--ink-3)]/80 " +
                    (idx % 2 === 1 ? "bg-[var(--ink-3)]/30" : "")
                  }
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={
                        "px-4 py-3 align-top " +
                        (c.align === "right"
                          ? "text-right "
                          : c.align === "center"
                            ? "text-center "
                            : "text-left ") +
                        (c.className ?? "")
                      }
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
