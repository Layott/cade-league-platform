"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatWat } from "@/lib/time";

/**
 * 2026-04-24 — NotificationsDropdown
 *
 * Dropdown panel anchored near the bell showing the 10 most-recent
 * notifications for the signed-in user across every kind (dispute,
 * appeal, squad, punishment, match, generic). Click a row → POSTs
 * mark-read + navigates to `href` if present. "Mark all read" button +
 * link to full /notifications page at the bottom.
 *
 * Rendered into a portal so it escapes the sticky-header stacking
 * context. Closes on ESC, backdrop click, and the Close button.
 */

export type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  email_sent_at: string | null;
  delivered_channels: string[];
};

export function NotificationsDropdown({
  onClose,
  onRowMarkedRead,
  onMarkedAllRead,
}: {
  onClose: () => void;
  onRowMarkedRead?: () => void;
  onMarkedAllRead?: () => void;
}) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const router = useRouter();

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/notifications/all?limit=10", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { rows: NotificationRow[] };
        if (cancelled) return;
        setRows(data.rows ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC + focus trap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(() => {
      firstFocusableRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const unreadCount = useMemo(
    () => rows.filter((r) => !r.read_at).length,
    [rows],
  );

  const markOne = useCallback(
    async (id: string, row: NotificationRow) => {
      if (row.read_at) return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, read_at: new Date().toISOString() } : r,
        ),
      );
      onRowMarkedRead?.();
      try {
        await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      } catch {
        // silent; the next poll will reconcile
      }
    },
    [onRowMarkedRead],
  );

  const handleRowClick = useCallback(
    async (row: NotificationRow, e: React.MouseEvent) => {
      // If the row has a href, we both mark-read and route. Otherwise just
      // mark-read in place. Right-click + ctrl/cmd-click fall through to
      // the anchor's native behavior so "open in new tab" still works.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      await markOne(row.id, row);
      if (row.href) {
        onClose();
        router.push(row.href);
      }
    },
    [markOne, onClose, router],
  );

  const markAll = useCallback(async () => {
    if (unreadCount === 0) return;
    setMarking(true);
    const snapshot = rows;
    setRows((prev) =>
      prev.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })),
    );
    onMarkedAllRead?.();
    try {
      const r = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      setRows(snapshot);
      setError((e as Error).message);
    } finally {
      setMarking(false);
    }
  }, [rows, unreadCount, onMarkedAllRead]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 backdrop-blur-[2px]"
      onClick={onBackdropClick}
      data-testid="notifications-dropdown-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-dd-title"
        className="flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] shadow-2xl"
        data-testid="notifications-dropdown"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-3">
          <h2
            id="notifications-dd-title"
            className="font-display text-sm font-bold uppercase tracking-[0.18em] text-[var(--chalk-0)]"
          >
            Notifications
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-2)] transition-colors hover:border-[var(--flare)] hover:text-[var(--flare)]"
            data-testid="notifications-dropdown-close"
          >
            <span aria-hidden>{"×"}</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto" data-testid="notifications-dropdown-list">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--chalk-3)]">
              Loading…
            </div>
          ) : error ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--flare)]">
              Failed to load: {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--chalk-3)]">
              No notifications yet.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--ink-4)]">
              {rows.map((r, idx) => {
                const href = r.href ?? "#";
                return (
                  <li key={r.id}>
                    <Link
                      ref={idx === 0 ? firstFocusableRef : undefined}
                      href={href}
                      onClick={(e) => handleRowClick(r, e)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ink-2)] focus:bg-[var(--ink-2)] focus:outline-none"
                      data-testid={`notifications-row-${r.id}`}
                    >
                      <div className="pt-1.5">
                        {!r.read_at ? (
                          <span
                            aria-label="Unread"
                            className="inline-block h-2 w-2 rounded-full bg-[var(--signal)]"
                            data-testid="notifications-unread-dot"
                          />
                        ) : (
                          <span aria-hidden className="inline-block h-2 w-2" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={
                            "truncate text-[13px] " +
                            (r.read_at
                              ? "text-[var(--chalk-2)]"
                              : "font-bold text-[var(--chalk-0)]")
                          }
                        >
                          {r.title ?? "(no title)"}
                        </div>
                        {r.body ? (
                          <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--chalk-3)]">
                            {r.body}
                          </p>
                        ) : null}
                        <p className="tabular mt-1 text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                          {formatWat(r.created_at, "EEE dd MMM · HH:mm")} WAT ·{" "}
                          <span>{humanType(r.type)}</span>
                          {r.email_sent_at ? " · emailed" : ""}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-2.5">
          <button
            type="button"
            onClick={markAll}
            disabled={marking || unreadCount === 0}
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="notifications-mark-all"
          >
            Mark all read
          </button>
          <Link
            href="/notifications"
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-2)] transition-colors hover:text-[var(--signal)]"
            data-testid="notifications-view-all"
          >
            View all →
          </Link>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function humanType(t: string): string {
  return t.replace(/_/g, " ");
}
