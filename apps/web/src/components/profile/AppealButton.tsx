"use client";

import Link from "next/link";

/**
 * Plan 41 — appeal CTA for a single sanction row. Intentionally minimal:
 * opens the existing Plan 13B appeal-submit page via `?caseId=...`, so
 * there is no duplicated form state here. When `alreadyAppealed` is true
 * the button is replaced with a disabled status chip so the row keeps
 * showing the previous action.
 *
 * Marked `"use client"` so a future iteration can swap the Link for a
 * modal launcher without rewriting the server-side callers.
 */
export function AppealButton({
  disciplinaryCaseId,
  alreadyAppealed,
}: {
  disciplinaryCaseId: string;
  alreadyAppealed: boolean;
}) {
  if (alreadyAppealed) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ink-5)] bg-[var(--ink-3)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
        data-testid="appeal-submitted-pill"
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--chalk-3)]" />
        Appeal submitted
      </span>
    );
  }
  const href = `/player/appeals/new?caseId=${encodeURIComponent(disciplinaryCaseId)}`;
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--primary-ink)] shadow-[0_0_0_1px_rgba(107,205,6,0.25),0_10px_30px_-12px_rgba(107,205,6,0.5)] transition-colors hover:bg-[#82e21a]"
      data-testid="appeal-button"
      data-case-id={disciplinaryCaseId}
    >
      Appeal →
    </Link>
  );
}
