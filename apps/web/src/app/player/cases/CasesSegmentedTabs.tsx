import Link from "next/link";

/**
 * UI Audit Slice 2 (2026-04-28) — segmented control for the merged
 * `/player/cases` page. Renders two pill links (Disputes · Appeals)
 * driven by the `?tab` query string. Server-component-friendly: both
 * tabs are normal anchor links so the parent page re-renders with
 * fresh data on switch (no client-side state).
 */

export type CasesTab = "disputes" | "appeals";

export function CasesSegmentedTabs({
  active,
  disputesCount,
  appealsCount,
}: {
  active: CasesTab;
  disputesCount: number;
  appealsCount: number;
}) {
  return (
    <div
      role="tablist"
      aria-label="Case type"
      className="inline-flex items-center gap-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-1"
      data-testid="cases-segmented-tabs"
    >
      <SegmentLink
        href="/player/cases?tab=disputes"
        label="Disputes"
        count={disputesCount}
        active={active === "disputes"}
        testId="cases-segment-disputes"
      />
      <SegmentLink
        href="/player/cases?tab=appeals"
        label="Appeals"
        count={appealsCount}
        active={active === "appeals"}
        testId="cases-segment-appeals"
      />
    </div>
  );
}

function SegmentLink({
  href,
  label,
  count,
  active,
  testId,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  testId: string;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={
        "inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
        (active
          ? "bg-[var(--signal)] text-[var(--ink-0)]"
          : "text-[var(--chalk-2)] hover:bg-[var(--ink-3)] hover:text-[var(--chalk-0)]")
      }
    >
      <span>{label}</span>
      <span
        className={
          "tabular text-[10px] font-mono " +
          (active ? "text-[var(--ink-0)]/70" : "text-[var(--chalk-3)]")
        }
        data-testid={`${testId}-count`}
      >
        {count}
      </span>
    </Link>
  );
}
