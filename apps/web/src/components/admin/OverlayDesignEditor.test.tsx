import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import OverlayDesignEditor, {
  type CatalogEntry,
  type PartnerLogoRow,
  type PartnerStripLayoutRow,
  type TextElementRow,
  type AnimationRow,
} from "./OverlayDesignEditor";

/**
 * Wave 2 Stage 2 — `OverlayDesignEditor` Text section tests.
 *
 * Covers:
 *   1. Renders a Text panel + per-row form when `initialTextElements`
 *      is supplied.
 *   2. Hides the Text panel when no text elements arrive (back-compat:
 *      Phase A callers don't break).
 *   3. The save button calls `setTextElementAction` with the right
 *      FormData payload.
 *   4. Reset calls `clearTextElementAction`.
 *
 * The action mocks return resolved promises — this test layer locks
 * the form-wiring contract, not the server behaviour.
 */

const setTextElementMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const clearTextElementMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const saveTokensMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const uploadOverlayBgMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, url: "/x.png" }),
);
const setStripLayoutMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const uploadPartnerLogoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    partnerKey: "newpartner",
    fileUrl: "https://supabase.local/x.png",
  }),
);
const removePartnerLogoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const setLogoOverrideMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

const setAnimationMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const clearAnimationMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("@/app/admin/broadcast/v2/design/actions", () => ({
  saveTokensAction: saveTokensMock,
  uploadOverlayBgAction: uploadOverlayBgMock,
  setTextElementAction: setTextElementMock,
  clearTextElementAction: clearTextElementMock,
  setStripLayoutAction: setStripLayoutMock,
  uploadPartnerLogoAction: uploadPartnerLogoMock,
  removePartnerLogoAction: removePartnerLogoMock,
  setLogoOverrideAction: setLogoOverrideMock,
  setAnimationAction: setAnimationMock,
  clearAnimationAction: clearAnimationMock,
}));

const CATALOG: CatalogEntry[] = [
  { tokenKey: "bg-color", tokenType: "color", label: "Background" },
];

const FONT_OPTS = ["Agharti", "Quedora", "Inter", "JetBrains Mono"] as const;

function mkRow(overrides: Partial<TextElementRow> = {}): TextElementRow {
  return {
    elementId: "title",
    origin: "seed",
    kind: "title",
    displayLabel: null,
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
    ...overrides,
  };
}

beforeEach(() => {
  setTextElementMock.mockClear();
  clearTextElementMock.mockClear();
  saveTokensMock.mockClear();
  setStripLayoutMock.mockClear();
  uploadPartnerLogoMock.mockClear();
  removePartnerLogoMock.mockClear();
  setLogoOverrideMock.mockClear();
  setAnimationMock.mockClear();
  clearAnimationMock.mockClear();
});

afterEach(() => cleanup());

describe("OverlayDesignEditor — Text section (Wave 2 Stage 2)", () => {
  it("renders a Text panel when initialTextElements is non-empty", () => {
    render(
      <OverlayDesignEditor
        overlayKey="07-leaderboard"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
      />,
    );
    expect(screen.getByTestId("overlay-design-text-panel")).toBeTruthy();
    expect(screen.getByTestId("text-row-title")).toBeTruthy();
  });

  it("hides the Text panel when no text elements arrive (backward compat)", () => {
    render(
      <OverlayDesignEditor
        overlayKey="07-leaderboard"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
      />,
    );
    expect(screen.queryByTestId("overlay-design-text-panel")).toBeNull();
  });

  it("renders one summary entry per text row", () => {
    render(
      <OverlayDesignEditor
        overlayKey="07-leaderboard"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({ elementId: "title" }),
          mkRow({ elementId: "eyebrow", kind: "eyebrow" }),
          mkRow({ elementId: "subtitle", kind: "subtitle" }),
        ]}
      />,
    );
    expect(screen.getByTestId("text-row-title")).toBeTruthy();
    expect(screen.getByTestId("text-row-eyebrow")).toBeTruthy();
    expect(screen.getByTestId("text-row-subtitle")).toBeTruthy();
  });

  it("typing in content updates the input value", () => {
    render(
      <OverlayDesignEditor
        overlayKey="07-leaderboard"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
      />,
    );
    const input = screen.getByTestId("text-row-title-content") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "GAME ON" } });
    expect(input.value).toBe("GAME ON");
  });

  it("clicking Save calls setTextElementAction with the row's FormData", () => {
    render(
      <OverlayDesignEditor
        overlayKey="07-leaderboard"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "title",
            content: "GAME ON",
            color: "#fe036d",
          }),
        ]}
      />,
    );
    // Find the row's Save button by climbing up from the testid container.
    const row = screen.getByTestId("text-row-title");
    const saveBtn = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Save",
    ) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn);
    expect(setTextElementMock).toHaveBeenCalledTimes(1);
    const fd = setTextElementMock.mock.calls[0][0] as FormData;
    expect(fd.get("overlayKey")).toBe("07-leaderboard");
    expect(fd.get("elementId")).toBe("title");
    expect(fd.get("content")).toBe("GAME ON");
    expect(fd.get("color")).toBe("#fe036d");
  });

  it("clicking Reset calls clearTextElementAction", () => {
    render(
      <OverlayDesignEditor
        overlayKey="07-leaderboard"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "title",
            content: "GAME ON",
            color: "#fe036d",
          }),
        ]}
      />,
    );
    const row = screen.getByTestId("text-row-title");
    const resetBtn = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Reset",
    ) as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    fireEvent.click(resetBtn);
    expect(clearTextElementMock).toHaveBeenCalledTimes(1);
    const fd = clearTextElementMock.mock.calls[0][0] as FormData;
    expect(fd.get("elementId")).toBe("title");
  });
});

/* ------------------------------------------------------------------ *
 * Universal element labels (post-2026-04-28)                         *
 * Migration: 20260620000010_overlay_text_elements_kind.sql           *
 * ------------------------------------------------------------------ */

describe("OverlayDesignEditor — universal element labels", () => {
  it("renders kind label + display label + element id in row header", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "title",
            kind: "heading",
            displayLabel: "BRB Title",
          }),
        ]}
      />,
    );
    const kindBadge = screen.getByTestId("text-row-title-kind-label");
    expect(kindBadge.textContent).toBe("Heading");
    const displayLabel = screen.getByTestId("text-row-title-display-label");
    expect(displayLabel.textContent).toBe("BRB Title");
    // Original element-id still present (mono small) so admins can copy
    // it when authoring custom CSS / animation hooks.
    const row = screen.getByTestId("text-row-title");
    expect(row.textContent).toMatch(/title/);
  });

  it("falls back to prettyId(elementId) when displayLabel is null", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "season-mark",
            kind: "caption",
            displayLabel: null,
          }),
        ]}
      />,
    );
    const displayLabel = screen.getByTestId(
      "text-row-season-mark-display-label",
    );
    expect(displayLabel.textContent).toBe("Season Mark");
  });

  it("renders semantic kind labels for new enum values", () => {
    render(
      <OverlayDesignEditor
        overlayKey="04-h2h-2"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "player-1-photo",
            kind: "player-photo",
            displayLabel: "Player A Photo",
          }),
          mkRow({
            elementId: "partners-strip",
            kind: "partner-strip-container",
            displayLabel: "Partners Strip",
          }),
          mkRow({
            elementId: "home-score",
            kind: "score-number",
            displayLabel: "Home Score",
          }),
        ]}
      />,
    );
    expect(
      screen.getByTestId("text-row-player-1-photo-kind-label").textContent,
    ).toBe("Photo");
    expect(
      screen.getByTestId("text-row-partners-strip-kind-label").textContent,
    ).toBe("Partner Strip");
    expect(
      screen.getByTestId("text-row-home-score-kind-label").textContent,
    ).toBe("Score");
  });

  it("hides the Content input for image-like kinds", () => {
    render(
      <OverlayDesignEditor
        overlayKey="04-h2h-2"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "player-1-photo",
            kind: "player-photo",
            displayLabel: "Player A Photo",
          }),
        ]}
      />,
    );
    expect(
      screen.queryByTestId("text-row-player-1-photo-content"),
    ).toBeNull();
  });

  it("Save passes displayLabel through FormData when present", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "title",
            kind: "heading",
            displayLabel: "BRB Title",
            content: "BACK SOON",
          }),
        ]}
      />,
    );
    const row = screen.getByTestId("text-row-title");
    const saveBtn = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Save",
    ) as HTMLButtonElement;
    fireEvent.click(saveBtn);
    expect(setTextElementMock).toHaveBeenCalledTimes(1);
    const fd = setTextElementMock.mock.calls[0][0] as FormData;
    expect(fd.get("displayLabel")).toBe("BRB Title");
    expect(fd.get("kind")).toBe("heading");
  });
});

describe("OverlayDesignEditor — Partners panel display labels", () => {
  it("renders sponsor kind badge + display label in partner-roster row", () => {
    const logo: PartnerLogoRow = {
      partnerKey: "gameevo",
      label: "GameEvo",
      alt: "GameEvo Esports",
      displayLabel: "GameEvo Sponsor Logo",
      fileUrl: "/x/gameevo.png",
      sortOrder: 0,
      dimensionWPx: 600,
      dimensionHPx: 300,
    };
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[logo]}
        initialLogoOverrides={[]}
      />,
    );
    expect(
      screen.getByTestId("partner-logo-gameevo-kind-label").textContent,
    ).toBe("Sponsor (Strip)");
    expect(
      screen.getByTestId("partner-logo-gameevo-display-label").textContent,
    ).toBe("GameEvo Sponsor Logo");
  });

  it("falls back to label then alt when displayLabel is null", () => {
    const logo: PartnerLogoRow = {
      partnerKey: "fallback",
      label: "Fallback Label",
      alt: "Alt only",
      displayLabel: null,
      fileUrl: "/x/fallback.png",
      sortOrder: 0,
      dimensionWPx: 600,
      dimensionHPx: 300,
    };
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[logo]}
        initialLogoOverrides={[]}
      />,
    );
    expect(
      screen.getByTestId("partner-logo-fallback-display-label").textContent,
    ).toBe("Fallback Label");
  });
});

describe("OverlayDesignEditor — Animations panel display labels", () => {
  it("renders kind + display label + id in animation-element row header", () => {
    render(
      <OverlayDesignEditor
        overlayKey="04-h2h-2"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={[
          {
            elementId: "player-1-photo",
            kind: "player-photo",
            displayLabel: "Player A Photo",
          },
        ]}
        initialAnimations={[]}
      />,
    );
    expect(
      screen.getByTestId("anim-element-player-1-photo-kind-label").textContent,
    ).toBe("Photo");
    expect(
      screen.getByTestId("anim-element-player-1-photo-display-label").textContent,
    ).toBe("Player A Photo");
  });
});

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 3 — Partners panel                                    *
 * ------------------------------------------------------------------ */

const SAMPLE_LAYOUT: PartnerStripLayoutRow = {
  visible: true,
  positionXPx: 0,
  positionYPx: 1020,
  anchor: "bottom-center",
  orientation: "horizontal",
  scalePct: 100,
  itemSpacingPx: 64,
  justification: "center",
  zIndex: 12,
};

const SAMPLE_LOGO: PartnerLogoRow = {
  partnerKey: "gameevo",
  label: "GameEvo",
  alt: "GameEvo Esports",
  fileUrl: "/logos/gameevo.png",
  sortOrder: 0,
  dimensionWPx: 600,
  dimensionHPx: 300,
};

describe("OverlayDesignEditor — Partners panel (Wave 2 Stage 3)", () => {
  it("renders the Partners panel with strip layout + roster", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[SAMPLE_LOGO]}
        initialLogoOverrides={[]}
      />,
    );
    expect(screen.getByTestId("overlay-design-partners-panel")).toBeTruthy();
    expect(screen.getByTestId("overlay-design-partners-layout")).toBeTruthy();
    expect(screen.getByTestId("overlay-design-partners-roster")).toBeTruthy();
    expect(screen.getByTestId("partner-logo-gameevo")).toBeTruthy();
  });

  it("falls back to default layout when initialStripLayout is null", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={null}
        initialPartnerLogos={[]}
      />,
    );
    const anchor = screen.getByTestId(
      "strip-layout-anchor",
    ) as HTMLSelectElement;
    expect(anchor.value).toBe("bottom-center");
    const scale = screen.getByTestId(
      "strip-layout-scale",
    ) as HTMLInputElement;
    expect(scale.value).toBe("100");
  });

  it("changing layout fields updates inputs", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[]}
      />,
    );
    const anchor = screen.getByTestId(
      "strip-layout-anchor",
    ) as HTMLSelectElement;
    fireEvent.change(anchor, { target: { value: "top-right" } });
    expect(anchor.value).toBe("top-right");
    const scale = screen.getByTestId(
      "strip-layout-scale",
    ) as HTMLInputElement;
    fireEvent.change(scale, { target: { value: "150" } });
    expect(scale.value).toBe("150");
  });

  it("Save layout calls setStripLayoutAction with the FormData", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[]}
      />,
    );
    const anchor = screen.getByTestId(
      "strip-layout-anchor",
    ) as HTMLSelectElement;
    fireEvent.change(anchor, { target: { value: "top-right" } });
    const saveBtn = screen.getByTestId("strip-layout-save");
    fireEvent.click(saveBtn);
    expect(setStripLayoutMock).toHaveBeenCalledTimes(1);
    const fd = setStripLayoutMock.mock.calls[0][0] as FormData;
    expect(fd.get("overlayKey")).toBe("01-brb");
    expect(fd.get("anchor")).toBe("top-right");
    expect(fd.get("scalePct")).toBe("100");
  });

  it("toggling per-overlay enable calls setLogoOverrideAction", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[SAMPLE_LOGO]}
        initialLogoOverrides={[]}
      />,
    );
    const toggle = screen.getByTestId(
      "partner-logo-gameevo-enabled",
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(setLogoOverrideMock).toHaveBeenCalledTimes(1);
    const fd = setLogoOverrideMock.mock.calls[0][0] as FormData;
    expect(fd.get("partnerKey")).toBe("gameevo");
    expect(fd.get("visible")).toBe("false");
  });

  it("Remove button calls removePartnerLogoAction", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[SAMPLE_LOGO]}
      />,
    );
    const removeBtn = screen.getByTestId(
      "partner-logo-gameevo-remove",
    );
    fireEvent.click(removeBtn);
    expect(removePartnerLogoMock).toHaveBeenCalledTimes(1);
    const fd = removePartnerLogoMock.mock.calls[0][0] as FormData;
    expect(fd.get("partnerKey")).toBe("gameevo");
  });

  it("uploader rejects empty file selection", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("partner-uploader-upload"));
    expect(uploadPartnerLogoMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("partner-uploader-error").textContent).toMatch(
      /Select a file/i,
    );
  });

  it("uploader requires partnerKey + label + alt before uploading", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[]}
      />,
    );
    const fileInput = screen.getByTestId(
      "partner-uploader-file",
    ) as HTMLInputElement;
    const file = new File([new Uint8Array(100)], "logo.png", {
      type: "image/png",
    });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);
    fireEvent.click(screen.getByTestId("partner-uploader-upload"));
    expect(uploadPartnerLogoMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("partner-uploader-error").textContent).toMatch(
      /required/i,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 4 — Animations panel                                  *
 * ------------------------------------------------------------------ */

const ELEMENTS_FIXTURE = [
  { elementId: "title", kind: "title" },
  { elementId: "subtitle", kind: "subtitle" },
];

const SAMPLE_ANIMATION: AnimationRow = {
  elementId: "title",
  animPhase: "entry",
  enabled: true,
  animType: "slide-left",
  durationMs: 420,
  delayMs: 60,
  easing: "ease-out",
  iterationCount: "1",
  customCssKeyframes: null,
};

describe("OverlayDesignEditor — Animations panel (Wave 2 Stage 4)", () => {
  it("renders the Animations panel when animatableElements are supplied", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    expect(screen.getByTestId("overlay-design-animations-panel")).toBeTruthy();
    expect(screen.getByTestId("anim-element-title")).toBeTruthy();
    expect(screen.getByTestId("anim-element-subtitle")).toBeTruthy();
  });

  it("shows a placeholder when no animatable elements are registered", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={[]}
        initialAnimations={[]}
      />,
    );
    const panel = screen.getByTestId("overlay-design-animations-panel");
    expect(panel.textContent).toMatch(/No animatable elements/i);
  });

  it("renders three phase tabs per element (entry, exit, continuous)", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    expect(screen.getByTestId("anim-phase-title-entry")).toBeTruthy();
    expect(screen.getByTestId("anim-phase-title-exit")).toBeTruthy();
    expect(screen.getByTestId("anim-phase-title-continuous")).toBeTruthy();
  });

  it("clicking phase tab switches the editor inputs", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    // Default phase = entry, find entry duration input.
    expect(screen.getByTestId("anim-title-entry-duration")).toBeTruthy();
    fireEvent.click(screen.getByTestId("anim-phase-title-continuous"));
    expect(screen.getByTestId("anim-title-continuous-duration")).toBeTruthy();
  });

  it("changing animType updates the selected phase row", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    const typeSelect = screen.getByTestId(
      "anim-title-entry-type",
    ) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "slide-left" } });
    expect(typeSelect.value).toBe("slide-left");
  });

  it("custom-css textarea appears only when animType=custom-css", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    expect(
      screen.queryByTestId("anim-title-entry-keyframes"),
    ).toBeNull();
    const typeSelect = screen.getByTestId(
      "anim-title-entry-type",
    ) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "custom-css" } });
    expect(screen.getByTestId("anim-title-entry-keyframes")).toBeTruthy();
  });

  it("Save calls setAnimationAction with full FormData", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[SAMPLE_ANIMATION]}
      />,
    );
    const row = screen.getByTestId("anim-element-title");
    const saveBtn = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Save",
    ) as HTMLButtonElement;
    fireEvent.click(saveBtn);
    expect(setAnimationMock).toHaveBeenCalledTimes(1);
    const fd = setAnimationMock.mock.calls[0][0] as FormData;
    expect(fd.get("overlayKey")).toBe("01-brb");
    expect(fd.get("elementId")).toBe("title");
    expect(fd.get("animPhase")).toBe("entry");
    expect(fd.get("animType")).toBe("slide-left");
    expect(fd.get("enabled")).toBe("true");
  });

  it("Reset calls clearAnimationAction", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[SAMPLE_ANIMATION]}
      />,
    );
    const row = screen.getByTestId("anim-element-title");
    const resetBtn = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Reset",
    ) as HTMLButtonElement;
    fireEvent.click(resetBtn);
    expect(clearAnimationMock).toHaveBeenCalledTimes(1);
    const fd = clearAnimationMock.mock.calls[0][0] as FormData;
    expect(fd.get("elementId")).toBe("title");
    expect(fd.get("animPhase")).toBe("entry");
  });

  it("seeds rows for elements with no DB animation yet", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    // Subtitle has no DB row, panel should still expose its tabs.
    expect(screen.getByTestId("anim-phase-subtitle-entry")).toBeTruthy();
    expect(screen.getByTestId("anim-subtitle-entry-type")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * 2026-04-28 UX overhaul — accordion + filter + sticky preview       *
 * ------------------------------------------------------------------ */

describe("OverlayDesignEditor — UX overhaul (2026-04-28)", () => {
  // jsdom 29 in vitest 4 ships a non-spec localStorage implementation
  // (clear/key methods missing). Replace it with an in-memory shim
  // before each accordion-persistence test so the hook can read +
  // write without hitting "getItem is not a function".
  beforeEach(() => {
    const store = new Map<string, string>();
    const shim: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k) ?? null : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: shim,
    });
  });

  it("renders the accordion with section toggles + counts", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
        initialStripLayout={SAMPLE_LAYOUT}
        initialPartnerLogos={[SAMPLE_LOGO]}
        animatableElements={ELEMENTS_FIXTURE}
        initialAnimations={[]}
      />,
    );
    expect(screen.getByTestId("overlay-design-accordion")).toBeTruthy();
    expect(
      screen.getByTestId("overlay-design-section-toggle-text"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("overlay-design-section-toggle-partners"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("overlay-design-section-toggle-animations"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("overlay-design-section-toggle-tokens"),
    ).toBeTruthy();
  });

  it("opens Text section first when text elements exist", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
      />,
    );
    const textPane = screen.getByTestId("overlay-design-text-panel");
    expect(textPane.getAttribute("data-pane-state")).toBe("open");
  });

  it("opens Tokens section by default when no text elements supplied", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
      />,
    );
    const tokensPane = screen.getByTestId("overlay-design-tokens-pane");
    expect(tokensPane.getAttribute("data-pane-state")).toBe("open");
  });

  it("clicking a section toggle switches the open pane", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
      />,
    );
    fireEvent.click(
      screen.getByTestId("overlay-design-section-toggle-tokens"),
    );
    const tokensPane = screen.getByTestId("overlay-design-tokens-pane");
    expect(tokensPane.getAttribute("data-pane-state")).toBe("open");
    const textPane = screen.getByTestId("overlay-design-text-panel");
    expect(textPane.getAttribute("data-pane-state")).toBe("closed");
  });

  it("persists the open section across re-renders via localStorage", () => {
    const { unmount } = render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
      />,
    );
    fireEvent.click(
      screen.getByTestId("overlay-design-section-toggle-partners"),
    );
    expect(
      window.localStorage.getItem("overlayDesign:openSection:01-brb"),
    ).toBe("partners");
    unmount();
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[mkRow({ elementId: "title" })]}
      />,
    );
    const partnersPane = screen.getByTestId("overlay-design-partners-pane");
    expect(partnersPane.getAttribute("data-pane-state")).toBe("open");
  });

  it("renders the sticky preview aside on every layout", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
      />,
    );
    const aside = screen.getByTestId("overlay-design-preview-aside");
    expect(aside.className).toMatch(/lg:sticky/);
    expect(screen.getByTestId("overlay-design-preview-iframe")).toBeTruthy();
  });

  it("renders summary stat tiles next to the preview", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({ elementId: "title" }),
          mkRow({ elementId: "subtitle", kind: "subtitle" }),
        ]}
        initialPartnerLogos={[SAMPLE_LOGO]}
      />,
    );
    expect(screen.getByTestId("overlay-design-summary-stats")).toBeTruthy();
  });

  it("filters text rows by display label", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({
            elementId: "title",
            kind: "heading",
            displayLabel: "BRB Title",
          }),
          mkRow({
            elementId: "subtitle",
            kind: "subheading",
            displayLabel: "BRB Subtitle",
          }),
          mkRow({
            elementId: "footer",
            kind: "caption",
            displayLabel: "Footer Note",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("text-row-title")).toBeTruthy();
    expect(screen.getByTestId("text-row-subtitle")).toBeTruthy();
    expect(screen.getByTestId("text-row-footer")).toBeTruthy();

    const filter = screen.getByTestId(
      "overlay-design-text-filter",
    ) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "BRB" } });
    expect(screen.getByTestId("text-row-title")).toBeTruthy();
    expect(screen.getByTestId("text-row-subtitle")).toBeTruthy();
    expect(screen.queryByTestId("text-row-footer")).toBeNull();
  });

  it("groups text rows by kind in the rendered list", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({ elementId: "title-a", kind: "heading" }),
          mkRow({ elementId: "title-b", kind: "heading" }),
          mkRow({ elementId: "caption-a", kind: "caption" }),
        ]}
      />,
    );
    expect(
      screen.getByTestId("overlay-design-text-group-heading"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("overlay-design-text-group-caption"),
    ).toBeTruthy();
  });

  it("clears the text filter via the × clear button", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        initialTextElements={[
          mkRow({ elementId: "title", displayLabel: "BRB Title" }),
        ]}
      />,
    );
    const filter = screen.getByTestId(
      "overlay-design-text-filter",
    ) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "Z" } });
    expect(filter.value).toBe("Z");
    const clearBtn = screen.getByTestId("overlay-design-text-filter-clear");
    fireEvent.click(clearBtn);
    expect(filter.value).toBe("");
  });

  it("filters animations by display label", () => {
    render(
      <OverlayDesignEditor
        overlayKey="01-brb"
        variantId="default"
        initialTokens={{}}
        catalog={CATALOG}
        fontOptions={FONT_OPTS}
        patternOptions={[]}
        animatableElements={[
          { elementId: "title", kind: "title", displayLabel: "BRB Title" },
          { elementId: "footer", kind: "caption", displayLabel: "Footer" },
        ]}
        initialAnimations={[]}
      />,
    );
    fireEvent.click(
      screen.getByTestId("overlay-design-section-toggle-animations"),
    );
    const filter = screen.getByTestId(
      "overlay-design-anim-filter",
    ) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "BRB" } });
    expect(screen.getByTestId("anim-element-title")).toBeTruthy();
    expect(screen.queryByTestId("anim-element-footer")).toBeNull();
  });
});
