import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { useBuilderStore } from "@/state/builder/store";
import type { Design } from "@/server/overlays/builder/types";

// saveDesignAction(FormData), publishDesignAction(designId: string),
// unpublishDesignAction(designId: string), updateDesignMetaAction(designId, patch),
// softDeleteDesignAction(designId: string)
const saveDesignActionMock = vi.fn();
const publishDesignActionMock = vi.fn();
const unpublishDesignActionMock = vi.fn();
const updateDesignMetaActionMock = vi.fn();
const softDeleteDesignActionMock = vi.fn();

vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
  saveDesignAction: (...args: unknown[]) => saveDesignActionMock(...args),
  publishDesignAction: (...args: unknown[]) => publishDesignActionMock(...args),
  unpublishDesignAction: (...args: unknown[]) => unpublishDesignActionMock(...args),
  updateDesignMetaAction: (...args: unknown[]) => updateDesignMetaActionMock(...args),
  softDeleteDesignAction: (...args: unknown[]) => softDeleteDesignActionMock(...args),
}));

// Wave 1A — TopBar now uses useRouter for post-delete redirect. The shell
// is normally wrapped by Next's app-router provider; in jsdom tests we
// stub a minimal mock so render() does not throw "invariant expected app
// router to be mounted".
const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const fixture: Design = {
  id: "d1",
  slug: "test",
  title: "Test Title",
  mode: "single",
  status: "draft",
  canvasWidth: 1920,
  canvasHeight: 1080,
  scenes: [
    {
      id: "s1",
      designId: "d1",
      orderIndex: 0,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    },
  ],
} as Design;

describe("TopBar", () => {
  beforeEach(() => {
    saveDesignActionMock.mockReset();
    publishDesignActionMock.mockReset();
    unpublishDesignActionMock.mockReset();
    updateDesignMetaActionMock.mockReset();
    useBuilderStore.setState({
      design: fixture,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("Save button disabled when not dirty", () => {
    render(<TopBar />);
    expect(
      (screen.getByRole("button", { name: /save/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("Save button enabled when dirty and triggers saveDesignAction + markClean", async () => {
    useBuilderStore.setState({ dirty: true });
    saveDesignActionMock.mockResolvedValueOnce(undefined);
    render(<TopBar />);
    const btn = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(saveDesignActionMock).toHaveBeenCalled();
      expect(useBuilderStore.getState().dirty).toBe(false);
    });
  });

  it("Publish button reads draft state and calls publishDesignAction", async () => {
    publishDesignActionMock.mockResolvedValueOnce(undefined);
    render(<TopBar />);
    const btn = screen.getByRole("button", { name: /publish/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(publishDesignActionMock).toHaveBeenCalledWith("d1");
    });
  });

  it("Revert button rendered disabled with coming-soon tooltip", () => {
    render(<TopBar />);
    const revert = screen.getByRole("button", {
      name: /revert/i,
    }) as HTMLButtonElement;
    expect(revert.disabled).toBe(true);
    expect(revert.getAttribute("title")).toMatch(/next wave/i);
  });

  it("Title input debounces updateDesignMetaAction", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    updateDesignMetaActionMock.mockResolvedValueOnce(undefined);
    render(<TopBar />);
    const input = screen.getByLabelText("Title");
    fireEvent.change(input, { target: { value: "Renamed" } });
    // Not called immediately — debounce guard
    expect(updateDesignMetaActionMock).not.toHaveBeenCalled();
    // Advance past the 500 ms debounce window
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(updateDesignMetaActionMock).toHaveBeenCalledWith("d1", {
      title: "Renamed",
    });
    vi.useRealTimers();
  });

  it("renders mode toggle when sequenceModeEnabled flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
    useBuilderStore.setState({
      design: { ...fixture, mode: "single" },
      dirty: false,
    });
    render(<TopBar />);
    expect(screen.getByTestId("mode-toggle")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("hides mode toggle when sequenceModeEnabled flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "");
    useBuilderStore.setState({
      design: { ...fixture, mode: "single" },
      dirty: false,
    });
    render(<TopBar />);
    expect(screen.queryByTestId("mode-toggle")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("clicking Sequence flips design.mode without confirm", async () => {
    vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
    useBuilderStore.setState({
      design: { ...fixture, mode: "single" },
      dirty: false,
    });
    render(<TopBar />);
    fireEvent.click(screen.getByTestId("mode-toggle-sequence"));
    expect(useBuilderStore.getState().design!.mode).toBe("sequence");
    vi.unstubAllEnvs();
  });

  // Fix 3 (2026-05-19): mode toggle must persist to DB immediately so
  // subsequent server actions (addSceneAction et al) revalidatePath →
  // RSC refetch don't clobber the local store back to mode='single'.
  it("clicking Sequence immediately persists mode via updateDesignMetaAction", async () => {
    vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
    updateDesignMetaActionMock.mockResolvedValueOnce(undefined);
    useBuilderStore.setState({
      design: { ...fixture, mode: "single" },
      dirty: false,
    });
    render(<TopBar />);
    fireEvent.click(screen.getByTestId("mode-toggle-sequence"));
    await waitFor(() => {
      expect(updateDesignMetaActionMock).toHaveBeenCalledWith("d1", {
        mode: "sequence",
      });
    });
    vi.unstubAllEnvs();
  });

  it("clicking Single with multiple scenes triggers confirm dialog", () => {
    vi.stubEnv("NEXT_PUBLIC_OVERLAY_BUILDER_SEQUENCE_MODE_ENABLED", "true");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    useBuilderStore.setState({
      design: {
        ...fixture,
        mode: "sequence",
        scenes: [
          { ...fixture.scenes[0] },
          { ...fixture.scenes[0], id: "s2", orderIndex: 1 },
        ],
      },
      dirty: false,
    });
    render(<TopBar />);
    fireEvent.click(screen.getByTestId("mode-toggle-single"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useBuilderStore.getState().design!.mode).toBe("sequence");
    confirmSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});
