/**
 * 2026-05-08 — root suspense fallback. Renders for any route segment that
 * does not provide its own `loading.tsx`. Pairs with RouteProgress for
 * end-to-end nav feedback.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-16">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="block h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]"
          style={{ boxShadow: "0 0 12px rgba(107,205,6,0.7)" }}
        />
        <span
          aria-hidden
          className="block h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]"
          style={{
            animationDelay: "120ms",
            boxShadow: "0 0 12px rgba(107,205,6,0.7)",
          }}
        />
        <span
          aria-hidden
          className="block h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]"
          style={{
            animationDelay: "240ms",
            boxShadow: "0 0 12px rgba(107,205,6,0.7)",
          }}
        />
        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Loading…
        </span>
      </div>
    </div>
  );
}
