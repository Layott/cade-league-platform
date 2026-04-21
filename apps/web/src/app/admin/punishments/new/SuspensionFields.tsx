"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FormField, inputClass } from "@/components/admin/FormField";

type PreviewMatch = {
  matchId: string;
  matchDayId: string;
  matchDate: string;
  opponentId: string;
  opponentTag: string;
  opponentDisplayName: string;
  venueName: string;
};

/**
 * SuspensionFields: client-only helper that reveals the effective_until
 * field + live void-preview panel when sanctionType='ban' is selected.
 *
 * It listens to the surrounding form via DOM selectors; no lifting state
 * up was needed because the enclosing <form> is a plain Server Component
 * that posts to a server action.
 */
export function SuspensionFields() {
  const [isBan, setIsBan] = useState(false);
  const [preview, setPreview] = useState<PreviewMatch[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const untilRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Wire up onChange on the sanctionType select once mounted.
  useEffect(() => {
    const form = document.querySelector("form") as HTMLFormElement | null;
    if (!form) return;
    const select = form.querySelector<HTMLSelectElement>('select[name="sanctionType"]');
    if (!select) return;
    const handler = () => setIsBan(select.value === "ban");
    handler();
    select.addEventListener("change", handler);
    return () => select.removeEventListener("change", handler);
  }, []);

  const runPreview = useCallback(async () => {
    const form = document.querySelector("form") as HTMLFormElement | null;
    if (!form) return;
    const playerId = (form.elements.namedItem("playerId") as HTMLSelectElement | null)?.value;
    const from = (form.elements.namedItem("effectiveFrom") as HTMLInputElement | null)?.value;
    const until = (form.elements.namedItem("effectiveUntil") as HTMLInputElement | null)?.value;
    if (!playerId || !from || !until) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/admin/punishments/preview-voids", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId,
          effectiveFrom: from,
          effectiveUntil: until,
        }),
      });
      if (!res.ok) {
        setPreviewError(`preview failed: ${res.status}`);
        setPreview(null);
      } else {
        const json = (await res.json()) as { matches: PreviewMatch[] };
        setPreview(json.matches ?? []);
      }
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isBan) return;
    const form = document.querySelector("form") as HTMLFormElement | null;
    if (!form) return;
    const fields: Array<HTMLInputElement | HTMLSelectElement> = [
      form.elements.namedItem("playerId") as HTMLSelectElement,
      form.elements.namedItem("effectiveFrom") as HTMLInputElement,
      form.elements.namedItem("effectiveUntil") as HTMLInputElement,
    ].filter(Boolean) as Array<HTMLInputElement | HTMLSelectElement>;

    const onChange = () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void runPreview();
      }, 300);
    };
    fields.forEach((f) => {
      f.addEventListener("change", onChange);
      f.addEventListener("blur", onChange);
    });
    void runPreview();
    return () => {
      fields.forEach((f) => {
        f.removeEventListener("change", onChange);
        f.removeEventListener("blur", onChange);
      });
    };
  }, [isBan, runPreview]);

  if (!isBan) return null;

  return (
    <div className="space-y-4 rounded-sm border border-[rgba(220,38,38,0.25)] bg-[rgba(220,38,38,0.05)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#ff9090]">
        Suspension window
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Effective until">
          <input
            ref={untilRef}
            name="effectiveUntil"
            type="date"
            required
            className={inputClass + " tabular"}
            data-testid="pn-until"
          />
        </FormField>
      </div>

      <div
        data-testid="void-preview"
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3"
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Void preview
        </div>
        {previewError ? (
          <p className="mt-2 text-xs text-[var(--flare)]">{previewError}</p>
        ) : loading ? (
          <p className="mt-2 text-xs text-[var(--chalk-3)]">Checking…</p>
        ) : !preview ? (
          <p className="mt-2 text-xs text-[var(--chalk-3)]">
            Fill player + both dates to preview.
          </p>
        ) : preview.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--chalk-2)]">
            No scheduled fixtures fall in this window.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-[var(--chalk-1)]">
              This will void{" "}
              <span className="font-mono text-[var(--flare)]">{preview.length}</span>{" "}
              scheduled{" "}
              {preview.length === 1 ? "match" : "matches"}:
            </p>
            <ul className="mt-2 space-y-1 font-mono text-[11px] tabular text-[var(--chalk-2)]">
              {preview.map((m) => (
                <li key={m.matchId}>
                  {m.matchDate} · vs {m.opponentTag} ({m.opponentDisplayName}) · {m.venueName}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
