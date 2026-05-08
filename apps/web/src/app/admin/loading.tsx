/**
 * 2026-05-08 — admin segment skeleton. Matches the SectionHeader + side-nav
 * layout the real admin pages use so the swap-in feels in place.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6 px-5 py-8">
      <div className="space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-9 w-72 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-3 w-96 max-w-full animate-pulse rounded bg-[var(--ink-3)]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]" />
    </div>
  );
}
