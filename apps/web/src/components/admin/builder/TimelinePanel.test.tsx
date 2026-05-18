import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimelinePanel } from "./TimelinePanel";
import { useBuilderStore } from "@/state/builder/store";
import type { Design, Element } from "@/server/overlays/builder/types";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id: "el-1",
    sceneId: "s1",
    parentGroupId: null,
    elementType: "text",
    zIndex: 0,
    locked: false,
    visible: true,
    transform: {
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    },
    style: {},
    content: { text: "Hello world" },
    binding: null,
    animation: {},
    ...overrides,
  } as Element;
}

function makeDesign(element: Element): Design {
  return {
    id: "d1",
    slug: "t",
    title: "T",
    description: null,
    mode: "single",
    status: "draft",
    canvasWidth: 1920,
    canvasHeight: 1080,
    createdBy: "u1",
    scenes: [
      {
        id: "s1",
        designId: "d1",
        orderIndex: 0,
        name: null,
        durationMs: 5000,
        transitionIn: "fade",
        transitionOut: "fade",
        elements: [element],
      },
    ],
  } as Design;
}

function seed({
  open,
  selectedIds,
  element,
}: {
  open: boolean;
  selectedIds: string[];
  element: Element;
}) {
  useBuilderStore.setState({
    design: makeDesign(element),
    selectedElementIds: selectedIds,
    activeSceneId: "s1",
    zoomLevel: 1,
    dirty: false,
    timelinePanelOpen: open,
  });
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("TimelinePanel", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
    });
  });

  it("renders nothing when timelinePanelOpen is false", () => {
    seed({ open: false, selectedIds: ["el-1"], element: makeElement() });
    const { container } = render(<TimelinePanel />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("timeline-panel")).toBeNull();
  });

  it("renders nothing when no element is selected", () => {
    seed({ open: true, selectedIds: [], element: makeElement() });
    render(<TimelinePanel />);
    expect(screen.queryByTestId("timeline-panel")).toBeNull();
  });

  it("renders nothing when multiple elements are selected", () => {
    seed({ open: true, selectedIds: ["el-1", "el-2"], element: makeElement() });
    render(<TimelinePanel />);
    expect(screen.queryByTestId("timeline-panel")).toBeNull();
  });

  it("renders header with element title when open + single element selected", () => {
    seed({ open: true, selectedIds: ["el-1"], element: makeElement() });
    render(<TimelinePanel />);
    expect(screen.getByTestId("timeline-panel")).toBeTruthy();
    expect(screen.getByText(/timeline — hello world/i)).toBeTruthy();
  });

  it("falls back to elementType when content.text is missing", () => {
    seed({
      open: true,
      selectedIds: ["el-1"],
      element: makeElement({ elementType: "rect", content: {} }),
    });
    render(<TimelinePanel />);
    expect(screen.getByText(/timeline — rect/i)).toBeTruthy();
  });

  it("renders phase tabs for entry/exit/loop with entry selected by default", () => {
    seed({ open: true, selectedIds: ["el-1"], element: makeElement() });
    render(<TimelinePanel />);
    const entryTab = screen.getByRole("tab", { name: /entry/i });
    const exitTab = screen.getByRole("tab", { name: /exit/i });
    const loopTab = screen.getByRole("tab", { name: /loop/i });
    expect(entryTab.getAttribute("aria-selected")).toBe("true");
    expect(exitTab.getAttribute("aria-selected")).toBe("false");
    expect(loopTab.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking a phase tab updates aria-selected", () => {
    seed({ open: true, selectedIds: ["el-1"], element: makeElement() });
    render(<TimelinePanel />);
    fireEvent.click(screen.getByRole("tab", { name: /exit/i }));
    expect(
      screen.getByRole("tab", { name: /exit/i }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: /entry/i }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("close button flips timelinePanelOpen back to false", () => {
    seed({ open: true, selectedIds: ["el-1"], element: makeElement() });
    render(<TimelinePanel />);
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(false);
  });

  it("shows preset placeholder when current phase has no advancedTimeline", () => {
    seed({
      open: true,
      selectedIds: ["el-1"],
      element: makeElement({
        animation: {
          entry: {
            type: "fade",
            durationMs: 400,
            delayMs: 0,
            easing: "ease-out",
          },
        },
      }),
    });
    render(<TimelinePanel />);
    expect(screen.getByTestId("timeline-panel-placeholder-preset")).toBeTruthy();
    expect(screen.queryByTestId("timeline-panel-placeholder-advanced")).toBeNull();
  });

  it("shows advanced placeholder when current phase has advancedTimeline keyframes", () => {
    seed({
      open: true,
      selectedIds: ["el-1"],
      element: makeElement({
        animation: {
          entry: {
            type: "fade",
            durationMs: 400,
            delayMs: 0,
            easing: "ease-out",
            advancedTimeline: [
              {
                property: "opacity",
                keyframes: [
                  { id: "k1", timeMs: 0, value: 0, easingOut: null },
                  { id: "k2", timeMs: 400, value: 1, easingOut: null },
                ],
              },
            ],
          },
        },
      }),
    });
    render(<TimelinePanel />);
    expect(screen.getByTestId("timeline-panel-placeholder-advanced")).toBeTruthy();
    expect(screen.queryByTestId("timeline-panel-placeholder-preset")).toBeNull();
  });

  it("phase tab switch swaps preset vs advanced placeholder body", () => {
    seed({
      open: true,
      selectedIds: ["el-1"],
      element: makeElement({
        animation: {
          entry: {
            type: "fade",
            durationMs: 400,
            delayMs: 0,
            easing: "ease-out",
          },
          exit: {
            type: "fade",
            durationMs: 400,
            delayMs: 0,
            easing: "ease-out",
            advancedTimeline: [
              {
                property: "opacity",
                keyframes: [
                  { id: "k1", timeMs: 0, value: 1, easingOut: null },
                  { id: "k2", timeMs: 400, value: 0, easingOut: null },
                ],
              },
            ],
          },
        },
      }),
    });
    render(<TimelinePanel />);
    // entry phase: preset placeholder
    expect(screen.getByTestId("timeline-panel-placeholder-preset")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /exit/i }));
    // exit phase: advanced placeholder
    expect(screen.getByTestId("timeline-panel-placeholder-advanced")).toBeTruthy();
  });
});
