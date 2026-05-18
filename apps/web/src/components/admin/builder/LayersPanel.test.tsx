import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayersPanel } from "./LayersPanel";
import { useBuilderStore } from "@/state/builder/store";

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
      elements: [
        {
          id: "rect-1",
          elementType: "rect" as const,
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
        },
        {
          id: "text-1",
          elementType: "text" as const,
          zIndex: 1,
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
          content: { text: "Greeting" },
        },
        {
          id: "img-1",
          elementType: "image" as const,
          zIndex: 2,
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
          content: { assetId: "logo.png" },
        },
      ],
    },
  ],
});

describe("LayersPanel", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("renders one row per element in reverse z order", () => {
    render(<LayersPanel />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // Top row = highest zIndex (img-1 / "logo.png")
    expect(rows[0].textContent).toMatch(/logo\.png/);
    expect(rows[2].textContent).toMatch(/rect/i);
  });

  it("clicking row sets selection", () => {
    render(<LayersPanel />);
    fireEvent.click(screen.getByText("Greeting"));
    expect(useBuilderStore.getState().selectedElementIds).toEqual(["text-1"]);
  });

  it("delete button removes element", () => {
    render(<LayersPanel />);
    const row = screen.getByText("Greeting").closest("li")!;
    const del = row.querySelector('[aria-label="Delete"]') as HTMLButtonElement;
    fireEvent.click(del);
    expect(
      useBuilderStore
        .getState()
        .design!.scenes[0].elements.find((e) => e.id === "text-1"),
    ).toBeUndefined();
  });

  it("visibility toggle flips element.visible via updateElement", () => {
    render(<LayersPanel />);
    const row = screen.getByText("Greeting").closest("li")!;
    const toggle = row.querySelector(
      '[aria-label="Toggle visibility"]',
    ) as HTMLButtonElement;
    fireEvent.click(toggle);
    const el = useBuilderStore
      .getState()
      .design!.scenes[0].elements.find((e) => e.id === "text-1")!;
    expect(el.visible).toBe(false);
  });

  it("manual reorder via the panel's reorderTo helper updates z_index ordering", () => {
    // dnd-kit drag events are non-trivial to simulate; assert the helper directly via
    // window.__builderTestReorder injected by the component for testability.
    render(<LayersPanel />);
    const w = window as unknown as {
      __builderTestReorder?: (id: string, z: number) => void;
    };
    w.__builderTestReorder?.("rect-1", 99);
    const elements = useBuilderStore.getState().design!.scenes[0].elements;
    expect(elements[elements.length - 1].id).toBe("rect-1");
    expect(elements[elements.length - 1].zIndex).toBe(99);
  });
});

describe("LayersPanel — Wave 1C group tree", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("renders group rows with chevrons and indented children", () => {
    const d = fixture();
    const groupId = "g-1";
    d.scenes[0].elements = [
      { id: "child-1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
        parentGroupId: groupId, transform: {} as never, style: {}, content: {} },
      { id: groupId, elementType: "group" as const, zIndex: 1, locked: false, visible: true,
        parentGroupId: null, transform: {} as never, style: {}, content: {} },
    ] as never;
    useBuilderStore.setState({ design: d as never });
    render(<LayersPanel />);
    expect(screen.getByRole("button", { name: /group/i })).toBeInTheDocument();
    const indented = document.querySelectorAll('[data-layer-indent="1"]');
    expect(indented.length).toBe(1);
  });

  it("clicking the group chevron collapses children rows", () => {
    const d = fixture();
    const groupId = "g-2";
    d.scenes[0].elements = [
      { id: "c-1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
        parentGroupId: groupId, transform: {} as never, style: {}, content: {} },
      { id: groupId, elementType: "group" as const, zIndex: 1, locked: false, visible: true,
        parentGroupId: null, transform: {} as never, style: {}, content: {} },
    ] as never;
    useBuilderStore.setState({ design: d as never });
    render(<LayersPanel />);
    const chevron = screen.getByLabelText(/toggle group/i);
    fireEvent.click(chevron);
    expect(document.querySelector('[data-layer-indent="1"]')).toBeNull();
  });
});
