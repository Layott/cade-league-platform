"use client";

import { useState } from "react";
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
} from "lucide-react";
import { useBuilderStore, useTemporalStore } from "@/state/builder/store";

/**
 * Wave 1A — left-rail toolbar.
 *
 * Vertical column of 40 px square icon buttons. Each tool either sets
 * the cursor mode (Select), inserts a default element into the active
 * scene at canvas-center (Rect / Text / Image), opens the data-slots
 * drawer (broadcast event), or fires the temporal undo / redo.
 */
export function Toolbar() {
  const [mode, setMode] = useState<"select" | "insert">("select");
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const addElement = useBuilderStore((s) => s.addElement);
  const undo = useStore(useTemporalStore, (s) => s.undo);
  const redo = useStore(useTemporalStore, (s) => s.redo);

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

  function addImage() {
    if (!activeSceneId) return;
    addElement(activeSceneId, "image", {
      transform: { x: 860, y: 440, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      content: { assetId: "image-placeholder", imageFit: "cover" },
      zIndex: 0,
    });
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

  function openDataSlots() {
    window.dispatchEvent(new CustomEvent("builder:open-data-slots"));
  }

  return (
    <aside aria-label="Toolbar" className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-zinc-950 py-3">
      <ToolButton label="Select" active={mode === "select"} onClick={() => setMode("select")}>
        <MousePointer2 size={18} />
      </ToolButton>
      <ToolButton label="Rect" onClick={addRect}>
        <Square size={18} />
      </ToolButton>
      <ToolButton label="Text" onClick={addText}>
        <Type size={18} />
      </ToolButton>
      <ToolButton label="Image" onClick={addImage}>
        <ImageIcon size={18} />
      </ToolButton>
      <ToolButton label="Ellipse" onClick={addEllipse}>
        <Circle size={18} />
      </ToolButton>
      <ToolButton label="Line" onClick={addLine}>
        <Minus size={18} />
      </ToolButton>
      <ToolButton label="Polygon" onClick={addPolygon}>
        <Hexagon size={18} />
      </ToolButton>
      <ToolButton label="Data Slot" onClick={openDataSlots}>
        <Database size={18} />
      </ToolButton>
      <hr className="my-2 w-8 border-white/10" />
      <ToolButton label="Undo" onClick={() => undo()}>
        <Undo2 size={18} />
      </ToolButton>
      <ToolButton label="Redo" onClick={() => redo()}>
        <Redo2 size={18} />
      </ToolButton>
    </aside>
  );
}

function ToolButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded text-white/80 transition hover:bg-white/10 hover:text-white ${
        active ? "bg-[#6bcd06]/15 text-[#6bcd06]" : ""
      }`}
    >
      {children}
    </button>
  );
}
