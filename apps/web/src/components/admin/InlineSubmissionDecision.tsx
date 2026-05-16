"use client";

import { useTransition } from "react";

/**
 * Inline approve / reject controls rendered in the /admin/squads list.
 * Lets admins decision a queue without opening each submission detail
 * page. Approve = native confirm(); reject = native prompt() for reason
 * (min 3 chars enforced client-side, server re-validates).
 *
 * Server actions are bound in the parent server component and passed
 * through as props — keeps the perm check + redirect logic on the
 * server while the buttons live in the browser.
 */
export function InlineSubmissionDecision({
  submissionId,
  weekStart,
  status,
  approveAction,
  rejectAction,
}: {
  submissionId: string;
  weekStart: string;
  status: string;
  approveAction: (formData: FormData) => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  function handleApprove() {
    if (typeof window !== "undefined" && !window.confirm("Approve this squad?")) {
      return;
    }
    const fd = new FormData();
    fd.set("submissionId", submissionId);
    fd.set("weekStart", weekStart);
    fd.set("status", status);
    startTransition(() => {
      void approveAction(fd);
    });
  }

  function handleReject() {
    const reason =
      typeof window !== "undefined"
        ? window.prompt("Rejection reason (shared with the player, min 3 chars):")
        : null;
    if (!reason) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      if (typeof window !== "undefined") {
        window.alert("Reason must be at least 3 characters.");
      }
      return;
    }
    const fd = new FormData();
    fd.set("submissionId", submissionId);
    fd.set("weekStart", weekStart);
    fd.set("status", status);
    fd.set("reason", trimmed);
    startTransition(() => {
      void rejectAction(fd);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleApprove}
        disabled={pending}
        data-testid={`inline-approve-${submissionId}`}
        title="Approve squad"
        className="rounded-sm border border-[var(--primary)]/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--primary)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={handleReject}
        disabled={pending}
        data-testid={`inline-reject-${submissionId}`}
        title="Reject squad"
        className="rounded-sm border border-[var(--flare)]/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--flare)] hover:border-[var(--flare)] hover:bg-[var(--flare)]/10 disabled:opacity-50"
      >
        Reject
      </button>
    </span>
  );
}
