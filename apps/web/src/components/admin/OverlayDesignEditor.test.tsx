import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import OverlayDesignEditor, {
  type CatalogEntry,
  type TextElementRow,
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

vi.mock("@/app/admin/broadcast/v2/design/actions", () => ({
  saveTokensAction: saveTokensMock,
  uploadOverlayBgAction: uploadOverlayBgMock,
  setTextElementAction: setTextElementMock,
  clearTextElementAction: clearTextElementMock,
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
