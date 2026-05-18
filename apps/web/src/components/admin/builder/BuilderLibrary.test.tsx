import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BuilderLibrary, hasAdvancedTimeline } from "./BuilderLibrary";
import type { Design, Element, Scene } from "@/server/overlays/builder/types";

const designs: Design[] = [
  {
    id: "d1",
    slug: "scoreboard",
    title: "Scoreboard",
    mode: "single",
    status: "published",
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-15T12:00:00Z",
    scenes: [],
  } as Design,
  {
    id: "d2",
    slug: "intro",
    title: "Intro Sequence",
    mode: "sequence",
    status: "draft",
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-14T12:00:00Z",
    scenes: [],
  } as Design,
  {
    id: "d3",
    slug: "outro",
    title: "Outro",
    mode: "single",
    status: "draft",
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-13T12:00:00Z",
    scenes: [],
  } as Design,
];

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// createDesignAction accepts FormData — mock returns { id, slug }
const createDesignActionMock = vi.fn();
const softDeleteDesignActionMock = vi.fn();
vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
  createDesignAction: (...args: unknown[]) => createDesignActionMock(...args),
  softDeleteDesignAction: (...args: unknown[]) => softDeleteDesignActionMock(...args),
}));

describe("BuilderLibrary", () => {
  it("renders one card per design with title + status badge", () => {
    render(<BuilderLibrary designs={designs} />);
    expect(screen.getByText("Scoreboard")).toBeTruthy();
    expect(screen.getByText("Intro Sequence")).toBeTruthy();
    expect(screen.getByText("Outro")).toBeTruthy();
    expect(screen.getAllByText(/draft/i)).toHaveLength(2);
    expect(screen.getAllByText(/published/i)).toHaveLength(1);
  });

  it("clicking New Design opens the modal", () => {
    render(<BuilderLibrary designs={designs} />);
    fireEvent.click(screen.getByRole("button", { name: /new design/i }));
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Single")).toBeTruthy();
    expect(screen.getByLabelText("Sequence")).toBeTruthy();
  });

  it("submitting modal calls createDesignAction then pushes to edit route", async () => {
    createDesignActionMock.mockResolvedValueOnce({ id: "new-id", slug: "brand-new" });
    render(<BuilderLibrary designs={designs} />);
    fireEvent.click(screen.getByRole("button", { name: /new design/i }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Brand New" },
    });
    fireEvent.click(screen.getByLabelText("Sequence"));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(createDesignActionMock).toHaveBeenCalled();
      // action receives FormData — verify slug-based redirect
      expect(pushMock).toHaveBeenCalledWith(
        "/admin/broadcast/v2/builder/brand-new/edit",
      );
    });
  });
});

// ────────── Wave 3B Task 16 — Animations: advanced badge ──────────

function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id: "el-1",
    sceneId: "sc-1",
    parentGroupId: null,
    elementType: "rect",
    zIndex: 0,
    locked: false,
    visible: true,
    transform: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    },
    style: {},
    content: {},
    binding: null,
    animation: {},
    ...overrides,
  } as Element;
}

function makeScene(elements: Element[]): Scene {
  return {
    id: "sc-1",
    designId: "d-adv",
    orderIndex: 0,
    name: null,
    durationMs: 5000,
    transitionIn: "none",
    transitionOut: "none",
    elements,
  };
}

const sceneNoAdvanced: Scene = makeScene([
  makeElement({
    animation: {
      entry: {
        type: "fade",
        durationMs: 400,
        delayMs: 0,
        easing: "ease-out",
      },
    },
  }),
]);

const sceneWithAdvanced: Scene = makeScene([
  makeElement({
    id: "el-adv",
    animation: {
      entry: {
        type: "noop",
        durationMs: 1000,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 1000, value: 1, easingOut: null },
            ],
          },
        ],
      },
    },
  }),
]);

describe("hasAdvancedTimeline", () => {
  it("returns false when scenes are undefined", () => {
    expect(hasAdvancedTimeline(undefined)).toBe(false);
  });

  it("returns false when no element has a non-empty advancedTimeline", () => {
    expect(hasAdvancedTimeline([sceneNoAdvanced])).toBe(false);
  });

  it("returns false when advancedTimeline is an empty array", () => {
    const sc = makeScene([
      makeElement({
        animation: {
          entry: {
            type: "noop",
            durationMs: 0,
            delayMs: 0,
            easing: "linear",
            advancedTimeline: [],
          },
        },
      }),
    ]);
    expect(hasAdvancedTimeline([sc])).toBe(false);
  });

  it("returns true when entry phase carries advancedTimeline", () => {
    expect(hasAdvancedTimeline([sceneWithAdvanced])).toBe(true);
  });

  it("returns true when exit phase carries advancedTimeline", () => {
    const sc = makeScene([
      makeElement({
        animation: {
          exit: {
            type: "noop",
            durationMs: 1000,
            delayMs: 0,
            easing: "linear",
            advancedTimeline: [
              {
                property: "x",
                keyframes: [
                  { id: "k1", timeMs: 0, value: 0, easingOut: null },
                  { id: "k2", timeMs: 1000, value: 200, easingOut: null },
                ],
              },
            ],
          },
        },
      }),
    ]);
    expect(hasAdvancedTimeline([sc])).toBe(true);
  });

  it("returns true when loop phase carries advancedTimeline", () => {
    const sc = makeScene([
      makeElement({
        animation: {
          loop: {
            type: "noop",
            durationMs: 1000,
            delayMs: 0,
            easing: "linear",
            advancedTimeline: [
              {
                property: "scaleX",
                keyframes: [
                  { id: "k1", timeMs: 0, value: 1, easingOut: null },
                  { id: "k2", timeMs: 1000, value: 1.2, easingOut: null },
                ],
              },
            ],
          },
        },
      }),
    ]);
    expect(hasAdvancedTimeline([sc])).toBe(true);
  });
});

describe("BuilderLibrary — Animations: advanced badge", () => {
  const advancedDesign = {
    id: "d-adv",
    slug: "advanced",
    title: "Advanced Design",
    mode: "single" as const,
    status: "draft" as const,
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-17T12:00:00Z",
    scenes: [sceneWithAdvanced],
  } as unknown as Design;

  const plainDesign = {
    id: "d-plain",
    slug: "plain",
    title: "Plain Design",
    mode: "single" as const,
    status: "draft" as const,
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-17T12:00:00Z",
    scenes: [sceneNoAdvanced],
  } as unknown as Design;

  it("renders the advanced badge for designs with advancedTimeline tracks", () => {
    render(<BuilderLibrary designs={[advancedDesign]} />);
    const badges = screen.getAllByTestId("advanced-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent(/animations: advanced/i);
  });

  it("hides the advanced badge for designs without advancedTimeline tracks", () => {
    render(<BuilderLibrary designs={[plainDesign]} />);
    expect(screen.queryByTestId("advanced-badge")).toBeNull();
  });

  it("hides the advanced badge for plain DesignSummary (no scenes field)", () => {
    render(<BuilderLibrary designs={designs} />);
    expect(screen.queryByTestId("advanced-badge")).toBeNull();
  });

  it("renders the badge only on cards that carry an advancedTimeline", () => {
    render(<BuilderLibrary designs={[advancedDesign, plainDesign]} />);
    expect(screen.getAllByTestId("advanced-badge")).toHaveLength(1);
  });
});
