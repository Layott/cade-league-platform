export default function PlayerLoading() {
  return (
    <div className="space-y-6 px-5 py-8">
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-8 w-56 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-3 w-80 max-w-full animate-pulse rounded bg-[var(--ink-3)]" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
            style={{ animationDelay: `${i * 70}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
