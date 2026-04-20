export default function PlayersLoading() {
  return (
    <div>
      <div className="border-b border-[var(--ink-4)] py-10 md:py-14">
        <div className="mx-auto max-w-6xl px-5">
          <div className="h-3 w-40 rounded bg-[var(--ink-3)]" />
          <div className="mt-4 h-12 w-64 rounded bg-[var(--ink-3)]" />
          <div className="mt-3 h-3 w-96 rounded bg-[var(--ink-3)]" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
