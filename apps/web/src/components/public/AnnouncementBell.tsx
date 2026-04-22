"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnnouncementsModal } from "./AnnouncementsModal";

/**
 * Plan 40 §3.3 — AnnouncementBell (client island)
 *
 * Replaces the old <Link href="/announcements"> in the header. Polls
 * /api/notifications/unread-count on mount and every 60 s; click opens
 * <AnnouncementsModal /> which handles the list/detail swap + mark-read
 * mutations.
 *
 * Mount wiring into `SiteChrome` is the main thread's job (per P40-C
 * lane brief); this file ships the component only.
 *
 * Accessibility:
 *  - aria-label reflects live unread count.
 *  - After the modal closes, focus returns to the bell button via
 *    `bellButtonRef.current.focus()`.
 */

const POLL_INTERVAL_MS = 60_000;

export function AnnouncementBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const bellButtonRef = useRef<HTMLButtonElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications/unread-count", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { count: number };
      setCount(Math.max(0, data.count ?? 0));
    } catch {
      // Network hiccups are silent — the next tick will retry.
    }
  }, []);

  // Mount + 60 s polling. Tearing down in the cleanup closure stops the
  // interval when the component unmounts or props change.
  useEffect(() => {
    void fetchCount();
    const iv = window.setInterval(() => {
      void fetchCount();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, [fetchCount]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => {
    setOpen(false);
    // Re-fetch after close so the badge stays truthful even if the
    // modal's optimistic update diverged from server state.
    void fetchCount();
    // Restore focus to the bell per Plan 40 §7.
    bellButtonRef.current?.focus();
  }, [fetchCount]);

  const label =
    count > 0 ? `${count} unread announcements` : "Announcements";
  const displayCount = count > 99 ? "99+" : String(count);

  return (
    <>
      <button
        ref={bellButtonRef}
        type="button"
        onClick={handleOpen}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
        data-testid="announcement-bell"
      >
        <BellIcon />
        {count > 0 ? (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-[var(--flare)] px-1 py-0.5 text-[10px] font-bold leading-none text-white tabular"
            data-testid="announcement-bell-count"
          >
            {displayCount}
          </span>
        ) : null}
      </button>
      <AnnouncementsModal
        open={open}
        onClose={handleClose}
        onUnreadChange={setCount}
      />
    </>
  );
}

function BellIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v1" />
      <path d="M4 7a4 4 0 1 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z" />
      <path d="M6.5 13a1.6 1.6 0 0 0 3 0" />
    </svg>
  );
}
