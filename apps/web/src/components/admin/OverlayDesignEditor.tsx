"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { saveTokensAction } from "@/app/admin/broadcast/v2/design/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

/**
 * Phase 3 — overlay design editor.
 *
 * Client component holding the in-flight token state for the selected
 * overlay+variant. Renders a widget per catalog entry (color picker,
 * font select, slider, toggle, enum). Debounces the preview iframe
 * `src` update by 250ms so dragging a slider doesn't burst-load the SSR
 * route. Save calls the server action with a JSON-stringified `tokens`
 * payload; Discard resets local state to the last-saved DB values.
 *
 * The component is intentionally lean — token rows generate from the
 * catalog config + overlay-specific defaults, so adding a new token
 * means one entry in `defaults.ts` (no edits here).
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §5.1
 */

export type CatalogEntry = {
  tokenKey: string;
  tokenType: "color" | "font" | "number" | "boolean" | "enum" | "string";
  label: string;
  description?: string;
};

export type EditorProps = {
  overlayKey: string;
  variantId: string;
  /** Effective starting values (DB merged over defaults). */
  initialTokens: Record<string, string>;
  /** Catalog rendered as form rows. */
  catalog: ReadonlyArray<CatalogEntry>;
  /** Allowed values per enum/font token. */
  fontOptions: ReadonlyArray<string>;
  patternOptions: ReadonlyArray<string>;
};

function encodeForPreview(tokens: Record<string, string>): string {
  try {
    const json = JSON.stringify(tokens);
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(json)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    }
    return encodeURIComponent(json);
  } catch {
    return "";
  }
}

export default function OverlayDesignEditor({
  overlayKey,
  variantId,
  initialTokens,
  catalog,
  fontOptions,
  patternOptions,
}: EditorProps) {
  const [tokens, setTokens] = useState<Record<string, string>>(initialTokens);
  const [previewParam, setPreviewParam] = useState<string>(
    encodeForPreview(initialTokens),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when overlay/variant context changes.
  useEffect(() => {
    setTokens(initialTokens);
    setPreviewParam(encodeForPreview(initialTokens));
    setSuccess(false);
    setError(null);
  }, [overlayKey, variantId, initialTokens]);

  const update = useCallback(
    (key: string, value: string) => {
      setTokens((prev) => {
        const next = { ...prev, [key]: value };
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          setPreviewParam(encodeForPreview(next));
        }, 250);
        return next;
      });
    },
    [],
  );

  const onSave = useCallback(() => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("overlayKey", overlayKey);
        fd.set("variantId", variantId);
        fd.set("tokens", JSON.stringify(tokens));
        await saveTokensAction(fd);
        setSuccess(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
      }
    });
  }, [overlayKey, variantId, tokens]);

  const onDiscard = useCallback(() => {
    setTokens(initialTokens);
    setPreviewParam(encodeForPreview(initialTokens));
    setSuccess(false);
    setError(null);
  }, [initialTokens]);

  const previewSrc = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("demo", "1");
    qs.set("active", "1");
    qs.set("preview", "1");
    if (variantId !== "default") qs.set("variant", variantId);
    if (previewParam) qs.set("previewTokens", previewParam);
    return `/overlay/v2/${overlayKey}?${qs.toString()}`;
  }, [overlayKey, variantId, previewParam]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Tokens
          </h3>
          <div className="space-y-4">
            {catalog.map((entry) => (
              <TokenRow
                key={entry.tokenKey}
                entry={entry}
                value={tokens[entry.tokenKey] ?? ""}
                onChange={(v) => update(entry.tokenKey, v)}
                fontOptions={fontOptions}
                patternOptions={patternOptions}
              />
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2">
            <PrimaryButton onClick={onSave} disabled={pending} size="sm">
              {pending ? "Saving…" : "Save"}
            </PrimaryButton>
            <SecondaryButton onClick={onDiscard} disabled={pending} size="sm">
              Discard
            </SecondaryButton>
            {success ? (
              <span className="text-xs text-[var(--signal)]">Saved</span>
            ) : null}
            {error ? (
              <span className="text-xs text-[var(--flare)]">{error}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Live preview
          </h3>
          <span className="text-[10px] text-[var(--chalk-3)]">
            {overlayKey} · {variantId}
          </span>
        </div>
        <div
          className="relative w-full overflow-hidden rounded-sm border border-[var(--ink-4)] bg-black"
          style={{ aspectRatio: "16 / 9" }}
        >
          <iframe
            src={previewSrc}
            data-testid="overlay-design-preview-iframe"
            className="absolute left-0 top-0"
            style={{
              width: "1920px",
              height: "1080px",
              transform: "scale(0.4)",
              transformOrigin: "top left",
              border: "none",
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
        <p className="mt-2 text-xs text-[var(--chalk-3)]">
          Iframe renders /overlay/v2/{overlayKey}?demo=1 with your pending
          tokens applied via the previewTokens param. Save to persist.
        </p>
      </div>
    </div>
  );
}

function TokenRow({
  entry,
  value,
  onChange,
  fontOptions,
  patternOptions,
}: {
  entry: CatalogEntry;
  value: string;
  onChange: (v: string) => void;
  fontOptions: ReadonlyArray<string>;
  patternOptions: ReadonlyArray<string>;
}) {
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]";

  if (entry.tokenType === "color") {
    return (
      <div className="space-y-1.5">
        <label className={labelStyle}>{entry.label}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={normalizeHex(value)}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
            data-testid={`token-${entry.tokenKey}-color`}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={`token-${entry.tokenKey}-text`}
            spellCheck={false}
          />
        </div>
        {entry.description ? (
          <span className="block text-xs text-[var(--chalk-3)]">
            {entry.description}
          </span>
        ) : null}
      </div>
    );
  }

  if (entry.tokenType === "font") {
    return (
      <div className="space-y-1.5">
        <label className={labelStyle}>{entry.label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
          data-testid={`token-${entry.tokenKey}-select`}
        >
          {fontOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (entry.tokenType === "enum" && entry.tokenKey === "pattern") {
    return (
      <div className="space-y-1.5">
        <label className={labelStyle}>{entry.label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
          data-testid={`token-${entry.tokenKey}-select`}
        >
          {patternOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (entry.tokenType === "number") {
    const num = Number(value);
    const isScale = entry.tokenKey === "scale";
    const min = isScale ? 0.5 : 0;
    const max = isScale ? 2.0 : 1920;
    const step = isScale ? 0.05 : 1;
    return (
      <div className="space-y-1.5">
        <label className={labelStyle}>{entry.label}</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(num) ? num : min}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1"
            data-testid={`token-${entry.tokenKey}-range`}
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-20 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={`token-${entry.tokenKey}-number`}
          />
        </div>
        {entry.description ? (
          <span className="block text-xs text-[var(--chalk-3)]">
            {entry.description}
          </span>
        ) : null}
      </div>
    );
  }

  if (entry.tokenType === "boolean") {
    const checked = value === "true";
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <label className={labelStyle}>{entry.label}</label>
          {entry.description ? (
            <span className="block text-xs text-[var(--chalk-3)]">
              {entry.description}
            </span>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
          data-testid={`token-${entry.tokenKey}-toggle`}
        />
      </div>
    );
  }

  // Fallback — string.
  return (
    <div className="space-y-1.5">
      <label className={labelStyle}>{entry.label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
        data-testid={`token-${entry.tokenKey}-text`}
      />
    </div>
  );
}

/**
 * Native <input type="color"> requires a 7-char #RRGGBB string. If the
 * value isn't yet in that shape (loading or bad upstream), fall back to
 * black so the picker doesn't throw.
 */
function normalizeHex(v: string): string {
  if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return "#000000";
}
