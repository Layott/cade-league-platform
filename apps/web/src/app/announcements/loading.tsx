export default function AnnouncementsLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-8">
      <div className="space-y-3">
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-9 w-56 animate-pulse rounded bg-[var(--ink-3)]" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          >
            <div
              className="h-4 w-3/4 animate-pulse rounded bg-[var(--ink-3)]"
              style={{ animationDelay: `${i * 70}ms` }}
            />
            <div className="h-3 w-full animate-pulse rounded bg-[var(--ink-3)]" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--ink-3)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
