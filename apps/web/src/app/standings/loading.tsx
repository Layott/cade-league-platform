export default function StandingsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8">
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-9 w-64 animate-pulse rounded bg-[var(--ink-3)]" />
      </div>
      <div className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
        <div className="h-10 border-b border-[var(--ink-4)] bg-[var(--ink-3)]" />
        {Array.from({ length: 13 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse border-b border-[var(--ink-4)] last:border-0 bg-[var(--ink-2)]"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
