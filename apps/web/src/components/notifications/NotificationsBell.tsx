"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { NotificationsDropdown } from "./NotificationsDropdown";

/**
 * 2026-04-24 — NotificationsBell (client island).
 *
 * Replaces the announcement-only <AnnouncementBell />. Polls
 * /api/notifications/unread-count on mount + subscribes to Supabase
 * Realtime INSERTs on `public.notifications` filtered to `user_id=self`
 * so the badge bumps within ~1s of the admin action. Click opens
 * <NotificationsDropdown /> with the 10 most-recent rows — a row click
 * marks it read + deep-links into the referenced resource.
 *
 * Props:
 *   - userId (string) — resolved server-side; the bell needs the public
 *     users.id to filter the realtime stream.
 *
 * Realtime subscription is best-effort. If the channel subscribe fails
 * we fall back to the 60 s poll so the badge still reflects reality.
 */

const POLL_INTERVAL_MS = 60_000;

export function NotificationsBell({ userId }: { userId: string }) {
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
      // silent — next poll or realtime push will reconcile
    }
  }, []);

  // Mount + 60 s polling fallback.
  useEffect(() => {
    void fetchCount();
    const iv = window.setInterval(() => {
      void fetchCount();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, [fetchCount]);

  // Realtime INSERT subscription — bump the count live when an admin
  // fires `notify()` elsewhere.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const sb = getBrowserSupabase();
    const channel = sb
      .channel(`notifications:${userId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new?: { read_at: string | null; deleted_at: string | null } }) => {
          if (cancelled) return;
          // Only bump if the inserted row is actually unread + live.
          if (
            payload.new &&
            payload.new.read_at === null &&
            payload.new.deleted_at === null
          ) {
            setCount((c) => c + 1);
          }
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [userId]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => {
    setOpen(false);
    void fetchCount();
    bellButtonRef.current?.focus();
  }, [fetchCount]);

  const onRowMarkedRead = useCallback(() => {
    setCount((c) => Math.max(0, c - 1));
  }, []);

  const onMarkedAllRead = useCallback(() => {
    setCount(0);
  }, []);

  const label =
    count > 0 ? `${count} unread notifications` : "Notifications";
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
        data-testid="notifications-bell"
      >
        <BellIcon />
        {count > 0 ? (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-[var(--flare)] px-1 py-0.5 text-[10px] font-bold leading-none text-white tabular"
            data-testid="notifications-bell-count"
          >
            {displayCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <NotificationsDropdown
          onClose={handleClose}
          onRowMarkedRead={onRowMarkedRead}
          onMarkedAllRead={onMarkedAllRead}
        />
      ) : null}
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
