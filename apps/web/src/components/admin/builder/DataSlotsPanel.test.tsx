import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DataSlotsPanel } from "./DataSlotsPanel";
import { useBuilderStore } from "@/state/builder/store";

// Stable mocked catalog the panel reads.
vi.mock("@/server/overlays/builder/data-slots-catalog", () => ({
  DATA_SLOTS_CATALOG: [
    {
      id: "standings-rank-1-name",
      category: "Standings",
      label: "Standings Rank 1 — Name",
      defaultElementType: "text",
      defaultStyle: {
        color: "#ffffff",
        fontFamily: "Agharti",
        fontSize: 48,
        fontWeight: 700,
      },
      binding: { feed: "standings", fieldPath: "[0].name" },
    },
    {
      id: "standings-rank-1-pts",
      category: "Standings",
      label: "Standings Rank 1 — Pts",
      defaultElementType: "text",
      defaultStyle: {
        color: "#6bcd06",
        fontFamily: "Agharti",
        fontSize: 64,
        fontWeight: 800,
      },
      binding: { feed: "standings", fieldPath: "[0].pts" },
    },
    {
      id: "top-scorers-1-photo",
      category: "Top Scorers",
      label: "Top Scorers #1 — Photo",
      defaultElementType: "image",
      defaultStyle: {},
      binding: { feed: "top_scorers", fieldPath: "[0].photoUrl" },
    },
  ],
}));

const fixture = () => ({
  id: "d1",
  slug: "t",
  title: "T",
  mode: "single" as const,
  status: "draft" as const,
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
});

describe("DataSlotsPanel", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("hidden by default; opens on builder:open-data-slots event", () => {
    const { container } = render(<DataSlotsPanel />);
    expect(container.querySelector('[data-state="closed"]')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
    });
    expect(container.querySelector('[data-state="open"]')).toBeTruthy();
  });

  it("renders presets grouped by category", () => {
    render(<DataSlotsPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
    });
    expect(screen.getByText("Standings")).toBeTruthy();
    expect(screen.getByText("Top Scorers")).toBeTruthy();
    expect(screen.getByText("Standings Rank 1 — Name")).toBeTruthy();
    expect(screen.getByText("Top Scorers #1 — Photo")).toBeTruthy();
  });

  it("two-step pick + confirm inserts a Standings text element with the binding", () => {
    // Wave 1a updated 2026-05-18: picker now requires a confirm click
    // after the field is highlighted. This avoids accidental inserts when
    // operators are scanning the catalog.
    render(<DataSlotsPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
    });
    fireEvent.click(screen.getByText("Standings Rank 1 — Name"));
    // Click alone no longer inserts — confirm is required.
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(0);
    fireEvent.click(screen.getByTestId("data-slot-picker-confirm"));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0].elementType).toBe("text");
    expect(els[0].binding?.feed).toBe("standings");
    expect(els[0].binding?.fieldPath).toBe("[0].name");
    expect(els[0].style.color).toBe("#ffffff");
  });

  it("two-step pick + confirm inserts an image element", () => {
    render(<DataSlotsPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
    });
    fireEvent.click(screen.getByText("Top Scorers #1 — Photo"));
    fireEvent.click(screen.getByTestId("data-slot-picker-confirm"));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els[0].elementType).toBe("image");
    expect(els[0].binding?.feed).toBe("top_scorers");
  });

  it("after confirm, drawer auto-closes and inserted element is selected", () => {
    const { container } = render(<DataSlotsPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
    });
    fireEvent.click(screen.getByText("Standings Rank 1 — Pts"));
    fireEvent.click(screen.getByTestId("data-slot-picker-confirm"));
    expect(container.querySelector('[data-state="closed"]')).toBeTruthy();
    const selectedId = useBuilderStore.getState().selectedElementIds[0];
    const inserted = useBuilderStore.getState().design!.scenes[0].elements[0];
    expect(selectedId).toBe(inserted.id);
  });

  it("confirm button is disabled until a field is picked", () => {
    render(<DataSlotsPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
    });
    const confirm = screen.getByTestId(
      "data-slot-picker-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByText("Standings Rank 1 — Name"));
    expect(confirm.disabled).toBe(false);
  });
});
