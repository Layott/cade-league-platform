"use client";

/* eslint-disable @next/next/no-img-element */
// next/image isn't worth pulling in here — these are signed Supabase URLs
// served at small thumbnail sizes; <img> is fine + avoids next/image config
// for a remote pattern that varies per env.

import { useState, useTransition } from "react";
import { StatusPill } from "@/components/admin/StatusPill";
import { DangerButton } from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import type { SocialRenderJob } from "@/server/social/schemas";
import {
  approveSocialJob,
  deleteSocialJob,
  copyShareLink,
} from "@/app/admin/broadcast/social/actions";

/**
 * Plan 54 Wave 2B — `<RenderJobsTable>` lists `social_render_jobs` rows
 * with thumbnail + actions (Approve / Copy Link / Delete).
 *
 * Receives jobs from the server (the parent page calls `listRecentJobs`
 * + passes the result down). All actions go through Server Actions
 * defined in `app/admin/broadcast/social/actions.ts`. After each action
 * the parent page revalidates so the list refreshes server-side.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

const STATUS_TONE_MAP: Record<
  SocialRenderJob["status"],
  | "neutral"
  | "primary"
  | "amber"
  | "flare"
  | "muted"
> = {
  pending: "amber",
  rendering: "amber",
  ready: "primary",
  failed: "flare",
  cancelled: "muted",
};

export function RenderJobsTable({
  jobs,
  currentTemplateKey,
}: {
  jobs: SocialRenderJob[];
  currentTemplateKey?: string;
}) {
  const filtered = currentTemplateKey
    ? jobs.filter((j) => j.templateKey === currentTemplateKey)
    : jobs;

  if (filtered.length === 0) {
    return (
      <div
        className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center text-sm text-[var(--chalk-3)]"
        data-testid="render-jobs-empty"
      >
        No renders yet — pick a template above to get started.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="render-jobs-table-wrapper"
    >
      <table
        className="w-full text-sm text-[var(--chalk-1)]"
        data-testid="render-jobs-table"
      >
        <thead>
          <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60">
            <Th className="w-[88px]">Thumb</Th>
            <Th>Template</Th>
            <Th>Size</Th>
            <Th>Format</Th>
            <Th>Status</Th>
            <Th>Created</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((j, idx) => (
            <Row
              key={j.id}
              job={j}
              striped={idx % 2 === 1}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={
        "px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] " +
        (align === "right"
          ? "text-right "
          : align === "center"
            ? "text-center "
            : "text-left ") +
        className
      }
    >
      {children}
    </th>
  );
}

function Row({ job, striped }: { job: SocialRenderJob; striped: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  function onApprove() {
    setError(null);
    startTransition(async () => {
      const r = await approveSocialJob(job.id);
      if (!r.ok) setError(r.error);
    });
  }

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const r = await deleteSocialJob(job.id);
      if (!r.ok) setError(r.error);
    });
  }

  function onCopyLink() {
    setError(null);
    startTransition(async () => {
      const r = await copyShareLink(job.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(r.url);
          setCopyState("copied");
          window.setTimeout(() => setCopyState("idle"), 1500);
        } else {
          setCopyState("failed");
          setError("clipboard not available — open the asset in a new tab to copy");
        }
      } catch {
        setCopyState("failed");
        setError("clipboard write blocked by browser");
      }
    });
  }

  return (
    <tr
      className={
        "border-b border-[var(--ink-4)]/70 transition-colors last:border-b-0 hover:bg-[var(--ink-3)]/80 " +
        (striped ? "bg-[var(--ink-3)]/30 " : "")
      }
      data-testid={`render-job-row-${job.id}`}
    >
      <td className="px-4 py-3 align-top">
        {job.outputUrl ? (
          <a
            href={job.outputUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block"
            data-testid={`render-job-thumb-${job.id}`}
          >
            <img
              src={job.outputUrl}
              alt={`${job.templateKey} ${job.size}`}
              className="h-12 w-12 rounded-sm border border-[var(--ink-4)] object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)] text-[10px] text-[var(--chalk-3)]">
            —
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <span className="font-mono text-xs text-[var(--chalk-0)]">
          {job.templateKey}
        </span>
      </td>
      <td className="px-4 py-3 align-top">
        <span className="font-mono text-xs">{job.size}</span>
      </td>
      <td className="px-4 py-3 align-top">
        <span className="text-xs uppercase tracking-[0.16em]">{job.format}</span>
      </td>
      <td className="px-4 py-3 align-top">
        <StatusPill tone={STATUS_TONE_MAP[job.status]}>{job.status}</StatusPill>
        {job.approvedAt ? (
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Approved {formatWat(job.approvedAt, "MMM d HH:mm")}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        <span className="font-mono text-[11px] text-[var(--chalk-2)]">
          {formatWat(job.createdAt, "MMM d HH:mm")}
        </span>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={pending || !!job.approvedAt}
              data-testid={`render-job-approve-${job.id}`}
              className="rounded-sm border border-[var(--primary)] bg-[rgba(107,205,6,0.08)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--primary)] hover:bg-[rgba(107,205,6,0.16)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {job.approvedAt ? "Approved" : "Approve"}
            </button>
            <button
              type="button"
              onClick={onCopyLink}
              disabled={pending || !job.outputUrl}
              data-testid={`render-job-copy-${job.id}`}
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copyState === "copied" ? "Copied" : "Copy Link"}
            </button>
            <DangerButton
              type="button"
              size="sm"
              onClick={onDelete}
              disabled={pending}
              data-testid={`render-job-delete-${job.id}`}
            >
              Delete
            </DangerButton>
          </div>
          {error ? (
            <div
              className="text-right text-[10px] text-[var(--flare)]"
              data-testid={`render-job-error-${job.id}`}
            >
              {error}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
