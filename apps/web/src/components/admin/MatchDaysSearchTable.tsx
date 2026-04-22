"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { inputClass } from "@/components/admin/FormField";
import { formatWat } from "@/lib/time";

/**
 * Plan 26 — admin /admin/match-days search bar + filtered list. The page
 * loads every match day with its participant gamer_tags up front so this
 * client component can filter without another network hit. URL state via
 * `?q=` keeps the search reload-stable and shareable.
 */

export type MatchDayRow = {
  id: string;
  match_date: string;
  venue_name: string;
  status: string;
  match_count: number;
  player_tags: string[];
};

export function MatchDaysSearchTable({
  rows,
  initialQuery,
}: {
  rows: MatchDayRow[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return rows;
    return rows.filter((r) =>
      r.player_tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const columns: DataTableColumn<MatchDayRow>[] = [
    {
      key: "date",
      label: "Date",
      render: (d) => (
        <span className="font-mono text-[13px] text-[var(--chalk-0)] tabular">
          {formatWat(`${d.match_date}T00:00:00Z`, "EEE · MMM d yyyy")}
        </span>
      ),
    },
    {
      key: "venue",
      label: "Venue",
      render: (d) => (
        <span className="text-[var(--chalk-1)]">{d.venue_name}</span>
      ),
    },
    {
      key: "fixtures",
      label: "Fixtures",
      align: "right",
      render: (d) => (
        <span className="tabular text-[var(--chalk-1)]">{d.match_count}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (d) => <StatusPill status={d.status} />,
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (d) => (
        <div className="flex justify-end gap-3 text-xs font-semibold uppercase tracking-[0.18em]">
          <Link
            href={`/admin/match-days/${d.id}`}
            className="text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Manage
          </Link>
          <Link
            href={`/admin/match-days/${d.id}/attendance`}
            className="text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Attendance
          </Link>
        </div>
      ),
    },
  ];

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    // Mirror to URL so refresh / share preserves the search.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (v.trim().length === 0) url.searchParams.delete("q");
      else url.searchParams.set("q", v);
      window.history.replaceState(null, "", url.toString());
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="search"
          value={query}
          onChange={onChange}
          placeholder="Filter by player tag (e.g. ADEFOLA, MITCH)"
          aria-label="Filter match days by player"
          className={inputClass + " max-w-md"}
          data-testid="match-days-search"
        />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] tabular">
          {filtered.length} of {rows.length}
        </span>
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        emptyLabel={query.trim() ? "No match days match that player." : "Schedule drop pending"}
        emptyHint={
          query.trim() ? null : (
            <>
              No match days on the books yet. Use{" "}
              <span className="text-[var(--signal)]">New match day</span> to
              lock in the next session.
            </>
          )
        }
        testId="match-days-table"
      />
    </div>
  );
}
