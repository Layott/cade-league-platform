"use client";

import { useState, useTransition } from "react";

/**
 * Plan 41 P41-G — client island that wraps the admin reopen action.
 *
 * Renders a secondary-styled CTA. Clicking opens a hand-rolled modal
 * explaining the side-effects (status flip + player notification +
 * resubmission regained) so the ref has a clear "nuclear button" warning.
 * On confirm, invokes the server action prop. ESC / backdrop / Cancel all
 * dismiss. Confirm button shows `Reopening…` while the transition runs.
 *
 * Kept hand-rolled (no Radix) to avoid a new dependency; focus-trap is
 * intentionally minimal — the modal is short-lived and admin-only so we
 * skip full a11y plumbing until a11y work lands platform-wide.
 */

type ReopenAction = (submissionId: string) => Promise<void>;

export function ReopenSubmissionButton({
  submissionId,
  priorStatus,
  reopenAction,
}: {
  submissionId: string;
  priorStatus: "approved" | "rejected" | "auto_warned";
  reopenAction: ReopenAction;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await reopenAction(submissionId);
        // redirect() in the action throws a NEXT_REDIRECT signal — success
        // closes the modal via the forthcoming page re-render. Ignore errors
        // that are the redirect throw.
        setOpen(false);
      } catch (e) {
        if (e instanceof Error) {
          // Next.js redirect throws a specific error — let it bubble so
          // the navigation completes.
          if (e.message.toLowerCase().includes("next_redirect")) {
            return;
          }
          setError(e.message);
        } else {
          setError("Reopen failed");
        }
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="squad-reopen-btn"
        className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
      >
        Reopen submission
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopen-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) setOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 shadow-2xl"
            data-testid="squad-reopen-modal"
          >
            <h3
              id="reopen-modal-title"
              className="mb-3 font-display text-lg font-semibold text-[var(--chalk-0)]"
            >
              Reopen this submission?
            </h3>
            <p className="mb-2 text-xs text-[var(--chalk-2)]">
              <span className="font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)]">
                Prior status:
              </span>{" "}
              <span data-testid="squad-reopen-prior-status">{priorStatus}</span>
              .
            </p>
            <p className="mb-4 text-xs text-[var(--chalk-2)]">
              The player will receive a notification and regain access to the
              submission form. Continue?
            </p>
            {error ? (
              <p
                className="mb-3 rounded-sm border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
                data-testid="squad-reopen-error"
              >
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="squad-reopen-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--primary-ink)] shadow-[0_0_0_1px_rgba(107,205,6,0.25),0_10px_30px_-12px_rgba(107,205,6,0.5)] transition-colors hover:bg-[#82e21a] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="squad-reopen-confirm-btn"
              >
                {pending ? "Reopening…" : "Confirm reopen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
