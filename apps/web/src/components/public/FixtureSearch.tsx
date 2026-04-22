"use client";

import { useMemo, useState } from "react";
import { FixtureList, type FixtureGroup } from "./FixtureList";
import { filterFixtures } from "@/server/matches/search";

/**
 * Plan 26 — public /fixtures search bar. Owns the query string, filters
 * the loaded fixture groups in JS via the shared `filterFixtures` helper
 * (single source of truth for the matching rule), and mirrors the search
 * to ?q= for shareable URLs.
 */

const inputClass =
  "w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-0)] placeholder:text-[var(--chalk-3)] focus:border-[var(--signal)] focus:outline-none focus:ring-1 focus:ring-[var(--signal)]";

export function FixtureSearch({
  groups,
  initialQuery,
}: {
  groups: FixtureGroup[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");

  const filtered = useMemo(() => filterFixtures(groups, query), [groups, query]);
  const totalShown = filtered.reduce((n, g) => n + g.fixtures.length, 0);
  const totalAll = groups.reduce((n, g) => n + g.fixtures.length, 0);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (v.trim().length === 0) url.searchParams.delete("q");
      else url.searchParams.set("q", v);
      window.history.replaceState(null, "", url.toString());
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="block w-full max-w-md">
          <span className="sr-only">Filter fixtures by player</span>
          <input
            type="search"
            value={query}
            onChange={onChange}
            placeholder="Search fixtures by player (e.g. ADEFOLA, MITCH)"
            className={inputClass}
            data-testid="public-fixtures-search"
          />
        </label>
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] tabular">
          Showing {totalShown} of {totalAll} fixtures
        </span>
      </div>
      <FixtureList groups={filtered} />
    </div>
  );
}
