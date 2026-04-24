"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * 2026-04-24 — Filter chip + "Mark all read" bar for /notifications.
 *
 * The page reads `?kind=...&unread=1` and renders rows server-side;
 * this client island updates the querystring + fires the mark-all-read
 * API endpoint. Keeps the page fully navigable without JS (each chip is
 * a real link).
 */

export function NotificationsFilters({
  currentKind,
  unreadOnly,
  kinds,
}: {
  currentKind: string | null;
  unreadOnly: boolean;
  kinds: readonly string[];
}) {
  const router = useRouter();
  const [marking, setMarking] = useState(false);

  const buildHref = useCallback(
    (kind: string | null, unread: boolean) => {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (unread) params.set("unread", "1");
      const qs = params.toString();
      return qs ? `/notifications?${qs}` : "/notifications";
    },
    [],
  );

  const markAll = useCallback(async () => {
    setMarking(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      router.refresh();
    } finally {
      setMarking(false);
    }
  }, [router]);

  // Filter out internal / never-used-yet kinds from the chip row so the
  // UI stays tight. Always keep the ones we actually fire.
  const visibleKinds = kinds.filter((k) =>
    [
      "dispute_ruled",
      "appeal_ruled",
      "squad_approved",
      "squad_rejected",
      "squad_reopened",
      "punishment_issued",
      "punishment_revoked",
      "match_voided",
      "match_unvoided",
      "announcement",
    ].includes(k),
  );

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-3">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        Filter
      </span>
      <Chip href={buildHref(null, unreadOnly)} active={currentKind === null}>
        All
      </Chip>
      {visibleKinds.map((k) => (
        <Chip
          key={k}
          href={buildHref(k, unreadOnly)}
          active={currentKind === k}
        >
          {k.replace(/_/g, " ")}
        </Chip>
      ))}
      <span className="mx-1 h-4 w-px bg-[var(--ink-4)]" aria-hidden />
      <Chip
        href={buildHref(currentKind, !unreadOnly)}
        active={unreadOnly}
      >
        Unread only
      </Chip>
      <div className="ml-auto">
        <button
          type="button"
          onClick={markAll}
          disabled={marking}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="notifications-mark-all-page"
        >
          Mark all read
        </button>
      </div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-sm border px-2 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors " +
        (active
          ? "border-[var(--signal)] bg-[var(--ink-1)] text-[var(--signal)]"
          : "border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]")
      }
    >
      {children}
    </Link>
  );
}
