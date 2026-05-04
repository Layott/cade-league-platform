"use client";

import { useState, useTransition } from "react";
import { PrimaryButton } from "@/components/admin/buttons";
import type { SocialSize } from "@/lib/social-sizes";
import type { TemplateKey } from "@/server/social/templates";
import { triggerStaticRender } from "@/app/admin/broadcast/social/actions";

/**
 * Plan 54 Wave 2B — `<DownloadButton>` triggers a static render via the
 * server action then either redirects the browser to the resulting
 * signed URL OR surfaces the URL inline with a copy button.
 *
 * On success: the page automatically opens the URL in a new tab so the
 * admin can download the asset locally. The URL also stays visible in
 * the result panel so they can copy + paste it elsewhere.
 *
 * On error: the error message renders inline with a retry affordance.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

type Result =
  | { kind: "idle" }
  | { kind: "success"; url: string; id: string }
  | { kind: "error"; message: string };

export function DownloadButton({
  templateKey,
  size,
  sessionId,
}: {
  templateKey: TemplateKey;
  size: SocialSize;
  sessionId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const disabled = pending || !sessionId;

  function onClick() {
    if (!sessionId) return;
    setResult({ kind: "idle" });
    startTransition(async () => {
      const r = await triggerStaticRender({
        templateKey,
        size,
        sessionId,
      });
      if (r.ok) {
        setResult({ kind: "success", url: r.url, id: r.id });
        // Open the asset in a new tab so the user can right-click → save.
        // window may be undefined in SSR — useTransition runs client-side
        // so it's safe here, but guard for future safety.
        if (typeof window !== "undefined") {
          window.open(r.url, "_blank", "noopener,noreferrer");
        }
      } else {
        setResult({ kind: "error", message: r.error });
      }
    });
  }

  async function copyUrl(url: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // No-op — user can still copy from the readonly input below.
      }
    }
  }

  return (
    <div className="space-y-2" data-testid="download-button-wrapper">
      <PrimaryButton
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-testid="download-button"
      >
        {pending ? "Rendering…" : "Download PNG"}
      </PrimaryButton>

      {!sessionId ? (
        <p
          className="text-[11px] text-[var(--chalk-3)]"
          data-testid="download-no-session"
        >
          Start a broadcast session before rendering.
        </p>
      ) : null}

      {result.kind === "success" ? (
        <div
          className="flex flex-col gap-2 rounded-sm border border-[var(--primary)] bg-[rgba(107,205,6,0.06)] p-3"
          data-testid="download-success"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
            Render ready
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={result.url}
              data-testid="download-url"
              className="flex-1 truncate rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 font-mono text-[11px] text-[var(--chalk-1)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => copyUrl(result.url)}
              className="shrink-0 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
              data-testid="download-copy"
            >
              Copy
            </button>
          </div>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:underline"
          >
            Open in new tab →
          </a>
        </div>
      ) : null}

      {result.kind === "error" ? (
        <div
          className="rounded-sm border border-[rgba(255,91,59,0.4)] bg-[rgba(255,91,59,0.08)] p-3 text-[11px] text-[var(--flare)]"
          data-testid="download-error"
        >
          {result.message}
        </div>
      ) : null}
    </div>
  );
}
