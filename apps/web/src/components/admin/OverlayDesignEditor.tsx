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
  setTextElementAction,
  clearTextElementAction,
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

/**
 * Wave 2 Stage 2 — text-element row delivered to the editor. Mirrors
 * `TextElement` from server module but kept thin (no `setBy` / audit
 * fields needed in the UI).
 */
export type TextElementRow = {
  elementId: string;
  origin: "seed" | "runtime";
  kind: string;
  visible: boolean;
  content: string;
  fontFamily: string | null;
  fontWeight: number | null;
  fontSizePx: number | null;
  letterSpacing: number | null;
  lineHeight: number | null;
  color: string | null;
  alignment: "left" | "center" | "right" | "justify" | null;
  opacityPct: number | null;
  positionXPx: number | null;
  positionYPx: number | null;
  zIndex: number | null;
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
  /**
   * Wave 2 Stage 2 — text elements registered for this overlay+variant.
   * Sourced from `listTextElements` in the page server component.
   */
  initialTextElements?: ReadonlyArray<TextElementRow>;
};

/** Wave 2 Stage 2 — preview-text-tokens shape that goes onto the iframe URL. */
type PreviewTextTokens = Record<
  string,
  {
    visible?: boolean;
    content?: string | null;
    styles?: Record<string, string | number>;
  }
>;

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

/**
 * Wave 2 Stage 2 — convert a `TextElementRow` into the `previewTextTokens`
 * shape the iframe bootstrap consumes. Returns null when the row is a
 * pure no-op (no overrides) so callers can skip embedding it.
 */
function rowToPreviewToken(
  row: TextElementRow,
): PreviewTextTokens[string] | null {
  const styles: Record<string, string | number> = {};
  if (row.fontFamily) styles.fontFamily = row.fontFamily;
  if (row.fontWeight != null) styles.fontWeight = row.fontWeight;
  if (row.fontSizePx != null) styles.fontSize = `${row.fontSizePx}px`;
  if (row.letterSpacing != null) styles.letterSpacing = `${row.letterSpacing}em`;
  if (row.lineHeight != null) styles.lineHeight = row.lineHeight;
  if (row.color) styles.color = row.color;
  if (row.alignment) styles.textAlign = row.alignment;
  if (row.opacityPct != null) styles.opacity = row.opacityPct / 100;
  if (row.positionXPx != null) styles.left = `${row.positionXPx}px`;
  if (row.positionYPx != null) styles.top = `${row.positionYPx}px`;
  if (row.zIndex != null) styles.zIndex = row.zIndex;

  const hasContent = row.content && row.content.length > 0;
  const hasStyles = Object.keys(styles).length > 0;
  const isHidden = row.visible === false;
  if (!hasContent && !hasStyles && !isHidden) return null;

  return {
    visible: row.visible,
    content: hasContent ? row.content : null,
    styles: hasStyles ? styles : undefined,
  };
}

function buildTextPreviewParam(
  rows: ReadonlyArray<TextElementRow>,
): string {
  const map: PreviewTextTokens = {};
  for (const r of rows) {
    const token = rowToPreviewToken(r);
    if (token) map[r.elementId] = token;
  }
  if (Object.keys(map).length === 0) return "";
  try {
    const json = JSON.stringify(map);
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(json)));
    }
    return "";
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
  initialTextElements,
}: EditorProps) {
  const [tokens, setTokens] = useState<Record<string, string>>(initialTokens);
  const [previewParam, setPreviewParam] = useState<string>(
    encodeForPreview(initialTokens),
  );
  const [textRows, setTextRows] = useState<TextElementRow[]>(
    [...(initialTextElements ?? [])],
  );
  const [previewTextParam, setPreviewTextParam] = useState<string>(
    buildTextPreviewParam(initialTextElements ?? []),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when overlay/variant context changes.
  useEffect(() => {
    setTokens(initialTokens);
    setPreviewParam(encodeForPreview(initialTokens));
    setTextRows([...(initialTextElements ?? [])]);
    setPreviewTextParam(buildTextPreviewParam(initialTextElements ?? []));
    setSuccess(false);
    setError(null);
  }, [overlayKey, variantId, initialTokens, initialTextElements]);

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

  /**
   * Wave 2 Stage 2 — text-row local edit. Updates state, debounces
   * iframe preview by 250 ms (matches token editor cadence so dragging
   * a slider doesn't burst-load the SSR route).
   */
  const updateTextRow = useCallback(
    (elementId: string, patch: Partial<TextElementRow>) => {
      setTextRows((prev) => {
        const next = prev.map((r) =>
          r.elementId === elementId ? { ...r, ...patch } : r,
        );
        if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
        textDebounceRef.current = setTimeout(() => {
          setPreviewTextParam(buildTextPreviewParam(next));
        }, 250);
        return next;
      });
    },
    [],
  );

  const saveTextRow = useCallback(
    (elementId: string) => {
      setError(null);
      setSuccess(false);
      const row = textRows.find((r) => r.elementId === elementId);
      if (!row) return;
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("overlayKey", overlayKey);
          fd.set("variantId", variantId);
          fd.set("elementId", row.elementId);
          fd.set("kind", row.kind);
          fd.set("visible", row.visible ? "true" : "false");
          fd.set("content", row.content ?? "");
          if (row.fontFamily) fd.set("fontFamily", row.fontFamily);
          if (row.fontWeight != null) fd.set("fontWeight", String(row.fontWeight));
          if (row.fontSizePx != null) fd.set("fontSizePx", String(row.fontSizePx));
          if (row.letterSpacing != null)
            fd.set("letterSpacing", String(row.letterSpacing));
          if (row.lineHeight != null) fd.set("lineHeight", String(row.lineHeight));
          if (row.color) fd.set("color", row.color);
          if (row.alignment) fd.set("alignment", row.alignment);
          if (row.opacityPct != null) fd.set("opacityPct", String(row.opacityPct));
          if (row.positionXPx != null)
            fd.set("positionXPx", String(row.positionXPx));
          if (row.positionYPx != null)
            fd.set("positionYPx", String(row.positionYPx));
          if (row.zIndex != null) fd.set("zIndex", String(row.zIndex));
          await setTextElementAction(fd);
          setSuccess(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "save failed");
        }
      });
    },
    [textRows, overlayKey, variantId],
  );

  const resetTextRow = useCallback(
    (elementId: string) => {
      setError(null);
      setSuccess(false);
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("overlayKey", overlayKey);
          fd.set("variantId", variantId);
          fd.set("elementId", elementId);
          await clearTextElementAction(fd);
          setTextRows((prev) =>
            prev.map((r) =>
              r.elementId === elementId
                ? {
                    ...r,
                    visible: true,
                    content: "",
                    fontFamily: null,
                    fontWeight: null,
                    fontSizePx: null,
                    letterSpacing: null,
                    lineHeight: null,
                    color: null,
                    alignment: null,
                    opacityPct: null,
                    positionXPx: null,
                    positionYPx: null,
                    zIndex: null,
                  }
                : r,
            ),
          );
          setPreviewTextParam(
            buildTextPreviewParam(
              textRows.map((r) =>
                r.elementId === elementId
                  ? {
                      ...r,
                      visible: true,
                      content: "",
                      fontFamily: null,
                      fontWeight: null,
                      fontSizePx: null,
                      letterSpacing: null,
                      lineHeight: null,
                      color: null,
                      alignment: null,
                      opacityPct: null,
                      positionXPx: null,
                      positionYPx: null,
                      zIndex: null,
                    }
                  : r,
              ),
            ),
          );
          setSuccess(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "reset failed");
        }
      });
    },
    [overlayKey, variantId, textRows],
  );

  const previewSrc = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("demo", "1");
    qs.set("active", "1");
    qs.set("preview", "1");
    if (variantId !== "default") qs.set("variant", variantId);
    if (previewParam) qs.set("previewTokens", previewParam);
    // Wave 2 Stage 2 — text-element preview overrides ride alongside.
    if (previewTextParam) qs.set("previewTextTokens", previewTextParam);
    return `/overlay/v2/${overlayKey}?${qs.toString()}`;
  }, [overlayKey, variantId, previewParam, previewTextParam]);

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
        {textRows.length > 0 ? (
          <div
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
            data-testid="overlay-design-text-panel"
          >
            <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
              Text — {textRows.length} element{textRows.length === 1 ? "" : "s"}
            </h3>
            <p className="mb-4 text-xs text-[var(--chalk-3)]">
              Override the text content + per-element typography for any
              labelled element on this overlay. Empty fields inherit the HTML
              default. Save persists; Reset clears overrides for that row.
            </p>
            <div
              className="space-y-3"
              data-testid="overlay-design-text-rows"
            >
              {textRows.map((row) => (
                <TextElementEditorRow
                  key={row.elementId}
                  row={row}
                  fontOptions={fontOptions}
                  pending={pending}
                  onUpdate={(patch) => updateTextRow(row.elementId, patch)}
                  onSave={() => saveTextRow(row.elementId)}
                  onReset={() => resetTextRow(row.elementId)}
                />
              ))}
            </div>
          </div>
        ) : null}

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

/**
 * Wave 2 Stage 2 — single text-element editor row.
 *
 * Renders a collapsed-by-default <details> per element so the panel
 * stays scannable even with 20+ rows on overlays like 11-match-scores-day.
 * Shows the element ID (read-only, monospace) + kind badge + open-state
 * preview of the current content. Expanded state shows all override
 * fields. Save / Reset live inside the panel.
 *
 * Empty-string sentinel: every text input maps "" → "(use HTML default)".
 * Numeric inputs map empty string → null in the parent's state shape.
 */
function TextElementEditorRow({
  row,
  fontOptions,
  pending,
  onUpdate,
  onSave,
  onReset,
}: {
  row: TextElementRow;
  fontOptions: ReadonlyArray<string>;
  pending: boolean;
  onUpdate: (patch: Partial<TextElementRow>) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]";
  const inputStyle =
    "w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none";
  const isImage = row.kind === "image";
  const isLayout = row.kind === "layout";

  return (
    <details
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
      data-testid={`text-row-${row.elementId}`}
    >
      <summary className="cursor-pointer list-none px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--chalk-0)]">
                {row.elementId}
              </span>
              <span className="rounded-sm border border-[var(--ink-4)] px-1.5 py-px text-[9px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                {row.kind}
              </span>
              {row.origin === "runtime" ? (
                <span className="rounded-sm border border-[var(--primary)] px-1.5 py-px text-[9px] uppercase tracking-[0.18em] text-[var(--signal)]">
                  Runtime
                </span>
              ) : null}
              {!row.visible ? (
                <span className="rounded-sm border border-[var(--flare)] px-1.5 py-px text-[9px] uppercase tracking-[0.18em] text-[var(--flare)]">
                  Hidden
                </span>
              ) : null}
            </div>
            {row.content ? (
              <span className="text-[10px] text-[var(--chalk-2)] line-clamp-1">
                {row.content}
              </span>
            ) : (
              <span className="text-[10px] italic text-[var(--chalk-3)]">
                (HTML default)
              </span>
            )}
          </div>
          <span className="text-[10px] text-[var(--chalk-3)]">▾</span>
        </div>
      </summary>
      <div className="space-y-2 border-t border-[var(--ink-4)] px-3 py-3">
        {!isImage && !isLayout ? (
          <div className="space-y-1">
            <label className={labelStyle}>Content</label>
            <input
              type="text"
              value={row.content}
              onChange={(e) => onUpdate({ content: e.target.value })}
              placeholder="(empty → use HTML default)"
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-content`}
              maxLength={1024}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelStyle}>Color</label>
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={normalizeHex(row.color ?? "")}
                onChange={(e) => onUpdate({ color: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
                data-testid={`text-row-${row.elementId}-color-picker`}
              />
              <input
                type="text"
                value={row.color ?? ""}
                onChange={(e) =>
                  onUpdate({ color: e.target.value === "" ? null : e.target.value })
                }
                placeholder="#hex / rgba()"
                className={inputStyle}
                data-testid={`text-row-${row.elementId}-color`}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Font</label>
            <select
              value={row.fontFamily ?? ""}
              onChange={(e) =>
                onUpdate({
                  fontFamily: e.target.value === "" ? null : e.target.value,
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-font-family`}
            >
              <option value="">(default)</option>
              {fontOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Size px</label>
            <input
              type="number"
              min={8}
              max={400}
              step={1}
              value={row.fontSizePx ?? ""}
              onChange={(e) =>
                onUpdate({
                  fontSizePx:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-font-size`}
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Weight</label>
            <select
              value={row.fontWeight ?? ""}
              onChange={(e) =>
                onUpdate({
                  fontWeight:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-font-weight`}
            >
              <option value="">(default)</option>
              {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Pos X</label>
            <input
              type="number"
              step={1}
              value={row.positionXPx ?? ""}
              onChange={(e) =>
                onUpdate({
                  positionXPx:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-pos-x`}
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Pos Y</label>
            <input
              type="number"
              step={1}
              value={row.positionYPx ?? ""}
              onChange={(e) =>
                onUpdate({
                  positionYPx:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-pos-y`}
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Align</label>
            <select
              value={row.alignment ?? ""}
              onChange={(e) =>
                onUpdate({
                  alignment:
                    e.target.value === ""
                      ? null
                      : (e.target.value as TextElementRow["alignment"]),
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-alignment`}
            >
              <option value="">(default)</option>
              <option value="left">left</option>
              <option value="center">center</option>
              <option value="right">right</option>
              <option value="justify">justify</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Opacity %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={row.opacityPct ?? ""}
              onChange={(e) =>
                onUpdate({
                  opacityPct:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-opacity`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <PrimaryButton
            type="button"
            size="sm"
            disabled={pending}
            onClick={onSave}
          >
            Save
          </PrimaryButton>
          <SecondaryButton
            type="button"
            size="sm"
            disabled={pending}
            onClick={onReset}
          >
            Reset
          </SecondaryButton>
          <label className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            <input
              type="checkbox"
              checked={row.visible}
              onChange={(e) => onUpdate({ visible: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]"
              data-testid={`text-row-${row.elementId}-visible`}
            />
            Visible
          </label>
        </div>
      </div>
    </details>
  );
}
