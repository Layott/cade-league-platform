"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  saveTokensAction,
  uploadOverlayBgAction,
} from "@/app/admin/broadcast/v2/design/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { supportsBgImage } from "@/server/overlays/design/defaults";

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
  tokenType:
    | "color"
    | "font"
    | "number"
    | "boolean"
    | "enum"
    | "string"
    | "image";
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

  // Filter the catalog — image-typed tokens only render on overlays
  // declared as full-canvas via `supportsBgImage`. Floating-UI overlays
  // (timer, lower-third, score-bug, up-next, top-scorers, orgs, coaches,
  // penalties) sit on a transparent canvas where a backdrop is meaningless,
  // so the editor hides the widget entirely rather than offering a
  // setting that has no effect.
  const filteredCatalog = useMemo(() => {
    const allowsBgImage = supportsBgImage(overlayKey);
    return catalog.filter((entry) => {
      if (entry.tokenType === "image") return allowsBgImage;
      return true;
    });
  }, [catalog, overlayKey]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
          <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Tokens
          </h3>
          <div className="space-y-4">
            {filteredCatalog.map((entry) => (
              <TokenRow
                key={entry.tokenKey}
                entry={entry}
                value={tokens[entry.tokenKey] ?? ""}
                onChange={(v) => update(entry.tokenKey, v)}
                fontOptions={fontOptions}
                patternOptions={patternOptions}
                overlayKey={overlayKey}
                variantId={variantId}
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
        {/*
         * 2026-04-29 — preview iframe must show the full 1920×1080 overlay
         * canvas scaled to fit the container width. Previously hard-coded
         * `scale(0.4)` truncated wide containers and over-shrank narrow ones;
         * now `100cqi / 1920` (CSS container-query inline-size unit) computes
         * scale dynamically so the canvas always fills the container exactly.
         * `aspectRatio: 16/9` keeps height in lockstep with the scaled width.
         */}
        <div
          className="relative w-full overflow-hidden rounded-sm border border-[var(--ink-4)] bg-black"
          style={{ aspectRatio: "16 / 9", containerType: "inline-size" }}
        >
          <iframe
            src={previewSrc}
            data-testid="overlay-design-preview-iframe"
            className="absolute left-0 top-0"
            style={{
              width: "1920px",
              height: "1080px",
              transform: "scale(calc(100cqi / 1920px))",
              transformOrigin: "top left",
              border: "none",
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
        <p className="mt-2 text-xs text-[var(--chalk-3)]">
          Iframe renders /overlay/v2/{overlayKey}?demo=1 with your pending
          tokens applied via the previewTokens param. The 1920×1080 canvas
          is scaled to fit this preview container at 16:9. Save to persist.
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
  overlayKey,
  variantId,
}: {
  entry: CatalogEntry;
  value: string;
  onChange: (v: string) => void;
  fontOptions: ReadonlyArray<string>;
  patternOptions: ReadonlyArray<string>;
  overlayKey: string;
  variantId: string;
}) {
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]";

  if (entry.tokenType === "image") {
    return (
      <ImageRow
        entry={entry}
        value={value}
        onChange={onChange}
        overlayKey={overlayKey}
        variantId={variantId}
      />
    );
  }

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

/**
 * Image-token widget — file picker + 80×45 (16:9) thumb + Upload + Clear.
 *
 * On Upload:
 *   1. POST the file to `uploadOverlayBgAction` via FormData.
 *   2. On success, server persists the token + revalidates; we update
 *      local state so the live preview iframe immediately re-renders
 *      with the new URL via the `previewTokens` query param.
 *   3. On error, surface the message inline (no toast — the design
 *      editor's error pill handles save errors generically; for upload
 *      we keep the message close to the file input).
 *
 * Clear is implemented as `onChange("")` so the parent treats it the
 * same way it treats clearing any other token (the saveTokensAction
 * server action interprets empty string as "clear override → fall back
 * to defaults"). The user must still hit Save to commit the clear.
 */
function ImageRow({
  entry,
  value,
  onChange,
  overlayKey,
  variantId,
}: {
  entry: CatalogEntry;
  value: string;
  onChange: (v: string) => void;
  overlayKey: string;
  variantId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]";

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setUploadError(null);
      const f = e.target.files?.[0];
      if (!f) return;
      // Pre-flight client-side checks so we fail fast before the network
      // round-trip. The server still validates; these are UX assists.
      const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
      if (!ALLOWED.has(f.type)) {
        setUploadError(`Unsupported type ${f.type}; use PNG/JPG/WebP`);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      const MAX = 2 * 1024 * 1024;
      if (f.size > MAX) {
        setUploadError(
          `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB; max 2 MB)`,
        );
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      setUploading(true);
      try {
        const fd = new FormData();
        fd.set("overlayKey", overlayKey);
        fd.set("variantId", variantId);
        fd.set("file", f);
        const res = await uploadOverlayBgAction(fd);
        if (!res.ok) {
          setUploadError(res.error);
        } else {
          onChange(res.url);
        }
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Upload failed",
        );
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [overlayKey, variantId, onChange],
  );

  const handleClear = useCallback(() => {
    setUploadError(null);
    onChange("");
  }, [onChange]);

  return (
    <div className="space-y-1.5">
      <label className={labelStyle}>{entry.label}</label>
      <div className="flex items-start gap-3">
        {/* Thumb — 80×45 to match 16:9 ratio of the overlay canvas. */}
        <div
          className="flex h-[45px] w-[80px] flex-none items-center justify-center overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
          data-testid={`token-${entry.tokenKey}-thumb`}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="bg preview"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="px-1 text-center text-[8px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              No image
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              disabled={uploading}
              data-testid={`token-${entry.tokenKey}-file`}
              className="block w-full text-[10px] text-[var(--chalk-2)] file:mr-2 file:rounded-sm file:border file:border-[var(--ink-4)] file:bg-[var(--ink-1)] file:px-2 file:py-1 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.18em] file:text-[var(--chalk-1)] hover:file:border-[var(--signal)] hover:file:text-[var(--signal)]"
            />
            <SecondaryButton
              size="sm"
              onClick={handleClear}
              disabled={uploading || !value}
              type="button"
            >
              Clear
            </SecondaryButton>
          </div>
          {uploading ? (
            <span className="text-xs text-[var(--chalk-3)]">Uploading…</span>
          ) : null}
          {uploadError ? (
            <span
              className="text-xs text-[var(--flare)]"
              data-testid={`token-${entry.tokenKey}-error`}
            >
              {uploadError}
            </span>
          ) : null}
          {value && !uploadError ? (
            <span
              className="break-all font-mono text-[10px] text-[var(--chalk-3)]"
              data-testid={`token-${entry.tokenKey}-url`}
            >
              {value}
            </span>
          ) : null}
          {entry.description ? (
            <span className="block text-xs text-[var(--chalk-3)]">
              {entry.description}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
