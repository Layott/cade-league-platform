"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "zustand/react";
import {
  MousePointer2,
  Square,
  Type,
  Image as ImageIcon,
  Database,
  Undo2,
  Redo2,
  Circle,
  Minus,
  Hexagon,
  PenTool,
  Layers,
} from "lucide-react";
import { useBuilderStore, useTemporalStore } from "@/state/builder/store";

/**
 * Wave 2A — left-rail toolbar (updated).
 *
 * Image button became a split-button popover with two options:
 *   - Upload image → existing Wave 1A behavior (drops a placeholder
 *     image element; Wave 1B wires real upload).
 *   - From PSD → fires `builder:open-psd-picker` window event so the
 *     PsdPlaceDrawer (rendered by the editor shell) can list PSDs +
 *     hand a layer back as an image element.
 */
export function Toolbar() {
  const [mode, setMode] = useState<"select" | "insert">("select");
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const imageBtnRef = useRef<HTMLButtonElement | null>(null);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const addElement = useBuilderStore((s) => s.addElement);
  const undo = useStore(useTemporalStore, (s) => s.undo);
  const redo = useStore(useTemporalStore, (s) => s.redo);
  const toolMode = useBuilderStore((s) => s.toolMode);
  const setToolMode = useBuilderStore((s) => s.setToolMode);
  const startPenDraft = useBuilderStore((s) => s.startPenDraft);
  const cancelPenDraft = useBuilderStore((s) => s.cancelPenDraft);

  useEffect(() => {
    if (!imageMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!imageBtnRef.current?.contains(e.target as Node)) setImageMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [imageMenuOpen]);

  function addRect() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "rect", {
      transform: { x: 860, y: 490, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { fill: "#6bcd06" },
      zIndex: 0,
    });
  }

  function addText() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "text", {
      transform: { x: 860, y: 510, width: 200, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { color: "#ffffff", fontFamily: "Agharti", fontSize: 48, fontWeight: 600 },
      content: { text: "Text" },
      zIndex: 0,
    });
  }

  function addPlaceholderImage() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "image", {
      transform: { x: 860, y: 440, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      content: { assetId: "image-placeholder", imageFit: "cover" },
      zIndex: 0,
    });
    setImageMenuOpen(false);
  }

  function addEllipse() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "ellipse", {
      transform: { x: 860, y: 490, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { fill: "#6bcd06" },
      zIndex: 0,
    });
  }

  function addLine() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "line", {
      transform: { x: 760, y: 540, width: 400, height: 6, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { stroke: "#6bcd06", strokeWidth: 6 },
      zIndex: 0,
    });
  }

  function addPolygon() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "polygon", {
      transform: { x: 820, y: 440, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { fill: "#fe036d", sides: 6 },
      zIndex: 0,
    });
  }

  function openPsdPicker() {
    window.dispatchEvent(new CustomEvent("builder:open-psd-picker"));
    setImageMenuOpen(false);
  }

  function openDataSlots() {
    window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
  }

  return (
    <aside aria-label="Toolbar" className="relative flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-zinc-950 py-3">
      <ToolButton
        label="Select"
        testId="toolbar-tool-select"
        active={toolMode === "select" && mode === "select"}
        onClick={() => { setMode("select"); setToolMode("select"); cancelPenDraft(); }}
      >
        <MousePointer2 size={18} />
      </ToolButton>
      <ToolButton label="Rect" testId="toolbar-tool-rect" onClick={addRect}>
        <Square size={18} />
      </ToolButton>
      <ToolButton label="Text" testId="toolbar-tool-text" onClick={addText}>
        <Type size={18} />
      </ToolButton>
      <div className="relative">
        <button
          ref={imageBtnRef}
          type="button"
          aria-label="Image"
          aria-haspopup="menu"
          aria-expanded={imageMenuOpen}
          title="Image"
          data-testid="toolbar-tool-image"
          onClick={() => setImageMenuOpen((v) => !v)}
          className={`flex h-10 w-10 items-center justify-center rounded text-white/80 transition hover:bg-white/10 hover:text-white ${
            imageMenuOpen ? "bg-white/10 text-white" : ""
          }`}
        >
          <ImageIcon size={18} />
        </button>
        {imageMenuOpen && (
          <div
            role="menu"
            className="absolute left-12 top-0 z-50 w-44 rounded-md border border-white/10 bg-zinc-900 p-1 shadow-xl"
          >
            <button
              role="menuitem"
              type="button"
              data-testid="toolbar-image-upload"
              onClick={addPlaceholderImage}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            >
              <ImageIcon size={14} />
              Upload image
            </button>
            <button
              role="menuitem"
              type="button"
              data-testid="toolbar-image-psd"
              onClick={openPsdPicker}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            >
              <Layers size={14} />
              From PSD
            </button>
          </div>
        )}
      </div>
      <ToolButton label="Pen" testId="toolbar-tool-pen" active={toolMode === "pen"} onClick={() => startPenDraft()}>
        <PenTool size={18} />
      </ToolButton>
      <ToolButton label="Ellipse" testId="toolbar-tool-ellipse" onClick={addEllipse}>
        <Circle size={18} />
      </ToolButton>
      <ToolButton label="Line" testId="toolbar-tool-line" onClick={addLine}>
        <Minus size={18} />
      </ToolButton>
      <ToolButton label="Polygon" testId="toolbar-tool-polygon" onClick={addPolygon}>
        <Hexagon size={18} />
      </ToolButton>
      <ToolButton label="Data Slot" testId="toolbar-tool-data-slot" onClick={openDataSlots}>
        <Database size={18} />
      </ToolButton>
      <hr className="my-2 w-8 border-white/10" />
      <ToolButton label="Undo" testId="toolbar-undo" onClick={() => undo()}>
        <Undo2 size={18} />
      </ToolButton>
      <ToolButton label="Redo" testId="toolbar-redo" onClick={() => redo()}>
        <Redo2 size={18} />
      </ToolButton>
    </aside>
  );
}

function ToolButton({
  label,
  onClick,
  active,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded text-white/80 transition hover:bg-white/10 hover:text-white ${
        active ? "bg-[#6bcd06]/15 text-[#6bcd06]" : ""
      }`}
    >
      {children}
    </button>
  );
}
