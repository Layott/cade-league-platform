export default function PlayersLoading() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <div className="h-10 w-48 bg-slate-200 rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl border bg-white p-4 animate-pulse" />
        ))}
      </div>
    </main>
  );
}
