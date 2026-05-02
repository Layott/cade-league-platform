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
  setStripLayoutAction,
  uploadPartnerLogoAction,
  removePartnerLogoAction,
  setLogoOverrideAction,
  setAnimationAction,
  clearAnimationAction,
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
  /**
   * Human-readable name shown in the row header (e.g. "BRB Title",
   * "Player A Photo"). NULL falls back to a prettified `elementId` so
   * even unbackfilled rows render a usable label.
   */
  displayLabel?: string | null;
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

/**
 * Wave 2 Stage 3 — partner-strip layout row.
 */
export type PartnerStripLayoutRow = {
  visible: boolean;
  positionXPx: number;
  positionYPx: number;
  anchor:
    | "top-left"
    | "top-center"
    | "top-right"
    | "middle-left"
    | "middle-center"
    | "middle-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  orientation: "horizontal" | "vertical";
  scalePct: number;
  itemSpacingPx: number;
  justification: "start" | "center" | "end" | "space-between";
  zIndex: number;
};

/**
 * Wave 2 Stage 3 — global partner-logo roster row.
 */
export type PartnerLogoRow = {
  partnerKey: string;
  label: string;
  alt: string;
  /**
   * Human-readable name shown in the partners-roster row header. Distinct
   * from `alt` (accessibility text rendered into the static HTML) so
   * admins can rename without altering on-air alt-text. Falls back to
   * `label` then `alt` when NULL.
   */
  displayLabel?: string | null;
  fileUrl: string;
  sortOrder: number;
  dimensionWPx: number;
  dimensionHPx: number;
};

/**
 * Wave 2 Stage 3 — per-overlay logo override row.
 */
export type PartnerLogoOverrideRow = {
  partnerKey: string;
  visible: boolean;
  sortOverride: number | null;
};

/**
 * Wave 2 Stage 4 — animation phase + type enums. Mirror the values in
 * `apps/web/src/server/overlays/animations/elements.ts` (AnimPhase,
 * AnimType) so wire shapes stay in lockstep.
 */
export type AnimPhase = "entry" | "exit" | "continuous";
export type AnimType =
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "fade"
  | "scale"
  | "rotate"
  | "bounce"
  | "pulse"
  | "glow"
  | "shake"
  | "flip"
  | "custom-css"
  | "none";

/**
 * Per-element animation row delivered to the editor. One row per
 * (element_id, anim_phase). Map-based parent state keys these by
 * `${elementId}::${phase}` so no two rows ever collide.
 */
export type AnimationRow = {
  elementId: string;
  animPhase: AnimPhase;
  enabled: boolean;
  animType: AnimType;
  durationMs: number;
  delayMs: number;
  easing: string;
  iterationCount: string;
  customCssKeyframes: string | null;
};

const ANIM_TYPES: ReadonlyArray<AnimType> = [
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "fade",
  "scale",
  "rotate",
  "bounce",
  "pulse",
  "glow",
  "shake",
  "flip",
  "custom-css",
  "none",
];

const EASING_PRESETS = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "cubic-bezier(0.16,1,0.3,1)",
  "cubic-bezier(0.34,1.56,0.64,1)",
];

const ANIM_PHASES: ReadonlyArray<AnimPhase> = ["entry", "exit", "continuous"];

/* ------------------------------------------------------------------ *
 * 2026-04-28 UX overhaul — accordion section types + helpers         *
 * ------------------------------------------------------------------ */

export type SectionId = "text" | "partners" | "animations" | "tokens";

type SectionDef = {
  id: SectionId;
  title: string;
  count: number;
  hint: string;
};

/**
 * Local-storage backed accordion state. One section open at a time;
 * choice persists per overlay so admins resume where they left off.
 *
 * Falls back to `initial` if localStorage is unavailable (SSR /
 * private browsing). On first client render after hydration, reads
 * the stored value and updates state in a single effect so server +
 * client trees match.
 */
function useAccordion(
  storageKey: string,
  initial: SectionId,
): {
  openSection: SectionId;
  setOpenSection: (next: SectionId) => void;
} {
  const [openSection, setOpenSectionState] = useState<SectionId>(initial);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (
        stored === "text" ||
        stored === "partners" ||
        stored === "animations" ||
        stored === "tokens"
      ) {
        setOpenSectionState(stored);
      }
    } catch {
      // localStorage unavailable — keep `initial`.
    }
  }, [storageKey]);

  const setOpenSection = useCallback(
    (next: SectionId) => {
      setOpenSectionState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // ignore — best-effort persistence.
      }
    },
    [storageKey],
  );

  return { openSection, setOpenSection };
}

/**
 * Accordion shell — renders a horizontal tab strip + the children
 * (each child should be a `<SectionPane>` matching one of the
 * declared section ids). Only the pane whose `id` matches
 * `openSection` is visible; the rest stay mounted but hidden so their
 * local state (filters, accordion open-states inside) survives.
 */
function SectionAccordion({
  sections,
  openSection,
  onToggle,
  children,
}: {
  sections: ReadonlyArray<SectionDef>;
  openSection: SectionId;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="space-y-3"
      data-testid="overlay-design-accordion"
      role="tablist"
      aria-label="Overlay design sections"
    >
      <div
        className="grid grid-cols-2 gap-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-1 sm:grid-cols-4"
        data-testid="overlay-design-section-tabs"
      >
        {sections.map((s) => {
          const active = s.id === openSection;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`overlay-design-pane-${s.id}`}
              onClick={() => onToggle(s.id)}
              data-testid={`overlay-design-section-toggle-${s.id}`}
              className={`flex flex-col items-start rounded-sm border px-2.5 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--signal)]"
                  : "border-transparent bg-transparent text-[var(--chalk-3)] hover:border-[var(--ink-4)] hover:text-[var(--chalk-1)]"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em]">
                {s.title}
                <span
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-1 py-px font-mono text-[9px] text-[var(--chalk-2)]"
                  data-testid={`overlay-design-section-count-${s.id}`}
                >
                  {s.count}
                </span>
              </span>
              <span className="mt-0.5 line-clamp-1 text-[10px] text-[var(--chalk-3)]">
                {s.hint}
              </span>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/**
 * Accordion content pane. Hides itself unless its `id` matches the
 * accordion's `openSection`. Stays mounted so per-pane local state
 * (filters, expanded rows, draft inputs) survives across switches.
 */
function SectionPane({
  id,
  openSection,
  testid,
  children,
}: {
  id: SectionId;
  openSection: SectionId;
  testid: string;
  children: React.ReactNode;
}) {
  const isOpen = openSection === id;
  return (
    <div
      id={`overlay-design-pane-${id}`}
      role="tabpanel"
      data-testid={testid}
      data-pane-state={isOpen ? "open" : "closed"}
      hidden={!isOpen}
      className={isOpen ? "block" : "hidden"}
    >
      {children}
    </div>
  );
}

/**
 * Reusable filter input rendered above row-heavy sections (Text,
 * Animations). Strictly client-side: typing narrows the visible list
 * via the parent's filter state. Empty value = show everything.
 */
function SectionFilter({
  value,
  onChange,
  placeholder,
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testid: string;
}) {
  return (
    <div className="relative" data-testid={`${testid}-wrapper`}>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testid}
        className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 pr-8 text-xs text-[var(--chalk-0)] placeholder:text-[var(--chalk-3)] focus:border-[var(--signal)] focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)] hover:text-[var(--signal)]"
          data-testid={`${testid}-clear`}
          aria-label="Clear filter"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

const PHASE_DEFAULTS: Record<AnimPhase, Omit<AnimationRow, "elementId" | "animPhase">> = {
  entry: {
    enabled: false,
    animType: "fade",
    durationMs: 360,
    delayMs: 0,
    easing: "ease-out",
    iterationCount: "1",
    customCssKeyframes: null,
  },
  exit: {
    enabled: false,
    animType: "fade",
    durationMs: 360,
    delayMs: 0,
    easing: "ease-in",
    iterationCount: "1",
    customCssKeyframes: null,
  },
  continuous: {
    enabled: false,
    animType: "pulse",
    durationMs: 1200,
    delayMs: 0,
    easing: "ease-in-out",
    iterationCount: "infinite",
    customCssKeyframes: null,
  },
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
  /**
   * Wave 2 Stage 3 — partner strip layout for this overlay+variant
   * (null when no DB row, falls back to defaults).
   */
  initialStripLayout?: PartnerStripLayoutRow | null;
  /** Wave 2 Stage 3 — global partner logo roster. */
  initialPartnerLogos?: ReadonlyArray<PartnerLogoRow>;
  /** Wave 2 Stage 3 — per-overlay logo overrides. */
  initialLogoOverrides?: ReadonlyArray<PartnerLogoOverrideRow>;
  /**
   * Wave 2 Stage 4 — registered animatable element IDs for this
   * overlay+variant. Drives the Animations panel's element picker. The
   * page server component derives this from the union of:
   *   - text-element seed rows (from `initialTextElements`)
   *   - the partner-strip element id ("partners-strip")
   *   - any other animatable IDs declared in the static HTML for this
   *     overlay (bg-image, score-bug numbers, etc.)
   * Each entry can carry an optional `displayLabel` (universal element
   * label introduced 2026-04-28) so the row header in the Animations
   * panel reads the same human label as the Text panel. Empty list
   * collapses the panel to a "no animatable elements" placeholder.
   */
  animatableElements?: ReadonlyArray<{
    elementId: string;
    kind?: string;
    displayLabel?: string | null;
  }>;
  /**
   * Wave 2 Stage 4 — initial animation rows (DB-resolved). One row per
   * (element_id, anim_phase). Empty list when no admin overrides exist
   * yet. Editor seeds blank disabled rows for the Animation panel's
   * element picker so it can offer add-an-animation flows for elements
   * with no rows yet.
   */
  initialAnimations?: ReadonlyArray<AnimationRow>;
};

const DEFAULT_STRIP_LAYOUT: PartnerStripLayoutRow = {
  visible: true,
  // positionXPx + positionYPx are DIRECT offsets from the chosen anchor edge
  // (post 2026-04-30 semantics). 0,60 with bottom-center = strip 60px above
  // canvas bottom, horizontally centered. For top anchor: positionYPx is
  // px from top. For right: positionXPx is px from right. Etc.
  positionXPx: 0,
  positionYPx: 60,
  anchor: "bottom-center",
  orientation: "horizontal",
  scalePct: 100,
  itemSpacingPx: 64,
  justification: "center",
  zIndex: 12,
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

/**
 * Wave 2 Stage 3 — encode the partner tokens map for the iframe URL.
 * Builds the same shape the bootstrap script reads
 * (`{layout, logos[]}`).
 */
type PartnerPreviewTokens = {
  layout?: PartnerStripLayoutRow;
  logos?: Array<{
    partnerKey: string;
    label: string;
    alt: string;
    fileUrl: string;
    visible: boolean;
    sort: number;
  }>;
};

/**
 * Wave 2 Stage 4 — encode the animations map for the iframe URL. Skips
 * disabled rows and `animType === 'none'` — yields the same shape the
 * SSR resolver emits so the bootstrap reads identical wire from either
 * channel.
 */
function buildAnimationsPreviewParam(
  rows: ReadonlyArray<AnimationRow>,
): string {
  type WireEntry = {
    enabled: boolean;
    animType: AnimType;
    durationMs: number;
    delayMs: number;
    easing: string;
    iterationCount: string;
    customCssKeyframes?: string | null;
  };
  const map: Record<string, Partial<Record<AnimPhase, WireEntry>>> = {};
  for (const r of rows) {
    if (!r.enabled || r.animType === "none") continue;
    if (!map[r.elementId]) map[r.elementId] = {};
    map[r.elementId][r.animPhase] = {
      enabled: true,
      animType: r.animType,
      durationMs: r.durationMs,
      delayMs: r.delayMs,
      easing: r.easing,
      iterationCount: r.iterationCount,
      customCssKeyframes:
        r.animType === "custom-css" ? r.customCssKeyframes : null,
    };
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

function buildPartnerPreviewParam(
  layout: PartnerStripLayoutRow | null,
  logos: ReadonlyArray<PartnerLogoRow>,
  overrides: ReadonlyArray<PartnerLogoOverrideRow>,
): string {
  const overrideMap = new Map<string, PartnerLogoOverrideRow>();
  for (const o of overrides) overrideMap.set(o.partnerKey, o);

  const visibleLogos: PartnerPreviewTokens["logos"] = logos
    .filter((l) => {
      const o = overrideMap.get(l.partnerKey);
      return !o || o.visible !== false;
    })
    .map((l) => {
      const o = overrideMap.get(l.partnerKey);
      const sort = o?.sortOverride != null ? o.sortOverride : l.sortOrder;
      return {
        partnerKey: l.partnerKey,
        label: l.label,
        alt: l.alt,
        fileUrl: l.fileUrl,
        visible: true,
        sort,
      };
    });

  const tokens: PartnerPreviewTokens = {};
  if (layout) tokens.layout = layout;
  if (visibleLogos.length > 0) tokens.logos = visibleLogos;
  if (!tokens.layout && (!tokens.logos || tokens.logos.length === 0)) {
    return "";
  }

  try {
    const json = JSON.stringify(tokens);
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(json)));
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Wave 2 Stage 4 — seed an animation row map from initial DB rows +
 * registered animatable element IDs. Every (elementId, phase) pair
 * gets a row even when no DB row exists yet so the UI can offer
 * "enable this phase" toggles without first loading from server.
 */
function seedAnimationRows(
  registered: ReadonlyArray<{ elementId: string; kind?: string }>,
  initial: ReadonlyArray<AnimationRow>,
): AnimationRow[] {
  const byKey = new Map<string, AnimationRow>();
  for (const r of initial) {
    byKey.set(`${r.elementId}::${r.animPhase}`, r);
  }
  const rows: AnimationRow[] = [];
  for (const e of registered) {
    for (const phase of ANIM_PHASES) {
      const key = `${e.elementId}::${phase}`;
      const existing = byKey.get(key);
      if (existing) {
        rows.push(existing);
      } else {
        rows.push({
          elementId: e.elementId,
          animPhase: phase,
          ...PHASE_DEFAULTS[phase],
        });
      }
    }
  }
  // Append any rows from `initial` whose elementId is NOT in the
  // registered list (orphan rows from a renamed element). Surfacing
  // them lets admins clean up stale state.
  for (const r of initial) {
    const isRegistered = registered.some((e) => e.elementId === r.elementId);
    if (!isRegistered) rows.push(r);
  }
  return rows;
}

export default function OverlayDesignEditor({
  overlayKey,
  variantId,
  initialTokens,
  catalog,
  fontOptions,
  patternOptions,
  initialTextElements,
  initialStripLayout,
  initialPartnerLogos,
  initialLogoOverrides,
  animatableElements,
  initialAnimations,
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
  const [stripLayout, setStripLayout] = useState<PartnerStripLayoutRow>(
    initialStripLayout ?? DEFAULT_STRIP_LAYOUT,
  );
  const [logos, setLogos] = useState<PartnerLogoRow[]>(
    [...(initialPartnerLogos ?? [])],
  );
  const [logoOverrides, setLogoOverrides] = useState<PartnerLogoOverrideRow[]>(
    [...(initialLogoOverrides ?? [])],
  );
  const [previewPartnerParam, setPreviewPartnerParam] = useState<string>(
    buildPartnerPreviewParam(
      initialStripLayout ?? null,
      initialPartnerLogos ?? [],
      initialLogoOverrides ?? [],
    ),
  );
  const [animationRows, setAnimationRows] = useState<AnimationRow[]>(
    seedAnimationRows(animatableElements ?? [], initialAnimations ?? []),
  );
  const [previewAnimParam, setPreviewAnimParam] = useState<string>(
    buildAnimationsPreviewParam(initialAnimations ?? []),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const animDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when overlay/variant context changes.
  useEffect(() => {
    setTokens(initialTokens);
    setPreviewParam(encodeForPreview(initialTokens));
    setTextRows([...(initialTextElements ?? [])]);
    setPreviewTextParam(buildTextPreviewParam(initialTextElements ?? []));
    setStripLayout(initialStripLayout ?? DEFAULT_STRIP_LAYOUT);
    setLogos([...(initialPartnerLogos ?? [])]);
    setLogoOverrides([...(initialLogoOverrides ?? [])]);
    setPreviewPartnerParam(
      buildPartnerPreviewParam(
        initialStripLayout ?? null,
        initialPartnerLogos ?? [],
        initialLogoOverrides ?? [],
      ),
    );
    setAnimationRows(
      seedAnimationRows(animatableElements ?? [], initialAnimations ?? []),
    );
    setPreviewAnimParam(buildAnimationsPreviewParam(initialAnimations ?? []));
    setSuccess(false);
    setError(null);
  }, [
    overlayKey,
    variantId,
    initialTokens,
    initialTextElements,
    initialStripLayout,
    initialPartnerLogos,
    initialLogoOverrides,
    animatableElements,
    initialAnimations,
  ]);

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
          if (row.displayLabel) fd.set("displayLabel", row.displayLabel);
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

  /* ---------------- Wave 2 Stage 3 — partner edits ---------------- */

  const updateStripLayout = useCallback(
    (patch: Partial<PartnerStripLayoutRow>) => {
      setStripLayout((prev) => {
        const next = { ...prev, ...patch };
        if (partnerDebounceRef.current) {
          clearTimeout(partnerDebounceRef.current);
        }
        partnerDebounceRef.current = setTimeout(() => {
          setPreviewPartnerParam(
            buildPartnerPreviewParam(next, logos, logoOverrides),
          );
        }, 250);
        return next;
      });
    },
    [logos, logoOverrides],
  );

  const saveStripLayout = useCallback(() => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("overlayKey", overlayKey);
        fd.set("variantId", variantId);
        fd.set("visible", stripLayout.visible ? "true" : "false");
        fd.set("positionXPx", String(stripLayout.positionXPx));
        fd.set("positionYPx", String(stripLayout.positionYPx));
        fd.set("anchor", stripLayout.anchor);
        fd.set("orientation", stripLayout.orientation);
        fd.set("scalePct", String(stripLayout.scalePct));
        fd.set("itemSpacingPx", String(stripLayout.itemSpacingPx));
        fd.set("justification", stripLayout.justification);
        fd.set("zIndex", String(stripLayout.zIndex));
        await setStripLayoutAction(fd);
        setSuccess(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
      }
    });
  }, [overlayKey, variantId, stripLayout]);

  const removeLogo = useCallback(
    (partnerKey: string) => {
      setError(null);
      setSuccess(false);
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("partnerKey", partnerKey);
          await removePartnerLogoAction(fd);
          setLogos((prev) =>
            prev.filter((l) => l.partnerKey !== partnerKey),
          );
          setLogoOverrides((prev) =>
            prev.filter((o) => o.partnerKey !== partnerKey),
          );
          setSuccess(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "remove failed");
        }
      });
    },
    [],
  );

  const setOverride = useCallback(
    (
      partnerKey: string,
      patch: { visible?: boolean; sortOverride?: number | null },
    ) => {
      setError(null);
      setSuccess(false);
      const existing = logoOverrides.find((o) => o.partnerKey === partnerKey);
      const next: PartnerLogoOverrideRow = {
        partnerKey,
        visible:
          patch.visible !== undefined
            ? patch.visible
            : existing?.visible ?? true,
        sortOverride:
          patch.sortOverride !== undefined
            ? patch.sortOverride
            : existing?.sortOverride ?? null,
      };
      setLogoOverrides((prev) => {
        const without = prev.filter((o) => o.partnerKey !== partnerKey);
        return [...without, next];
      });
      // Live preview: rebuild now (debounced).
      if (partnerDebounceRef.current) {
        clearTimeout(partnerDebounceRef.current);
      }
      partnerDebounceRef.current = setTimeout(() => {
        const newOverrides = [
          ...logoOverrides.filter((o) => o.partnerKey !== partnerKey),
          next,
        ];
        setPreviewPartnerParam(
          buildPartnerPreviewParam(stripLayout, logos, newOverrides),
        );
      }, 250);
      // Persist.
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("overlayKey", overlayKey);
          fd.set("variantId", variantId);
          fd.set("partnerKey", partnerKey);
          fd.set("visible", next.visible ? "true" : "false");
          if (next.sortOverride != null) {
            fd.set("sortOverride", String(next.sortOverride));
          }
          await setLogoOverrideAction(fd);
          setSuccess(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "override failed");
        }
      });
    },
    [logoOverrides, logos, stripLayout, overlayKey, variantId],
  );

  /* ---------------- Wave 2 Stage 4 — animation edits ---------------- */

  const updateAnimationRow = useCallback(
    (elementId: string, phase: AnimPhase, patch: Partial<AnimationRow>) => {
      setAnimationRows((prev) => {
        const next = prev.map((r) =>
          r.elementId === elementId && r.animPhase === phase
            ? { ...r, ...patch }
            : r,
        );
        if (animDebounceRef.current) clearTimeout(animDebounceRef.current);
        animDebounceRef.current = setTimeout(() => {
          setPreviewAnimParam(buildAnimationsPreviewParam(next));
        }, 250);
        return next;
      });
    },
    [],
  );

  const saveAnimationRow = useCallback(
    (elementId: string, phase: AnimPhase) => {
      setError(null);
      setSuccess(false);
      const row = animationRows.find(
        (r) => r.elementId === elementId && r.animPhase === phase,
      );
      if (!row) return;
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("overlayKey", overlayKey);
          fd.set("variantId", variantId);
          fd.set("elementId", row.elementId);
          fd.set("animPhase", row.animPhase);
          fd.set("enabled", row.enabled ? "true" : "false");
          fd.set("animType", row.animType);
          fd.set("durationMs", String(row.durationMs));
          fd.set("delayMs", String(row.delayMs));
          fd.set("easing", row.easing);
          fd.set("iterationCount", row.iterationCount);
          if (row.animType === "custom-css" && row.customCssKeyframes) {
            fd.set("customCssKeyframes", row.customCssKeyframes);
          }
          await setAnimationAction(fd);
          setSuccess(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "save failed");
        }
      });
    },
    [animationRows, overlayKey, variantId],
  );

  const resetAnimationRow = useCallback(
    (elementId: string, phase: AnimPhase) => {
      setError(null);
      setSuccess(false);
      startTransition(async () => {
        try {
          const fd = new FormData();
          fd.set("overlayKey", overlayKey);
          fd.set("variantId", variantId);
          fd.set("elementId", elementId);
          fd.set("animPhase", phase);
          await clearAnimationAction(fd);
          setAnimationRows((prev) => {
            const next = prev.map((r) =>
              r.elementId === elementId && r.animPhase === phase
                ? {
                    elementId,
                    animPhase: phase,
                    ...PHASE_DEFAULTS[phase],
                  }
                : r,
            );
            setPreviewAnimParam(buildAnimationsPreviewParam(next));
            return next;
          });
          setSuccess(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "reset failed");
        }
      });
    },
    [overlayKey, variantId],
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
    // Wave 2 Stage 3 — partner-strip + logo preview overrides.
    if (previewPartnerParam) {
      qs.set("previewPartnerTokens", previewPartnerParam);
    }
    // Wave 2 Stage 4 — animation preview overrides.
    if (previewAnimParam) {
      qs.set("previewAnimTokens", previewAnimParam);
    }
    return `/overlay/v2/${overlayKey}?${qs.toString()}`;
  }, [
    overlayKey,
    variantId,
    previewParam,
    previewTextParam,
    previewPartnerParam,
    previewAnimParam,
  ]);

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

  // 2026-04-28 UX overhaul — derive section open-state from a single
  // controlled hook backed by localStorage. Only one section is open at
  // a time so admins don't lose their visual orientation when scrolling
  // between Tokens / Text / Partners / Animations.
  const sectionKey = `overlayDesign:openSection:${overlayKey}`;
  const initialSection: SectionId =
    textRows.length > 0 ? "text" : "tokens";
  const { openSection, setOpenSection } = useAccordion(
    sectionKey,
    initialSection,
  );

  // 2026-04-28 UX overhaul — text + animation row filters. Filter state
  // is local (not persisted); typing narrows the visible row list while
  // leaving editor + preview state untouched.
  const [textFilter, setTextFilter] = useState<string>("");
  const [animFilter, setAnimFilter] = useState<string>("");

  const filteredTextRows = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return textRows;
    return textRows.filter((r) => {
      const label = (r.displayLabel ?? prettyId(r.elementId)).toLowerCase();
      const id = r.elementId.toLowerCase();
      const kind = r.kind.toLowerCase();
      return label.includes(q) || id.includes(q) || kind.includes(q);
    });
  }, [textRows, textFilter]);

  // Group text rows by kind so admins can scan quickly. Preserve original
  // sort order within each group.
  const groupedTextRows = useMemo(() => {
    const groups = new Map<string, TextElementRow[]>();
    for (const r of filteredTextRows) {
      const key = r.kind || "text";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return Array.from(groups.entries());
  }, [filteredTextRows]);

  const dirtyAnimCount = animationRows.filter(
    (r) => r.enabled && r.animType !== "none",
  ).length;
  const partnerLogoCount = logos.length;
  const tokenCount = filteredCatalog.length;
  const textCount = textRows.length;

  const sectionDefs: ReadonlyArray<SectionDef> = useMemo(
    () => [
      ...(textRows.length > 0
        ? [
            {
              id: "text" as const,
              title: "Text",
              count: textCount,
              hint: "Per-element copy, typography, position, opacity",
            },
          ]
        : []),
      {
        id: "partners" as const,
        title: "Partners",
        count: partnerLogoCount,
        hint: "Strip layout + global logo roster",
      },
      {
        id: "animations" as const,
        title: "Animations",
        count: dirtyAnimCount,
        hint: "Per-element entry / exit / continuous phases",
      },
      {
        id: "tokens" as const,
        title: "Tokens",
        count: tokenCount,
        hint: "Color, font, scale, pattern, background image",
      },
    ],
    [
      textRows.length,
      textCount,
      partnerLogoCount,
      dirtyAnimCount,
      tokenCount,
    ],
  );

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]"
      data-testid="overlay-design-editor-root"
    >
      <div className="space-y-3" data-testid="overlay-design-section-list">
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Editor sections
          </p>
          <p className="mt-1 text-xs text-[var(--chalk-2)]">
            One section open at a time. Live preview stays pinned on the right
            so every change is visible without scrolling. Selection persists
            across navigations.
          </p>
        </div>

        <SectionAccordion
          sections={sectionDefs}
          openSection={openSection}
          onToggle={setOpenSection}
        >
          {textRows.length > 0 ? (
            <SectionPane
              id="text"
              openSection={openSection}
              testid="overlay-design-text-panel"
            >
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
                Text — {textRows.length} element
                {textRows.length === 1 ? "" : "s"}
                {filteredTextRows.length !== textRows.length ? (
                  <span className="ml-2 text-[var(--signal)]">
                    {filteredTextRows.length} match
                    {filteredTextRows.length === 1 ? "" : "es"}
                  </span>
                ) : null}
              </h3>
              <p className="mb-3 text-xs text-[var(--chalk-3)]">
                Override the text content + per-element typography for any
                labelled element on this overlay. Empty fields inherit the
                HTML default. Save persists; Reset clears overrides for that
                row.
              </p>
              <SectionFilter
                value={textFilter}
                onChange={setTextFilter}
                placeholder="Filter text rows by label, id, or kind…"
                testid="overlay-design-text-filter"
              />
              {filteredTextRows.length === 0 ? (
                <p className="mt-3 text-xs italic text-[var(--chalk-3)]">
                  No rows match{" "}
                  <span className="font-mono">{`"${textFilter}"`}</span>.
                </p>
              ) : (
                <div
                  className="mt-3 space-y-4"
                  data-testid="overlay-design-text-rows"
                >
                  {groupedTextRows.map(([kind, rows]) => (
                    <div
                      key={kind}
                      className="space-y-2"
                      data-testid={`overlay-design-text-group-${kind}`}
                    >
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                        {kindLabel(kind)} — {rows.length}
                      </h4>
                      <div className="space-y-2">
                        {rows.map((row) => (
                          <TextElementEditorRow
                            key={row.elementId}
                            row={row}
                            fontOptions={fontOptions}
                            pending={pending}
                            onUpdate={(patch) =>
                              updateTextRow(row.elementId, patch)
                            }
                            onSave={() => saveTextRow(row.elementId)}
                            onReset={() => resetTextRow(row.elementId)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionPane>
          ) : null}

          <SectionPane
            id="partners"
            openSection={openSection}
            testid="overlay-design-partners-pane"
          >
            <PartnersPanel
              overlayKey={overlayKey}
              variantId={variantId}
              stripLayout={stripLayout}
              logos={logos}
              overrides={logoOverrides}
              pending={pending}
              onUpdateLayout={updateStripLayout}
              onSaveLayout={saveStripLayout}
              onUploaded={(newLogo) => {
                setLogos((prev) => [...prev, newLogo]);
              }}
              onRemoveLogo={removeLogo}
              onSetOverride={setOverride}
            />
          </SectionPane>

          <SectionPane
            id="animations"
            openSection={openSection}
            testid="overlay-design-animations-pane"
          >
            <AnimationsPanel
              rows={animationRows}
              registry={animatableElements ?? []}
              pending={pending}
              onUpdate={updateAnimationRow}
              onSave={saveAnimationRow}
              onReset={resetAnimationRow}
              filter={animFilter}
              onFilterChange={setAnimFilter}
            />
          </SectionPane>

          <SectionPane
            id="tokens"
            openSection={openSection}
            testid="overlay-design-tokens-pane"
          >
            <div
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
              data-testid="overlay-design-tokens-panel"
            >
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
                Tokens — {filteredCatalog.length}
              </h3>
              <p className="mb-4 text-xs text-[var(--chalk-3)]">
                Brand-wide colors, fonts, and visual scaffold for this
                overlay. Live preview updates on every change. Save persists
                the whole map; Discard reverts to the last saved values.
              </p>
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
                <SecondaryButton
                  onClick={onDiscard}
                  disabled={pending}
                  size="sm"
                >
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
          </SectionPane>
        </SectionAccordion>
      </div>

      <aside
        className="lg:sticky lg:top-4 lg:h-fit"
        data-testid="overlay-design-preview-aside"
      >
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
           * `scale(0.4)` truncated wide containers and over-shrank narrow
           * ones; now `100cqi / 1920` (CSS container-query inline-size unit)
           * computes scale dynamically so the canvas always fills the
           * container exactly. `aspectRatio: 16/9` keeps height in lockstep
           * with the scaled width.
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
          <p className="mt-2 text-[10px] text-[var(--chalk-3)]">
            Iframe renders /overlay/v2/{overlayKey}?demo=1 with your pending
            tokens applied via the previewTokens param. The 1920×1080 canvas
            is scaled to fit at 16:9. Save to persist.
          </p>
          <div
            className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-[var(--chalk-3)]"
            data-testid="overlay-design-summary-stats"
          >
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5">
              <span className="block uppercase tracking-[0.18em]">Text</span>
              <span className="font-mono text-sm text-[var(--chalk-1)]">
                {textCount}
              </span>
            </div>
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5">
              <span className="block uppercase tracking-[0.18em]">
                Partners
              </span>
              <span className="font-mono text-sm text-[var(--chalk-1)]">
                {partnerLogoCount}
              </span>
            </div>
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5">
              <span className="block uppercase tracking-[0.18em]">
                Anim. on
              </span>
              <span className="font-mono text-sm text-[var(--chalk-1)]">
                {dirtyAnimCount}
              </span>
            </div>
            <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5">
              <span className="block uppercase tracking-[0.18em]">
                Tokens
              </span>
              <span className="font-mono text-sm text-[var(--chalk-1)]">
                {tokenCount}
              </span>
            </div>
          </div>
        </div>
      </aside>
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
 * Convert a kebab-case `element_id` into a Title-Case fallback label
 * for the row header (e.g. `home-score` → "Home Score"). Only used when
 * the DB row carries a NULL `display_label` (legacy rows that pre-date
 * the universal-element-labels migration `20260620000010`).
 */
export function prettyId(id: string): string {
  if (!id) return "";
  return id
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Map a `kind` enum value (DB-stored) to a short human-readable badge
 * label for the row header. Covers both legacy typographic kinds and
 * semantic kinds. Falls back to the raw kind for unknown values.
 *
 * Pairs with the kind allowlist in
 * `apps/web/src/server/overlays/text/elements.ts::TEXT_KINDS` and the
 * DB CHECK constraint introduced in migration `20260620000010_*`.
 */
export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    // Legacy typographic
    case "heading":
      return "Heading";
    case "subheading":
      return "Subheading";
    case "eyebrow":
      return "Eyebrow";
    case "title":
      return "Title";
    case "subtitle":
      return "Subtitle";
    case "caption":
      return "Caption";
    case "number":
      return "Number";
    case "label":
      return "Label";
    case "body":
      return "Body";
    case "image":
      return "Image";
    case "layout":
      return "Layout";
    // Semantic (post-2026-04-28)
    case "text":
      return "Text";
    case "score-number":
      return "Score";
    case "player-name":
      return "Player Name";
    case "player-photo":
      return "Photo";
    case "player-box":
      return "Player Box";
    case "sponsor-logo-strip":
      return "Sponsor (Strip)";
    case "sponsor-logo-floating":
      return "Sponsor Logo";
    case "partner-strip-container":
      return "Partner Strip";
    case "bg-image":
      return "Background";
    case "bg-vignette":
      return "Vignette";
    case "box":
      return "Box";
    default:
      return typeof kind === "string" && kind.length > 0 ? kind : "Element";
  }
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
    // Sentinel "none" tells the bootstrap to emit
    // `--overlay-bg-image: none` so var() resolves to none and the
    // hardcoded HTML default does NOT show through (Bug #28 fix).
    onChange("none");
  }, [onChange]);

  const isOff = value === "none";
  const isUploaded = value && value !== "none";
  return (
    <div className="space-y-1.5">
      <label className={labelStyle}>{entry.label}</label>
      <div className="flex items-start gap-3">
        {/* Thumb — 80×45 to match 16:9 ratio of the overlay canvas. */}
        <div
          className="flex h-[45px] w-[80px] flex-none items-center justify-center overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
          data-testid={`token-${entry.tokenKey}-thumb`}
        >
          {isUploaded ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="bg preview"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : isOff ? (
            <span className="px-1 text-center text-[8px] uppercase tracking-[0.18em] text-[var(--flare)]">
              Off
            </span>
          ) : (
            <span className="px-1 text-center text-[8px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Default
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
              disabled={uploading || isOff}
              type="button"
              title="Turn the background image off (admin set OFF, not just clear-to-default)"
            >
              Off
            </SecondaryButton>
            <SecondaryButton
              size="sm"
              onClick={() => onChange("")}
              disabled={uploading || !value}
              type="button"
              title="Revert to overlay HTML default"
            >
              Default
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
          {isUploaded && !uploadError ? (
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
  // Image-like kinds skip the content field entirely — these are picture
  // / sponsor-logo / background slots driven by data, not text. Layout
  // kinds (box / partner-strip / player-box) are pure containers.
  const isImage =
    row.kind === "image" ||
    row.kind === "player-photo" ||
    row.kind === "bg-image" ||
    row.kind === "bg-vignette" ||
    row.kind === "sponsor-logo-strip" ||
    row.kind === "sponsor-logo-floating";
  const isLayout =
    row.kind === "layout" ||
    row.kind === "box" ||
    row.kind === "player-box" ||
    row.kind === "partner-strip-container";
  const headerLabel = row.displayLabel || prettyId(row.elementId);

  return (
    <details
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
      data-testid={`text-row-${row.elementId}`}
    >
      <summary className="cursor-pointer list-none px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                data-testid={`text-row-${row.elementId}-kind-label`}
              >
                {kindLabel(row.kind)}
              </span>
              <span
                className="font-display text-sm font-bold text-[var(--chalk-0)]"
                data-testid={`text-row-${row.elementId}-display-label`}
              >
                {headerLabel}
              </span>
              <span className="font-mono text-[10px] text-[var(--chalk-3)]">
                {row.elementId}
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
            <label className={labelStyle}>Letter spacing (em)</label>
            <input
              type="number"
              min={-0.5}
              max={1}
              step={0.01}
              value={row.letterSpacing ?? ""}
              onChange={(e) =>
                onUpdate({
                  letterSpacing:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder="0.10"
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-letter-spacing`}
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Line height</label>
            <input
              type="number"
              min={0.5}
              max={3}
              step={0.05}
              value={row.lineHeight ?? ""}
              onChange={(e) =>
                onUpdate({
                  lineHeight:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder="1.00"
              className={inputStyle}
              data-testid={`text-row-${row.elementId}-line-height`}
            />
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

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 3 — Partners panel                                    *
 * ------------------------------------------------------------------ */

const ANCHOR_OPTIONS: PartnerStripLayoutRow["anchor"][] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const ORIENTATION_OPTIONS: PartnerStripLayoutRow["orientation"][] = [
  "horizontal",
  "vertical",
];
const JUSTIFICATION_OPTIONS: PartnerStripLayoutRow["justification"][] = [
  "start",
  "center",
  "end",
  "space-between",
];

function PartnersPanel({
  overlayKey,
  variantId,
  stripLayout,
  logos,
  overrides,
  pending,
  onUpdateLayout,
  onSaveLayout,
  onUploaded,
  onRemoveLogo,
  onSetOverride,
}: {
  overlayKey: string;
  variantId: string;
  stripLayout: PartnerStripLayoutRow;
  logos: ReadonlyArray<PartnerLogoRow>;
  overrides: ReadonlyArray<PartnerLogoOverrideRow>;
  pending: boolean;
  onUpdateLayout: (patch: Partial<PartnerStripLayoutRow>) => void;
  onSaveLayout: () => void;
  onUploaded: (logo: PartnerLogoRow) => void;
  onRemoveLogo: (partnerKey: string) => void;
  onSetOverride: (
    partnerKey: string,
    patch: { visible?: boolean; sortOverride?: number | null },
  ) => void;
}) {
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]";
  const inputStyle =
    "w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none";

  const overrideMap = useMemo(() => {
    const m = new Map<string, PartnerLogoOverrideRow>();
    for (const o of overrides) m.set(o.partnerKey, o);
    return m;
  }, [overrides]);

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      data-testid="overlay-design-partners-panel"
    >
      <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
        Partners
      </h3>
      <p className="mb-4 text-xs text-[var(--chalk-3)]">
        Tune partner-strip position + scale on this overlay, manage the
        global logo roster, and toggle visibility per overlay. Live preview
        updates on every change; Save persists.
      </p>

      {/* Strip layout */}
      <div
        className="space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3"
        data-testid="overlay-design-partners-layout"
      >
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-2)]">
            Strip layout · {overlayKey} · {variantId}
          </h4>
          <label className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            <input
              type="checkbox"
              checked={stripLayout.visible}
              onChange={(e) =>
                onUpdateLayout({ visible: e.target.checked })
              }
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]"
              data-testid="strip-layout-visible"
            />
            Visible
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelStyle}>Anchor</label>
            <select
              value={stripLayout.anchor}
              onChange={(e) =>
                onUpdateLayout({
                  anchor: e.target.value as PartnerStripLayoutRow["anchor"],
                })
              }
              className={inputStyle}
              data-testid="strip-layout-anchor"
            >
              {ANCHOR_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Orientation</label>
            <select
              value={stripLayout.orientation}
              onChange={(e) =>
                onUpdateLayout({
                  orientation: e.target
                    .value as PartnerStripLayoutRow["orientation"],
                })
              }
              className={inputStyle}
              data-testid="strip-layout-orientation"
            >
              {ORIENTATION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Position X (px)</label>
            <input
              type="number"
              min={-1920}
              max={1920}
              step={1}
              value={stripLayout.positionXPx}
              onChange={(e) =>
                onUpdateLayout({
                  positionXPx: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 0,
                })
              }
              className={inputStyle}
              data-testid="strip-layout-pos-x"
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Position Y (px)</label>
            <input
              type="number"
              min={-1080}
              max={1080}
              step={1}
              value={stripLayout.positionYPx}
              onChange={(e) =>
                onUpdateLayout({
                  positionYPx: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 0,
                })
              }
              className={inputStyle}
              data-testid="strip-layout-pos-y"
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Scale (%)</label>
            <input
              type="number"
              min={20}
              max={200}
              step={1}
              value={stripLayout.scalePct}
              onChange={(e) =>
                onUpdateLayout({
                  scalePct: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 100,
                })
              }
              className={inputStyle}
              data-testid="strip-layout-scale"
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Item spacing (px)</label>
            <input
              type="number"
              min={0}
              max={256}
              step={1}
              value={stripLayout.itemSpacingPx}
              onChange={(e) =>
                onUpdateLayout({
                  itemSpacingPx: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 0,
                })
              }
              className={inputStyle}
              data-testid="strip-layout-spacing"
            />
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Justification</label>
            <select
              value={stripLayout.justification}
              onChange={(e) =>
                onUpdateLayout({
                  justification: e.target
                    .value as PartnerStripLayoutRow["justification"],
                })
              }
              className={inputStyle}
              data-testid="strip-layout-justification"
            >
              {JUSTIFICATION_OPTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelStyle}>Z-index</label>
            <input
              type="number"
              min={0}
              max={40}
              step={1}
              value={stripLayout.zIndex}
              onChange={(e) =>
                onUpdateLayout({
                  zIndex: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 12,
                })
              }
              className={inputStyle}
              data-testid="strip-layout-z-index"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <PrimaryButton
            type="button"
            size="sm"
            disabled={pending}
            onClick={onSaveLayout}
            data-testid="strip-layout-save"
          >
            Save layout
          </PrimaryButton>
        </div>
      </div>

      {/* Logo roster */}
      <div
        className="mt-4 space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3"
        data-testid="overlay-design-partners-roster"
      >
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-2)]">
          Partner logos · global
        </h4>
        {logos.length === 0 ? (
          <p className="text-xs italic text-[var(--chalk-3)]">
            No partner logos uploaded yet. Upload one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {logos.map((logo) => {
              const o = overrideMap.get(logo.partnerKey);
              const enabled = o ? o.visible !== false : true;
              return (
                <li
                  key={logo.partnerKey}
                  className="flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-2"
                  data-testid={`partner-logo-${logo.partnerKey}`}
                >
                  <div className="flex h-9 w-16 flex-none items-center justify-center overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logo.fileUrl}
                      alt={logo.alt}
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                        data-testid={`partner-logo-${logo.partnerKey}-kind-label`}
                      >
                        Sponsor (Strip)
                      </span>
                      <span
                        className="font-display text-sm font-bold text-[var(--chalk-0)]"
                        data-testid={`partner-logo-${logo.partnerKey}-display-label`}
                      >
                        {logo.displayLabel || logo.label || logo.alt}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--chalk-3)]">
                        {logo.partnerKey}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--chalk-3)]">
                      {logo.dimensionWPx}×{logo.dimensionHPx}
                    </span>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        onSetOverride(logo.partnerKey, {
                          visible: e.target.checked,
                        })
                      }
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]"
                      data-testid={`partner-logo-${logo.partnerKey}-enabled`}
                    />
                    On
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    placeholder={String(logo.sortOrder)}
                    value={o?.sortOverride ?? ""}
                    onChange={(e) =>
                      onSetOverride(logo.partnerKey, {
                        sortOverride:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-14 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-1 py-0.5 text-center font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
                    title="Per-overlay sort override (empty = use global sort_order)"
                    data-testid={`partner-logo-${logo.partnerKey}-sort`}
                  />
                  <SecondaryButton
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => onRemoveLogo(logo.partnerKey)}
                    data-testid={`partner-logo-${logo.partnerKey}-remove`}
                  >
                    Remove
                  </SecondaryButton>
                </li>
              );
            })}
          </ul>
        )}

        <PartnerLogoUploader pending={pending} onUploaded={onUploaded} />

        <p className="text-[10px] italic text-[var(--chalk-3)]">
          ~600×300 PNG/JPG/WebP/SVG, ≤500 KB. Transparent bg recommended.
          Tolerance ±10% on dimensions.
        </p>
      </div>
    </div>
  );
}

/**
 * Upload widget for new partner logos. Accepts file + label/alt/key/
 * sort then calls `uploadPartnerLogoAction`. On success the parent
 * appends the new row to its local roster state so the live preview
 * picks it up immediately.
 */
function PartnerLogoUploader({
  pending,
  onUploaded,
}: {
  pending: boolean;
  onUploaded: (logo: PartnerLogoRow) => void;
}) {
  const [partnerKey, setPartnerKey] = useState("");
  const [label, setLabel] = useState("");
  const [alt, setAlt] = useState("");
  const [sortOrder, setSortOrder] = useState("99");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]";
  const inputStyle =
    "w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none";

  const handleUpload = useCallback(async () => {
    setUploadError(null);
    const f = fileInputRef.current?.files?.[0];
    if (!f) {
      setUploadError("Select a file first");
      return;
    }
    if (!partnerKey || !label || !alt) {
      setUploadError("partnerKey, label, alt are all required");
      return;
    }
    const ALLOWED = new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml",
    ]);
    if (!ALLOWED.has(f.type)) {
      setUploadError(`Unsupported type ${f.type}`);
      return;
    }
    if (f.size > 500 * 1024) {
      setUploadError(
        `File too large (${(f.size / 1024).toFixed(0)} KB; max 500 KB)`,
      );
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("partnerKey", partnerKey);
      fd.set("label", label);
      fd.set("alt", alt);
      fd.set("sortOrder", sortOrder);
      fd.set("file", f);
      const res = await uploadPartnerLogoAction(fd);
      if (!res.ok) {
        setUploadError(res.error);
      } else {
        onUploaded({
          partnerKey: res.partnerKey,
          label,
          alt,
          fileUrl: res.fileUrl,
          sortOrder: Number(sortOrder),
          // Provisional dimensions — server-side row carries the
          // probed values, but we don't have them here. The page will
          // re-resolve on next render.
          dimensionWPx: 600,
          dimensionHPx: 300,
        });
        // Reset.
        setPartnerKey("");
        setLabel("");
        setAlt("");
        setSortOrder("99");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, [partnerKey, label, alt, sortOrder, onUploaded]);

  return (
    <div
      className="space-y-2 rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-2"
      data-testid="partner-logo-uploader"
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={labelStyle}>Partner key</label>
          <input
            type="text"
            value={partnerKey}
            onChange={(e) => setPartnerKey(e.target.value)}
            placeholder="my-new-partner"
            className={inputStyle}
            data-testid="partner-uploader-key"
          />
        </div>
        <div className="space-y-1">
          <label className={labelStyle}>Sort order</label>
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className={inputStyle}
            data-testid="partner-uploader-sort"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className={labelStyle}>Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My New Partner"
            className={inputStyle}
            data-testid="partner-uploader-label"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className={labelStyle}>Alt text</label>
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="My New Partner logo"
            className={inputStyle}
            data-testid="partner-uploader-alt"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className={labelStyle}>File</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={uploading}
            data-testid="partner-uploader-file"
            className="block w-full text-[10px] text-[var(--chalk-2)] file:mr-2 file:rounded-sm file:border file:border-[var(--ink-4)] file:bg-[var(--ink-1)] file:px-2 file:py-1 file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.18em] file:text-[var(--chalk-1)] hover:file:border-[var(--signal)] hover:file:text-[var(--signal)]"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <PrimaryButton
          type="button"
          size="sm"
          disabled={uploading || pending}
          onClick={handleUpload}
          data-testid="partner-uploader-upload"
        >
          {uploading ? "Uploading…" : "Upload partner logo"}
        </PrimaryButton>
        {uploadError ? (
          <span
            className="text-xs text-[var(--flare)]"
            data-testid="partner-uploader-error"
          >
            {uploadError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 4 — Animations panel                                  *
 * ------------------------------------------------------------------ */

/**
 * Per-element animation editor. Renders one collapsed-by-default
 * <details> per element_id; expanded state shows three phase tabs
 * (Entry / Exit / Continuous) with type / duration / delay / easing /
 * iterations / enabled / customCssKeyframes (when type='custom-css').
 *
 * Save persists a single (element_id, anim_phase) row via
 * `setAnimationAction`. Reset soft-deletes the row via
 * `clearAnimationAction` and resets local state to phase defaults.
 *
 * Live preview re-renders via `?previewAnimTokens=` (debounced 250 ms
 * in the parent's `updateAnimationRow`).
 */
function AnimationsPanel({
  rows,
  registry,
  pending,
  onUpdate,
  onSave,
  onReset,
  filter = "",
  onFilterChange,
}: {
  rows: ReadonlyArray<AnimationRow>;
  registry: ReadonlyArray<{
    elementId: string;
    kind?: string;
    displayLabel?: string | null;
  }>;
  pending: boolean;
  onUpdate: (
    elementId: string,
    phase: AnimPhase,
    patch: Partial<AnimationRow>,
  ) => void;
  onSave: (elementId: string, phase: AnimPhase) => void;
  onReset: (elementId: string, phase: AnimPhase) => void;
  /**
   * Optional filter string — narrows visible elements by displayLabel /
   * elementId / kind. When undefined the panel renders every element.
   */
  filter?: string;
  onFilterChange?: (next: string) => void;
}) {
  const [activePhase, setActivePhase] = useState<
    Record<string, AnimPhase>
  >({});

  // Lookup table for the universal element label + kind. Pairs with
  // the same shape rendered in the Text panel so admins see one
  // consistent label across every panel for the same element_id.
  const registryByKey = useMemo(() => {
    const m = new Map<
      string,
      { kind?: string; displayLabel?: string | null }
    >();
    for (const r of registry) {
      m.set(r.elementId, { kind: r.kind, displayLabel: r.displayLabel });
    }
    return m;
  }, [registry]);

  // Group rows by element_id.
  const byElement = useMemo(() => {
    const m = new Map<string, AnimationRow[]>();
    for (const r of rows) {
      const arr = m.get(r.elementId) ?? [];
      arr.push(r);
      m.set(r.elementId, arr);
    }
    return Array.from(m.entries());
  }, [rows]);

  // 2026-04-28 UX overhaul — filter visible elements by id / displayLabel /
  // kind. Empty filter is no-op.
  const filteredByElement = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return byElement;
    return byElement.filter(([elementId]) => {
      const meta = registryByKey.get(elementId);
      const label = (meta?.displayLabel ?? prettyId(elementId)).toLowerCase();
      const kind = (meta?.kind ?? "").toLowerCase();
      return (
        elementId.toLowerCase().includes(q) ||
        label.includes(q) ||
        kind.includes(q)
      );
    });
  }, [byElement, filter, registryByKey]);

  if (byElement.length === 0) {
    return (
      <div
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
        data-testid="overlay-design-animations-panel"
      >
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Animations
        </h3>
        <p className="text-xs italic text-[var(--chalk-3)]">
          No animatable elements registered for this overlay yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      data-testid="overlay-design-animations-panel"
    >
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
        Animations — {byElement.length} element
        {byElement.length === 1 ? "" : "s"}
        {filter.trim() && filteredByElement.length !== byElement.length ? (
          <span className="ml-2 text-[var(--signal)]">
            {filteredByElement.length} match
            {filteredByElement.length === 1 ? "" : "es"}
          </span>
        ) : null}
      </h3>
      <p className="mb-3 text-xs text-[var(--chalk-3)]">
        Add Entry, Continuous, and Exit animations per element. Live preview
        re-fires with each change. Save persists the selected phase; Reset
        clears that phase entirely.
      </p>
      {onFilterChange ? (
        <div className="mb-3">
          <SectionFilter
            value={filter}
            onChange={onFilterChange}
            placeholder="Filter animations by label, id, or kind…"
            testid="overlay-design-anim-filter"
          />
        </div>
      ) : null}
      {filteredByElement.length === 0 ? (
        <p className="text-xs italic text-[var(--chalk-3)]">
          No rows match{" "}
          <span className="font-mono">{`"${filter}"`}</span>.
        </p>
      ) : (
      <div className="space-y-3" data-testid="overlay-design-animation-rows">
        {filteredByElement.map(([elementId, elementRows]) => {
          const phase = activePhase[elementId] ?? "entry";
          const row =
            elementRows.find((r) => r.animPhase === phase) ?? {
              elementId,
              animPhase: phase,
              ...PHASE_DEFAULTS[phase],
            };
          const enabledPhases = elementRows
            .filter((r) => r.enabled && r.animType !== "none")
            .map((r) => r.animPhase);
          return (
            <details
              key={elementId}
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]"
              data-testid={`anim-element-${elementId}`}
            >
              <summary className="cursor-pointer list-none px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    {(() => {
                      const meta = registryByKey.get(elementId);
                      const labelText =
                        meta?.displayLabel || prettyId(elementId);
                      return (
                        <>
                          <span
                            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                            data-testid={`anim-element-${elementId}-kind-label`}
                          >
                            {kindLabel(meta?.kind)}
                          </span>
                          <span
                            className="font-display text-sm font-bold text-[var(--chalk-0)]"
                            data-testid={`anim-element-${elementId}-display-label`}
                          >
                            {labelText}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--chalk-3)]">
                            {elementId}
                          </span>
                        </>
                      );
                    })()}
                    {enabledPhases.length > 0 ? (
                      <span className="rounded-sm border border-[var(--primary)] px-1.5 py-px text-[9px] uppercase tracking-[0.18em] text-[var(--signal)]">
                        {enabledPhases.length} phase
                        {enabledPhases.length === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="rounded-sm border border-[var(--ink-4)] px-1.5 py-px text-[9px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                        none
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--chalk-3)]">▾</span>
                </div>
              </summary>
              <div className="space-y-3 border-t border-[var(--ink-4)] px-3 py-3">
                <div
                  className="flex items-center gap-1"
                  data-testid={`anim-phase-tabs-${elementId}`}
                >
                  {ANIM_PHASES.map((p) => {
                    const isActive = p === phase;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setActivePhase((prev) => ({
                            ...prev,
                            [elementId]: p,
                          }))
                        }
                        className={`rounded-sm border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                          isActive
                            ? "border-[var(--primary)] bg-[var(--primary)]/20 text-[var(--signal)]"
                            : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-3)]"
                        }`}
                        data-testid={`anim-phase-${elementId}-${p}`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <AnimationPhaseEditor
                  row={row}
                  pending={pending}
                  onUpdate={(patch) => onUpdate(elementId, phase, patch)}
                  onSave={() => onSave(elementId, phase)}
                  onReset={() => onReset(elementId, phase)}
                />
              </div>
            </details>
          );
        })}
      </div>
      )}
    </div>
  );
}

function AnimationPhaseEditor({
  row,
  pending,
  onUpdate,
  onSave,
  onReset,
}: {
  row: AnimationRow;
  pending: boolean;
  onUpdate: (patch: Partial<AnimationRow>) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const labelStyle =
    "block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]";
  const inputStyle =
    "w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 font-mono text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={labelStyle}>Type</label>
          <select
            value={row.animType}
            onChange={(e) =>
              onUpdate({ animType: e.target.value as AnimType })
            }
            className={inputStyle}
            data-testid={`anim-${row.elementId}-${row.animPhase}-type`}
          >
            {ANIM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelStyle}>Easing</label>
          <select
            value={row.easing}
            onChange={(e) => onUpdate({ easing: e.target.value })}
            className={inputStyle}
            data-testid={`anim-${row.elementId}-${row.animPhase}-easing`}
          >
            {EASING_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelStyle}>Duration ms</label>
          <input
            type="number"
            min={50}
            max={5000}
            step={10}
            value={row.durationMs}
            onChange={(e) =>
              onUpdate({
                durationMs: Number.isFinite(Number(e.target.value))
                  ? Number(e.target.value)
                  : 360,
              })
            }
            className={inputStyle}
            data-testid={`anim-${row.elementId}-${row.animPhase}-duration`}
          />
        </div>
        <div className="space-y-1">
          <label className={labelStyle}>Delay ms</label>
          <input
            type="number"
            min={0}
            max={5000}
            step={10}
            value={row.delayMs}
            onChange={(e) =>
              onUpdate({
                delayMs: Number.isFinite(Number(e.target.value))
                  ? Number(e.target.value)
                  : 0,
              })
            }
            className={inputStyle}
            data-testid={`anim-${row.elementId}-${row.animPhase}-delay`}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className={labelStyle}>Iterations</label>
          <input
            type="text"
            value={row.iterationCount}
            onChange={(e) => onUpdate({ iterationCount: e.target.value })}
            placeholder="1 or 'infinite'"
            className={inputStyle}
            maxLength={10}
            data-testid={`anim-${row.elementId}-${row.animPhase}-iterations`}
          />
        </div>
      </div>
      {row.animType === "custom-css" ? (
        <div className="space-y-1">
          <label className={labelStyle}>Custom CSS keyframes</label>
          <textarea
            value={row.customCssKeyframes ?? ""}
            onChange={(e) =>
              onUpdate({
                customCssKeyframes: e.target.value === "" ? null : e.target.value,
              })
            }
            placeholder="0% { opacity: 0 } 100% { opacity: 1 }"
            rows={4}
            className={`${inputStyle} resize-y font-mono`}
            maxLength={4096}
            data-testid={`anim-${row.elementId}-${row.animPhase}-keyframes`}
          />
          <p className="text-[10px] italic text-[var(--chalk-3)]">
            Allowed props: opacity, transform, filter, letter-spacing, color,
            background-color, border-color, text-shadow, box-shadow. No url(),
            no @-rules.
          </p>
        </div>
      ) : null}
      <div className="flex items-center gap-2 pt-1">
        <PrimaryButton type="button" size="sm" disabled={pending} onClick={onSave}>
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
            checked={row.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]"
            data-testid={`anim-${row.elementId}-${row.animPhase}-enabled`}
          />
          Enabled
        </label>
      </div>
    </div>
  );
}
