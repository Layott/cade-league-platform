/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScenePropertiesDrawer } from "./ScenePropertiesDrawer";
import { useBuilderStore } from "@/state/builder/store";

const updateSceneActionMock = vi.fn();
vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
  updateSceneAction: (...args: unknown[]) => updateSceneActionMock(...args),
}));

function seed() {
  useBuilderStore.setState({
    design: {
      id: "d1",
      slug: "x",
      title: "t",
      mode: "sequence",
      status: "draft",
      canvasWidth: 1920,
      canvasHeight: 1080,
      scenes: [
        {
          id: "s1",
          designId: "d1",
          orderIndex: 0,
          name: "intro",
          durationMs: 5000,
          transitionIn: "fade" as const,
          transitionOut: "fade" as const,
          elements: [],
        },
      ],
    },
    selectedElementIds: [],
    activeSceneId: "s1",
    zoomLevel: 1,
    dirty: false,
  } as never);
}

describe("ScenePropertiesDrawer", () => {
  beforeEach(() => {
    updateSceneActionMock.mockReset().mockResolvedValue({ ok: true });
    seed();
  });

  it("renders inputs prefilled from active scene", () => {
    render(<ScenePropertiesDrawer />);
    expect((screen.getByLabelText(/scene name/i) as HTMLInputElement).value).toBe("intro");
    expect((screen.getByLabelText(/duration/i) as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText(/transition in/i) as HTMLSelectElement).value).toBe("fade");
    expect((screen.getByLabelText(/transition out/i) as HTMLSelectElement).value).toBe("fade");
  });

  it("changing name updates store and fires debounced action", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ScenePropertiesDrawer />);
    fireEvent.change(screen.getByLabelText(/scene name/i), { target: { value: "intro v2" } });
    expect(useBuilderStore.getState().design!.scenes[0].name).toBe("intro v2");
    expect(updateSceneActionMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    await waitFor(() => {
      expect(updateSceneActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneId: "s1",
          patch: expect.objectContaining({ name: "intro v2" }),
        }),
      );
    });
    vi.useRealTimers();
  });

  it("changing duration converts seconds → ms in the patch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ScenePropertiesDrawer />);
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: "8" } });
    expect(useBuilderStore.getState().design!.scenes[0].durationMs).toBe(8000);
    vi.advanceTimersByTime(600);
    await waitFor(() => {
      expect(updateSceneActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({ durationMs: 8000 }),
        }),
      );
    });
    vi.useRealTimers();
  });

  it("changing transitionIn updates store + fires action", async () => {
    render(<ScenePropertiesDrawer />);
    fireEvent.change(screen.getByLabelText(/transition in/i), { target: { value: "slide-left" } });
    expect(useBuilderStore.getState().design!.scenes[0].transitionIn).toBe("slide-left");
    await waitFor(() => {
      expect(updateSceneActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({ transitionIn: "slide-left" }),
        }),
      );
    });
  });

  it("renders nothing when activeSceneId is null", () => {
    useBuilderStore.setState({ activeSceneId: null });
    const { container } = render(<ScenePropertiesDrawer />);
    expect(container.firstChild).toBeNull();
  });
});
