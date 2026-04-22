"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdownToSafeHtml } from "@/lib/markdown";
import { formatWat } from "@/lib/time";

/**
 * Plan 40 §3.3 + §6 + §7 — AnnouncementsModal
 *
 * Hand-rolled accessible modal (no new dep). Two panes in the same
 * dialog: (1) list of visible announcements, (2) detail view with
 * rendered body_md + "Mark as read". The list/detail swap happens via
 * local state — the modal never unmounts between them, so the focus
 * trap survives the transition.
 *
 * Accessibility contract:
 *  - role="dialog" + aria-modal="true" on the panel.
 *  - Label via the internal <h2 id="announcements-title">.
 *  - ESC / backdrop click / X button close the modal.
 *  - Focus is trapped inside the panel; on open we move focus to the
 *    first interactive element; on close the parent restores focus to
 *    the bell (via `onClose` callback in <AnnouncementBell />).
 */

type Row = {
  id: string;
  title: string;
  body_md: string;
  priority: string;
  published_at: string | null;
  is_read: boolean;
};

export function AnnouncementsModal({
  open,
  onClose,
  onUnreadChange,
}: {
  open: boolean;
  onClose: () => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  // Fetch the visible list when the modal opens. We fetch every time
  // rather than cache across opens so the user sees freshly-published
  // announcements without a page refresh.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/notifications/announcements", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { rows: Row[] };
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
  }, [open]);

  // ESC to close + trap Tab within the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
  }, [open, onClose]);

  // Move initial focus into the dialog.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      firstFocusableRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const unreadCount = useMemo(() => rows.filter((r) => !r.is_read).length, [rows]);

  // Surface the unread count to the parent so the bell dot stays in sync
  // with optimistic mutations inside the modal.
  useEffect(() => {
    if (!open) return;
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange, open]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  );

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const markOne = useCallback(async (id: string) => {
    setMarking(true);
    // Optimistic: flip local state first so the dot disappears instantly.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true } : r)));
    try {
      const r = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      // Rollback on failure.
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, is_read: false } : row)));
      setError((e as Error).message);
    } finally {
      setMarking(false);
    }
  }, []);

  const markAll = useCallback(async () => {
    setMarking(true);
    const snapshot = rows;
    setRows((prev) => prev.map((r) => ({ ...r, is_read: true })));
    try {
      const r = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      setRows(snapshot);
      setError((e as Error).message);
    } finally {
      setMarking(false);
    }
  }, [rows]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onBackdropClick}
      data-testid="announcements-modal-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcements-title"
        className="relative flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] shadow-2xl"
        data-testid="announcements-modal"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-4">
          {selected ? (
            <button
              ref={firstFocusableRef}
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
              data-testid="announcements-modal-back"
            >
              <span aria-hidden>{"<"}</span>
              Back
            </button>
          ) : (
            <h2
              id="announcements-title"
              className="font-display text-base font-bold uppercase tracking-[0.18em] text-[var(--chalk-0)]"
            >
              Announcements
            </h2>
          )}
          <button
            ref={selected ? undefined : firstFocusableRef}
            type="button"
            onClick={onClose}
            aria-label="Close announcements"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-2)] transition-colors hover:border-[var(--flare)] hover:text-[var(--flare)]"
            data-testid="announcements-modal-close"
          >
            <span aria-hidden>{"×"}</span>
          </button>
        </header>

        {selected ? (
          <DetailPane
            row={selected}
            marking={marking}
            onMarkRead={() => markOne(selected.id)}
          />
        ) : (
          <ListPane
            rows={rows}
            loading={loading}
            error={error}
            onRowClick={(id) => setSelectedId(id)}
          />
        )}

        {selected ? null : (
          <footer className="flex items-center justify-between gap-3 border-t border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-3">
            <button
              type="button"
              onClick={markAll}
              disabled={marking || unreadCount === 0}
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="announcements-mark-all"
            >
              Mark all read
            </button>
            <span
              className="text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]"
              aria-live="polite"
            >
              {unreadCount} unread
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}

function ListPane({
  rows,
  loading,
  error,
  onRowClick,
}: {
  rows: Row[];
  loading: boolean;
  error: string | null;
  onRowClick: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-8 text-center text-sm text-[var(--chalk-3)]">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-8 text-center text-sm text-[var(--flare)]">
        Failed to load: {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-10 text-center text-sm text-[var(--chalk-3)]">
        No announcements yet.
      </div>
    );
  }
  return (
    <ul
      className="flex-1 divide-y divide-[var(--ink-4)] overflow-y-auto"
      data-testid="announcements-modal-list"
    >
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onRowClick(r.id)}
            className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--ink-2)] focus:bg-[var(--ink-2)] focus:outline-none"
            data-testid={`announcements-modal-row-${r.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {!r.is_read ? (
                  <span
                    aria-label="Unread"
                    className="inline-block h-2 w-2 rounded-full bg-[var(--signal)]"
                    data-testid="announcements-unread-dot"
                  />
                ) : (
                  <span aria-hidden className="inline-block h-2 w-2" />
                )}
                <h3
                  className={
                    "truncate font-display text-sm tracking-tight " +
                    (r.is_read
                      ? "text-[var(--chalk-2)]"
                      : "font-bold text-[var(--chalk-0)]")
                  }
                >
                  {r.title}
                </h3>
              </div>
              <p className="tabular mt-1 text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                {r.published_at
                  ? formatWat(r.published_at, "EEE dd MMM yyyy · HH:mm") +
                    " WAT"
                  : "unpublished"}
                {" · "}
                <span className="uppercase">{r.priority}</span>
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DetailPane({
  row,
  marking,
  onMarkRead,
}: {
  row: Row;
  marking: boolean;
  onMarkRead: () => void;
}) {
  const html = useMemo(() => renderMarkdownToSafeHtml(row.body_md), [row.body_md]);
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h3 className="font-display text-xl font-bold leading-tight tracking-tight text-[var(--chalk-0)]">
          {row.title}
        </h3>
        <p className="tabular mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          {row.published_at
            ? formatWat(row.published_at, "EEE dd MMM yyyy · HH:mm") + " WAT"
            : "unpublished"}
          {" · "}
          <span className="uppercase">{row.priority}</span>
        </p>
        <div
          className="cade-prose mt-4 text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <div className="flex justify-end gap-3 border-t border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-3">
        <button
          type="button"
          onClick={onMarkRead}
          disabled={marking || row.is_read}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="announcements-mark-one"
        >
          {row.is_read ? "Read" : "Mark as read"}
        </button>
      </div>
    </div>
  );
}
