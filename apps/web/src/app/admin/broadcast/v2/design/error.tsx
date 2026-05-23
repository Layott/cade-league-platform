"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-scoped error boundary for /admin/broadcast/v2/design.
 *
 * Replaces the default "An error occurred in the Server Components
 * render. The specific message is omitted in production builds..."
 * banner with an actionable shell: digest visible for support, retry
 * button, link back to admin home. Also logs the digest to the
 * browser console so an admin can paste it into a bug report.
 */
export default function DesignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/admin/broadcast/v2/design] route error:", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8 text-[var(--chalk-1)]">
      <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-6">
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          Design page hit an error
        </h1>
        <p className="mb-4 text-sm text-[var(--chalk-3)]">
          A server component on this route threw before render finished.
          Retry usually works — the most common cause is a transient DB
          read race. If it keeps happening, copy the digest below into a
          bug report.
        </p>
        <div className="mb-5 space-y-1 rounded-sm bg-black/40 p-3 font-mono text-xs">
          <div>
            <span className="text-[var(--chalk-3)]">digest:</span>{" "}
            {error.digest ?? "(none)"}
          </div>
          {error.message ? (
            <div>
              <span className="text-[var(--chalk-3)]">message:</span>{" "}
              {error.message}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-black"
          >
            Retry
          </button>
          <Link
            href="/admin/broadcast/v2/design"
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)]"
          >
            Reload page
          </Link>
          <Link
            href="/admin"
            className="rounded-sm border border-[var(--ink-4)] bg-transparent px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]"
          >
            ← Admin home
          </Link>
        </div>
      </div>
    </main>
  );
}
