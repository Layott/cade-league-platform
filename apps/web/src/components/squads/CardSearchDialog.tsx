"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 30 — typeahead search modal.
 *
 * Opens when the player clicks an empty slot. Debounces the input 250ms,
 * hits `POST /api/fcdb/search`, renders ≤10 results as clickable rows.
 * Arrow-key navigation + Enter to select. Esc + overlay click close.
 *
 * Empty catalogue path: if the endpoint returns `{ results: [] }` after a
 * non-trivial query, show the "No matches — ask admin to import catalogue"
 * fallback banner rather than a loading spinner.
 */

export type CardSearchDialogProps = {
  open: boolean;
  slotLabel: string; // "LB", "CAM", ...
  onClose: () => void;
  onPick: (card: CardSearchResult) => void;
};

const DEBOUNCE_MS = 250;

export function CardSearchDialog({
  open,
  slotLabel,
  onClose,
  onPick,
}: CardSearchDialogProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      setLoading(false);
      setError(null);
      setSearched(false);
      setCursor(0);
      return;
    }
    // Autofocus after next paint.
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/fcdb/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: q.trim(), position: slotLabel }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error ?? `search failed: ${res.status}`);
        }
        const body = (await res.json()) as { results: CardSearchResult[] };
        setResults(body.results);
        setSearched(true);
        setCursor(0);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, slotLabel]);

  function pick(card: CardSearchResult) {
    onPick(card);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      pick(results[cursor]);
    }
  }

  if (!open) return null;

  return (
    <div
      data-testid="card-search-dialog"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 -z-10 cursor-default"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-4 shadow-lg">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Slot · {slotLabel}
            </div>
            <div className="font-display text-lg font-bold text-[var(--chalk-0)]">
              Search for a card
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-[var(--ink-4)] px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--chalk-2)] hover:border-[var(--flare)] hover:text-[var(--flare)]"
          >
            Close
          </button>
        </header>

        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Start typing a name (2+ chars)…"
          data-testid="card-search-input"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-2 text-sm text-[var(--chalk-0)] placeholder:text-[var(--chalk-3)] focus:border-[var(--signal)] focus:outline-none"
        />

        <div
          data-testid="card-search-results"
          className="mt-3 flex-1 overflow-y-auto rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
        >
          {loading ? (
            <div className="p-4 text-xs text-[var(--chalk-3)]">Searching…</div>
          ) : error ? (
            <div
              data-testid="card-search-error"
              className="p-4 text-xs text-[var(--flare)]"
            >
              {error}
            </div>
          ) : searched && results.length === 0 ? (
            <div
              data-testid="card-search-empty"
              className="p-4 text-xs text-[var(--chalk-3)]"
            >
              No matches — ask an admin to import the card catalogue.
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-xs text-[var(--chalk-3)]">
              Type at least 2 characters to search.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--ink-4)]">
              {results.map((r, idx) => {
                const variantLabel = r.variant ?? "Normal";
                const rowTitle = `${r.name} — ${r.rating} — ${variantLabel}`;
                return (
                  <li
                    key={r.id}
                    data-testid={`card-search-result-${idx}`}
                    data-active={idx === cursor ? "true" : undefined}
                    title={rowTitle}
                    className={
                      "flex items-center gap-3 p-2 transition-colors " +
                      (idx === cursor
                        ? "bg-[var(--ink-4)]"
                        : "hover:bg-[var(--ink-3)]")
                    }
                  >
                    {r.cardImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.cardImageUrl}
                        alt={rowTitle}
                        width={40}
                        height={56}
                        loading="lazy"
                        decoding="async"
                        className="h-[56px] w-[40px] flex-shrink-0 rounded-sm bg-[var(--ink-2)] object-contain"
                        data-testid={`card-search-thumb-${idx}`}
                      />
                    ) : (
                      <div
                        data-testid={`card-search-thumb-fallback-${idx}`}
                        className="flex h-[56px] w-[40px] flex-shrink-0 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] font-display text-[11px] font-black text-[var(--chalk-2)]"
                      >
                        {r.rating}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-sm font-bold text-[var(--chalk-0)]">
                        {r.name}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--signal)]"
                        data-testid={`card-search-variant-${idx}`}
                      >
                        {variantLabel}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--chalk-3)]">
                        {r.rating} {r.position} · {r.club ?? "—"} · {r.nation ?? "—"}
                      </div>
                      {r.priceCoins != null ? (
                        <div className="mt-0.5 font-mono text-[10px] text-[var(--chalk-2)]">
                          {r.priceCoins.toLocaleString()} coins
                        </div>
                      ) : (
                        <div className="mt-0.5 font-mono text-[10px] text-[var(--chalk-3)]">
                          price: —
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => pick(r)}
                      className="rounded-sm bg-[var(--signal)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-black hover:brightness-110"
                    >
                      Pick
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
