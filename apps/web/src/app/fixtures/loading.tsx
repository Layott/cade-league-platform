export default function FixturesLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8">
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-9 w-64 animate-pulse rounded bg-[var(--ink-3)]" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          >
            <div
              className="h-4 w-40 animate-pulse rounded bg-[var(--ink-3)]"
              style={{ animationDelay: `${i * 60}ms` }}
            />
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {Array.from({ length: 4 }).map((__, j) => (
                <div
                  key={j}
                  className="h-12 animate-pulse rounded bg-[var(--ink-3)]"
                  style={{ animationDelay: `${i * 60 + j * 30}ms` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
