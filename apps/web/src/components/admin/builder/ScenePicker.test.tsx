/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScenePicker } from "./ScenePicker";
import { useBuilderStore } from "@/state/builder/store";

const addSceneActionMock = vi.fn();
const deleteSceneActionMock = vi.fn();
const reorderScenesActionMock = vi.fn();
const cloneSceneActionMock = vi.fn();
vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
  addSceneAction: (...args: unknown[]) => addSceneActionMock(...args),
  deleteSceneAction: (...args: unknown[]) => deleteSceneActionMock(...args),
  reorderScenesAction: (...args: unknown[]) => reorderScenesActionMock(...args),
  cloneSceneAction: (...args: unknown[]) => cloneSceneActionMock(...args),
  saveDesignAction: vi.fn(),
  publishDesignAction: vi.fn(),
  updateDesignMetaAction: vi.fn(),
  updateSceneAction: vi.fn(),
}));

function seedDesign(mode: "single" | "sequence", sceneCount: number) {
  useBuilderStore.setState({
    design: {
      id: "d1",
      slug: "test",
      title: "Test",
      mode,
      status: "draft",
      canvasWidth: 1920,
      canvasHeight: 1080,
      scenes: Array.from({ length: sceneCount }, (_, i) => ({
        id: `s${i + 1}`,
        designId: "d1",
        orderIndex: i,
        name: i === 0 ? "intro" : null,
        durationMs: 5000,
        transitionIn: "fade" as const,
        transitionOut: "fade" as const,
        elements: [],
      })),
    },
    selectedElementIds: [],
    activeSceneId: "s1",
    zoomLevel: 1,
    dirty: false,
  } as never);
}

describe("ScenePicker", () => {
  beforeEach(() => {
    addSceneActionMock.mockReset().mockResolvedValue({ ok: true, scene: { id: "s-new", designId: "d1", orderIndex: 99, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] } });
    deleteSceneActionMock.mockReset().mockResolvedValue({ ok: true });
    reorderScenesActionMock.mockReset().mockResolvedValue({ ok: true });
    cloneSceneActionMock.mockReset().mockResolvedValue({ ok: true, scene: { id: "s-clone", designId: "d1", orderIndex: 99, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] } });
  });

  it("renders nothing when design.mode is 'single'", () => {
    seedDesign("single", 1);
    const { container } = render(<ScenePicker />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one tile per scene plus an Add tile when mode is 'sequence'", () => {
    seedDesign("sequence", 3);
    render(<ScenePicker />);
    expect(screen.getAllByTestId(/^scene-tile-s\d/)).toHaveLength(3);
    expect(screen.getByTestId("scene-tile-add")).toBeInTheDocument();
  });

  it("highlights the active scene tile", () => {
    seedDesign("sequence", 3);
    render(<ScenePicker />);
    const tile = screen.getByTestId("scene-tile-s1");
    expect(tile.getAttribute("data-active")).toBe("true");
  });

  it("clicking a tile calls setActiveScene", () => {
    seedDesign("sequence", 3);
    render(<ScenePicker />);
    fireEvent.click(screen.getByTestId("scene-tile-s2"));
    expect(useBuilderStore.getState().activeSceneId).toBe("s2");
  });

  it("clicking Add invokes addSceneAction with afterOrderIndex = last", async () => {
    seedDesign("sequence", 2);
    render(<ScenePicker />);
    fireEvent.click(screen.getByTestId("scene-tile-add"));
    await Promise.resolve();
    expect(addSceneActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "d1",
        designSlug: "test",
        afterOrderIndex: 1,
      }),
    );
  });

  it("displays scene name and duration on the tile", () => {
    seedDesign("sequence", 1);
    render(<ScenePicker />);
    const tile = screen.getByTestId("scene-tile-s1");
    expect(tile.textContent).toMatch(/intro/i);
    expect(tile.textContent).toMatch(/5\.0\s*s/);
  });
});
