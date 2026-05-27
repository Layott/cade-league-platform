"use client";

import { useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";

/**
 * Plan 51 — XLSX + DOCX download triggers for the Standings tab.
 *
 * Uses native browser fetch + Blob -> Object URL -> anchor click so the
 * download stays client-side and shows a spinner while the export is being
 * generated server-side (a 13-row XLSX builds in ~30ms but the round-trip
 * to Supabase + xlsx serialization warrants a feedback nub).
 */

type DownloadType =
  | "leaderboard-xlsx"
  | "leaderboard-docx"
  | "metrics-xlsx"
  | "bundle-xlsx"
  | "bundle-json";

const VARIANTS: Record<
  DownloadType,
  {
    type: "leaderboard" | "metrics" | "bundle";
    format: "xlsx" | "docx" | "json";
    label: string;
    ext: string;
  }
> = {
  "leaderboard-xlsx": {
    type: "leaderboard",
    format: "xlsx",
    label: "Leaderboard XLSX",
    ext: "xlsx",
  },
  "leaderboard-docx": {
    type: "leaderboard",
    format: "docx",
    label: "Leaderboard DOCX",
    ext: "docx",
  },
  "metrics-xlsx": {
    type: "metrics",
    format: "xlsx",
    label: "Metrics workbook",
    ext: "xlsx",
  },
  "bundle-xlsx": {
    type: "bundle",
    format: "xlsx",
    label: "Full bundle XLSX",
    ext: "xlsx",
  },
  "bundle-json": {
    type: "bundle",
    format: "json",
    label: "Full bundle JSON",
    ext: "json",
  },
};

export function DownloadButtons({
  variants = [
    "leaderboard-xlsx",
    "leaderboard-docx",
    "metrics-xlsx",
    "bundle-xlsx",
    "bundle-json",
  ],
}: {
  variants?: DownloadType[];
}) {
  const [busy, setBusy] = useState<DownloadType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(v: DownloadType) {
    setBusy(v);
    setError(null);
    try {
      const meta = VARIANTS[v];
      const url = `/api/tournament/export?type=${meta.type}&format=${meta.format}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ""}`);
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `cade-${meta.type}-${stamp}.${meta.ext}`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2" data-testid="tournament-download-buttons">
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => (
          <SecondaryButton
            key={v}
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={() => void download(v)}
            data-testid={`download-${v}`}
          >
            {busy === v ? "Generating..." : `Download ${VARIANTS[v].label}`}
          </SecondaryButton>
        ))}
      </div>
      {error ? (
        <div
          role="alert"
          className="text-[11px] text-[var(--flare)]"
          data-testid="download-error"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
