export default function PunishmentsLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--ink-3)]" />
        <div className="h-9 w-64 animate-pulse rounded bg-[var(--ink-3)]" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
            style={{ animationDelay: `${i * 50}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
